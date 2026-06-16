/** GPU multi-texture satellite compositor with buffered temporal morphing.
 *
 * Thin deck.gl layer over two modules:
 *  - satellite/frameStore: time-indexed ring buffer on a snapped fetch grid
 *    (pans never invalidate; playhead-centered prefetch; buffered-range
 *    reporting for the video-player playback model),
 *  - satellite/flowPipeline: coarse-to-fine pyramid optical flow with a
 *    native-resolution cap, smoothing, forward-backward occlusion masking,
 *    and clear-sky background separation so terrain and lakes never advect.
 *
 * Pair selection is a pure time lookup against the ring buffer; the old
 * stateful pair-switching machinery (and its mid-interval deadlock) is gone.
 */

import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";
import type { Device, Texture } from "@luma.gl/core";
import type { RenderQualityPreset } from "../types";

import { logManager } from "../../lib/logging";
import { parseWmsTimeDimension } from "../../time/wmsTime";
import { subSolarPoint } from "./terminator";
import { mergeBufferedRanges, type BufferedRange } from "./satellite/frameGrid";
import { LOOP_BUFFER_SPAN_MS } from "./satellite/framePlan";
import { FrameStore, type StoredFrame } from "./satellite/frameStore";
import { createGpuFetchFrame, getMotionSample, type GpuFrameTexture, type MotionSample } from "./satellite/frameStoreFactory";
import { FlowPipeline, MAX_FLOW_UV, type FlowPairRequest } from "./satellite/flowPipeline";
import {
  bearingToCardinal,
  decodeMotionSample,
  sampleMotionGrid,
  type MotionField,
  type MotionVectorSample,
} from "./satellite/motionField";
import { fetchMotionField, motionFieldUrl, motionSatelliteFor } from "./satellite/serverMotion";
import { templateTimeMs } from "./satellite/wmsRequest";

export type { BufferedRange } from "./satellite/frameGrid";

export interface SatelliteDiskParams {
  layerId: string;
  subPoint: [number, number];
  coverageRadiusDeg: number;
  featherRadiusDeg: number;
  opacity: number;
}

export interface SatelliteCompositeConfig {
  id: string;
  subPoint: [number, number];
  coverageRadiusDeg: number;
  featherRadiusDeg: number;
  wmsUrlTemplate: string;
  timeExtent?: string | null;
  opacity: number;
}

export interface SatelliteCompositeLoadingState {
  loading: boolean;
  started: boolean;
  readySatellites: number;
  totalSatellites: number;
  bufferedFrames: number;
  requiredFrames: number;
  phase: "idle" | "fetching" | "computing-flow" | "ready";
  inFlightFrames: number;
  pendingFlows: number;
  estimatedSecondsRemaining: number | null;
}

interface SatelliteCompositeLayerProps extends LayerProps {
  satellites: SatelliteCompositeConfig[];
  timeProgress: number;
  timelineMs?: number;
  quality?: RenderQualityPreset;
  onLoadingStateChange?: (state: SatelliteCompositeLoadingState) => void;
  onBufferedRangesChange?: (ranges: BufferedRange[]) => void;
}

interface SatEntry {
  config: SatelliteCompositeConfig;
  frameStore: FrameStore;
  availableTimesMs: number[];
}

interface CompositorState {
  model: Model | null;
  flowPipeline: FlowPipeline | null;
  entries: SatEntry[];
  fallbackTexture: Texture | null;
  device: Device | null;
  anyTextureLoaded: boolean;
  started: boolean;
  loading: boolean;
  uniforms: Record<string, unknown> | null;
  timelineMs: number | null;
  timeProgressValue: number;
  geometryKey: string | null;
  pairGlobalFlows: Map<string, [number, number, number, number]>;
  idlePumpHandle: number | null;
  lastViewMercBounds: [number, number, number, number] | null;
}

const GEOSTATIONARY_SATELLITES: Record<string, SatelliteDiskParams> = {
  eccc_goes_east_natural: {
    layerId: "eccc_goes_east_natural",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 15.0,
    opacity: 0.72,
  },
  eccc_goes_east_ir: {
    layerId: "eccc_goes_east_ir",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 15.0,
    opacity: 0.72,
  },
  eccc_goes_east_cloud_type: {
    layerId: "eccc_goes_east_cloud_type",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 15.0,
    opacity: 0.72,
  },
  eccc_goes_west_natural: {
    layerId: "eccc_goes_west_natural",
    subPoint: [-137.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 15.0,
    opacity: 0.72,
  },
  eccc_goes_west_cloud_type: {
    layerId: "eccc_goes_west_cloud_type",
    subPoint: [-137.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 15.0,
    opacity: 0.72,
  },
};

const EARTH_RADIUS_M = 6_378_137.0;
const DEG_TO_RAD = Math.PI / 180;

/** Three slots × four samplers per slot = 12 fragment texture units, safely
 * inside the WebGL2 guaranteed minimum of 16. */
const SHADER_SATELLITE_SLOTS = 3;

const SATELLITE_FRAME_INTERVAL_MS = 10 * 60 * 1000;
const MOTION_COARSE_SEARCH_RADIUS_PX = 28;
const MOTION_FINE_SEARCH_RADIUS_PX = 4;
const MAX_GLOBAL_FLOW_UV = 0.18;
const VISIBLE_MOTION_START_SIN_ELEV = 0.13917; // sin(8 deg)
const VISIBLE_MOTION_FULL_SIN_ELEV = 0.30902; // sin(18 deg)
const QUALITY_DEFAULT: RenderQualityPreset = "balanced";

const VS = `\
#version 300 es
in vec2 aPosition;
in vec2 aMercator;
out vec2 vUv;
out vec2 vMercator;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
  vMercator = aMercator;
}
`;

const FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
in vec2 vMercator;
out vec4 fragColor;

uniform sampler2D uPrevTex0;
uniform sampler2D uPrevTex1;
uniform sampler2D uPrevTex2;
uniform sampler2D uNextTex0;
uniform sampler2D uNextTex1;
uniform sampler2D uNextTex2;
uniform sampler2D uFlowTex0;
uniform sampler2D uFlowTex1;
uniform sampler2D uFlowTex2;
uniform sampler2D uBgMaskTex0;
uniform sampler2D uBgMaskTex1;
uniform sampler2D uBgMaskTex2;
uniform vec4 uMercBounds;
uniform float uEarthRadius;
uniform vec4 uSatParams[3];
uniform float uSatFeather[3];
uniform vec4 uPrevBounds[3];
uniform vec4 uNextBounds[3];
uniform vec4 uGlobalFlow[3];
uniform vec4 uIncomingGlobalFlow[3];
uniform vec4 uOutgoingGlobalFlow[3];
uniform int uSatCount;
uniform float uSatOpacity[3];
uniform float uHasPrevTex[3];
uniform float uHasNextTex[3];
uniform float uHasFlowTex[3];
uniform float uHasBgMask[3];
uniform float uRequiresStableVisibleLight[3];
uniform float uTimeProgress[3];
uniform float uMaxFlowUv;
uniform vec3 uSunCartesian;

const float PI = 3.141592653589793;
const float DEG_TO_RAD = PI / 180.0;
const float RAD_TO_DEG = 180.0 / PI;

float mercatorYToLat(float y) {
  return 2.0 * atan(exp(y / uEarthRadius)) * RAD_TO_DEG - 90.0;
}

float mercatorXToLon(float x) {
  return x / uEarthRadius * RAD_TO_DEG;
}

vec3 latLonToCartesian(float lat, float lon) {
  float phi = lat * DEG_TO_RAD;
  float lambda = lon * DEG_TO_RAD;
  return vec3(cos(phi) * cos(lambda), cos(phi) * sin(lambda), sin(phi));
}

vec4 samplePrevTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uPrevTex0, uv);
  if (idx == 1) return texture(uPrevTex1, uv);
  return texture(uPrevTex2, uv);
}

vec4 sampleNextTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uNextTex0, uv);
  if (idx == 1) return texture(uNextTex1, uv);
  return texture(uNextTex2, uv);
}

vec4 sampleFlowTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uFlowTex0, uv);
  if (idx == 1) return texture(uFlowTex1, uv);
  return texture(uFlowTex2, uv);
}

vec4 sampleBgMask(int idx, vec2 uv) {
  if (idx == 0) return texture(uBgMaskTex0, uv);
  if (idx == 1) return texture(uBgMaskTex1, uv);
  return texture(uBgMaskTex2, uv);
}

vec2 mercToTexUv(vec2 merc, vec4 bounds) {
  vec2 span = max(bounds.zw - bounds.xy, vec2(1.0));
  vec2 uv = (merc - bounds.xy) / span;
  return vec2(uv.x, 1.0 - uv.y);
}

bool uvInside(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec4 cleanTexel(vec4 texel) {
  texel.rgb = max(texel.rgb, vec3(0.0));
  texel.a = clamp(texel.a, 0.0, 1.0);
  return texel;
}

float stableDaylightMotionTrust(vec2 merc) {
  float lon = mercatorXToLon(merc.x);
  float lat = mercatorYToLat(merc.y);
  vec3 fragCart = latLonToCartesian(lat, lon);
  float sinElev = dot(normalize(fragCart), normalize(uSunCartesian));
  return smoothstep(0.13917, 0.30902, sinElev);
}

vec2 clampTemporalVelocityAdjustment(vec2 delta, vec2 baseFlow) {
  // Adjacent-pair global flow only smooths velocity at keyframes. Limit the
  // correction so a noisy neighbouring pair cannot destroy local dense motion.
  vec2 limit = max(vec2(0.0035), abs(baseFlow) * 0.55);
  return clamp(delta, -limit, limit);
}

vec2 hermiteDisplacement(vec2 totalFlow, vec2 startVelocity, vec2 endVelocity, float t) {
  if (t <= 0.0) return vec2(0.0);
  if (t >= 1.0) return totalFlow;
  float t2 = t * t;
  float t3 = t2 * t;
  float h01 = -2.0 * t3 + 3.0 * t2;
  float h10 = t3 - 2.0 * t2 + t;
  float h11 = t3 - t2;
  return h01 * totalFlow + h10 * startVelocity + h11 * endVelocity;
}

float cloudSignal(vec4 texel) {
  float luma = dot(texel.rgb, vec3(0.2126, 0.7152, 0.0722));
  float chroma = max(max(texel.r, texel.g), texel.b) - min(min(texel.r, texel.g), texel.b);
  return texel.a * max(luma, chroma);
}

vec4 advectedCloudSample(vec4 prevWarp, vec4 nextWarp, float t) {
  // Motion-compensated temporal blend. Both inputs are already warped along the
  // flow to the intermediate parcel position, so they align spatially: blending
  // them reads as continuous video motion, NOT a double-image ghost (classic
  // ghosting comes from blending un-warped frames). The smoothstep weight has
  // zero slope at t=0 and t=1, so the appearance transition is C1-continuous
  // across keyframes — no velocity kink, no pop.
  return mix(prevWarp, nextWarp, smoothstep(0.0, 1.0, t));
}

vec4 sampleMorph(int idx, vec2 merc) {
  bool hasPrev = uHasPrevTex[idx] > 0.5;
  bool hasNext = uHasNextTex[idx] > 0.5;
  vec2 prevUv = mercToTexUv(merc, uPrevBounds[idx]);
  vec2 nextUv = mercToTexUv(merc, uNextBounds[idx]);
  bool prevInside = hasPrev && uvInside(prevUv);
  bool nextInside = hasNext && uvInside(nextUv);

  if (!prevInside && !nextInside) return vec4(0.0);
  if (prevInside && !nextInside) return cleanTexel(samplePrevTex(idx, prevUv));
  if (!prevInside && nextInside) return cleanTexel(sampleNextTex(idx, nextUv));

  vec4 prevSample = cleanTexel(samplePrevTex(idx, prevUv));
  vec4 nextSample = cleanTexel(sampleNextTex(idx, nextUv));
  vec4 globalMotion = uGlobalFlow[idx];
  vec4 incomingMotion = uIncomingGlobalFlow[idx];
  vec4 outgoingMotion = uOutgoingGlobalFlow[idx];
  float motionTrust = mix(1.0, stableDaylightMotionTrust(merc), uRequiresStableVisibleLight[idx]);
  float globalConf = clamp(globalMotion.z, 0.0, 1.0) * motionTrust;
  float incomingConf = clamp(incomingMotion.z, 0.0, 1.0) * motionTrust;
  float outgoingConf = clamp(outgoingMotion.z, 0.0, 1.0) * motionTrust;
  vec2 globalFlowUV = globalMotion.xy * motionTrust;
  vec2 incomingFlowUV = incomingMotion.xy * motionTrust;
  vec2 outgoingFlowUV = outgoingMotion.xy * motionTrust;

  float phase = uTimeProgress[idx];
  if (phase < 0.0) {
    if (globalConf < 0.08) return prevSample;
    // Continuous backward advection consistent with the forward path.
    return cleanTexel(samplePrevTex(idx, clamp(prevUv + globalFlowUV * (-phase), vec2(0.0), vec2(1.0))));
  }

  // Continuous extrapolation past the latest frame — no fract() wrapping, no
  // cyclic "breathing". With untrusted motion, hold the endpoint.
  float extrapolated = max(phase - 1.0, 0.0);
  if (extrapolated > 0.0) {
    if (globalConf < 0.08) return nextSample;
    vec2 forwardFlow = globalFlowUV * (1.0 + extrapolated);
    return cleanTexel(sampleNextTex(idx, clamp(nextUv - forwardFlow, vec2(0.0), vec2(1.0))));
  }

  // Linear phase preserves constant-velocity advection between keyframes.
  float t = clamp(phase, 0.0, 1.0);

  float flowBlend = uHasFlowTex[idx];
  float denseConf = 0.0;
  float occlusion = 0.0;
  vec2 flowUV = globalFlowUV;
  if (flowBlend > 0.001) {
    // Semi-Lagrangian lookup near the predicted parcel position.
    vec2 predictedNextUv = clamp(nextUv + globalFlowUV * (1.0 - t), vec2(0.0), vec2(1.0));
    vec4 packed = sampleFlowTex(idx, predictedNextUv);
    denseConf = clamp(packed.b, 0.0, 1.0) * motionTrust;
    occlusion = clamp(packed.a, 0.0, 1.0);
    vec2 denseFlowUv = (packed.rg - vec2(0.5)) * (uMaxFlowUv * 2.0) * motionTrust;

    float denseWeight = smoothstep(0.05, 0.35, denseConf) * flowBlend;
    flowUV = mix(globalFlowUV, denseFlowUv, denseWeight);
  }

  // Without trustworthy motion we cannot warp, so fall back to a smooth
  // temporal cross-fade. A hard mid-interval switch was crisper but produced
  // the visible keyframe pop; seamless playback is the requirement, so we
  // accept a brief dissolve where flow is absent (e.g. categorical cloud-type
  // class interiors that defeat optical flow).
  float flowConf = max(globalConf, denseConf * flowBlend);
  if (flowConf < 0.05) {
    return mix(prevSample, nextSample, smoothstep(0.0, 1.0, t));
  }

  // Symmetric optical-flow morphing with C1 temporal continuity across
  // keyframes via adjacent-pair velocity estimates.
  vec2 startVelocity = flowUV;
  if (incomingConf > 0.08) {
    vec2 boundaryVelocity = 0.5 * (incomingFlowUV + flowUV);
    float weight = smoothstep(0.08, 0.55, incomingConf);
    startVelocity += clampTemporalVelocityAdjustment((boundaryVelocity - flowUV) * weight, flowUV);
  }

  vec2 endVelocity = flowUV;
  if (outgoingConf > 0.08) {
    vec2 boundaryVelocity = 0.5 * (flowUV + outgoingFlowUV);
    float weight = smoothstep(0.08, 0.55, outgoingConf);
    endVelocity += clampTemporalVelocityAdjustment((boundaryVelocity - flowUV) * weight, flowUV);
  }

  vec2 displacement = clamp(hermiteDisplacement(flowUV, startVelocity, endVelocity, t), -vec2(uMaxFlowUv), vec2(uMaxFlowUv));
  vec2 prevWarpUv = clamp(prevUv - displacement, vec2(0.0), vec2(1.0));
  vec2 nextWarpUv = clamp(nextUv + (flowUV - displacement), vec2(0.0), vec2(1.0));
  vec4 prevWarp = cleanTexel(samplePrevTex(idx, prevWarpUv));
  vec4 nextWarp = cleanTexel(sampleNextTex(idx, nextWarpUv));

  // Preserve warped cloud radiance instead of cross-fading two warped frames.
  // A dissolve turns real motion into fading pixels; the helper returns one
  // carried texel, so confident motion is visual advection rather than a
  // temporal transition.
  vec4 result = advectedCloudSample(prevWarp, nextWarp, t);

  // Forward-backward occlusion: where the flow directions disagree, the cloud
  // is forming or dissipating. Warping would stretch it; fading would ghost it.
  // Choose the stronger endpoint cloud signal as a crisp replacement.
  if (occlusion > 0.001) {
    vec4 occlusionSample = cloudSignal(prevSample) >= cloudSignal(nextSample) ? prevSample : nextSample;
    result = occlusion > 0.5 ? occlusionSample : result;
  }

  if (result.a < 0.01) {
    result = mix(prevSample, nextSample, smoothstep(0.0, 1.0, t));
  }

  // Cloud/background separation: static clear-sky pixels render from the
  // accumulated background so terrain and lakes never advect with the flow.
  if (uHasBgMask[idx] > 0.5) {
    vec4 bgMask = sampleBgMask(idx, nextUv);
    float cloudAlpha = clamp(bgMask.a, 0.0, 1.0);
    result.rgb = mix(bgMask.rgb, result.rgb, cloudAlpha);
  }

  return result;
}

void main() {
  vec2 merc = vMercator;
  float lon = mercatorXToLon(merc.x);
  float lat = mercatorYToLat(merc.y);
  vec3 fragCart = latLonToCartesian(lat, lon);

  vec4 color = vec4(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < 3; i++) {
    if (i >= uSatCount) break;
    if (uHasPrevTex[i] < 0.5 && uHasNextTex[i] < 0.5) continue;

    vec3 subCart = uSatParams[i].xyz;
    float maxChord = uSatParams[i].w;
    float featherStart = uSatFeather[i];
    float chordDist = length(fragCart - subCart);
    float weight = 1.0 - smoothstep(featherStart, maxChord, chordDist);

    if (weight > 0.001) {
      vec4 texel = sampleMorph(i, merc);
      float contrib = weight * texel.a * uSatOpacity[i];
      color += texel * contrib;
      totalWeight += contrib;
    }
  }

  if (totalWeight > 0.001) {
    color.rgb /= totalWeight;
  }

  fragColor = vec4(color.rgb, clamp(totalWeight, 0.0, 1.0));
}
`;

function normalizeQuality(value: RenderQualityPreset | undefined): RenderQualityPreset {
  return value ?? QUALITY_DEFAULT;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function hermiteFlowDisplacementForTesting(
  totalFlow: [number, number],
  startVelocity: [number, number],
  endVelocity: [number, number],
  tValue: number,
): [number, number] {
  const t = Math.max(0, Math.min(1, Number.isFinite(tValue) ? tValue : 0));
  if (t <= 0) return [0, 0];
  if (t >= 1) return totalFlow;
  const t2 = t * t;
  const t3 = t2 * t;
  const h01 = -2 * t3 + 3 * t2;
  const h10 = t3 - 2 * t2 + t;
  const h11 = t3 - t2;
  return [
    h01 * totalFlow[0] + h10 * startVelocity[0] + h11 * endVelocity[0],
    h01 * totalFlow[1] + h10 * startVelocity[1] + h11 * endVelocity[1],
  ];
}

export function isVisibleSatelliteMotionSource(layerId: string): boolean {
  const normalized = layerId.toLowerCase();
  return normalized.includes("natural") || normalized.includes("visible") || normalized.includes("_vis");
}

export function stableVisibleMotionTrustFromSolarElevation(sinElevation: number): number {
  if (!Number.isFinite(sinElevation)) return 0;
  return smoothstep(VISIBLE_MOTION_START_SIN_ELEV, VISIBLE_MOTION_FULL_SIN_ELEV, sinElevation);
}

function sunCartesianAt(timeMs: number | null): [number, number, number] {
  const [lon, lat] = subSolarPoint(new Date(Number.isFinite(timeMs ?? Number.NaN) ? timeMs! : Date.now()));
  const phi = lat * DEG_TO_RAD;
  const lambda = lon * DEG_TO_RAD;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function quadraticSubpixelMinimumOffset(left: number, center: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(center) || !Number.isFinite(right)) return 0;
  const denom = left - 2 * center + right;
  if (Math.abs(denom) < 1e-6) return 0;
  return Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denom));
}

export function estimateGlobalFlow(prev: MotionSample | null, next: MotionSample | null): [number, number, number, number] {
  if (!prev || !next || prev.width !== next.width || prev.height !== next.height) {
    return [0, 0, 0, 0];
  }

  // Hierarchical normalized block matching: coarse pass captures large
  // advection, fine pass refines, quadratic subpixel fit removes pixel
  // quantization from the seed handed to the dense GPU flow.
  const { width, height } = prev;
  const maxRadius = Math.max(1, Math.min(MOTION_COARSE_SEARCH_RADIUS_PX, Math.floor(Math.min(width, height) / 4) - 2));
  const interiorMargin = Math.max(maxRadius + 1, 2);

  let bestDx = 0;
  let bestDy = 0;
  let bestError = Number.POSITIVE_INFINITY;

  const shiftedError = (dx: number, dy: number, stride: number): number => {
    const ix = Math.round(dx);
    const iy = Math.round(dy);
    if (Math.abs(ix) > maxRadius || Math.abs(iy) > maxRadius) return Number.POSITIVE_INFINITY;

    let err = 0;
    let weightSum = 0;

    for (let y = interiorMargin; y < height - interiorMargin; y += stride) {
      const nextY = y + iy;
      if (nextY < 0 || nextY >= height) continue;

      for (let x = interiorMargin; x < width - interiorMargin; x += stride) {
        const nextX = x + ix;
        if (nextX < 0 || nextX >= width) continue;

        const a = prev.luma[y * width + x];
        const b = next.luma[nextY * width + nextX];
        const signal = Math.max(a, b);

        if (signal < 0.030) continue;

        const weight = 0.20 + Math.min(1, signal * 3.0);
        err += Math.abs(a - b) * weight;
        weightSum += weight;
      }
    }

    return weightSum > 0 ? err / weightSum : Number.POSITIVE_INFINITY;
  };

  const searchAround = (centerDx: number, centerDy: number, radius: number, step: number, stride: number): void => {
    for (let dy = Math.round(centerDy - radius); dy <= Math.round(centerDy + radius); dy += step) {
      for (let dx = Math.round(centerDx - radius); dx <= Math.round(centerDx + radius); dx += step) {
        const err = shiftedError(dx, dy, stride);
        if (err < bestError) {
          bestError = err;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
  };

  const coarseStep = maxRadius > 16 ? 2 : 1;
  searchAround(0, 0, maxRadius, coarseStep, 4);
  searchAround(bestDx, bestDy, Math.min(6, maxRadius), 1, 2);
  searchAround(bestDx, bestDy, Math.min(MOTION_FINE_SEARCH_RADIUS_PX, maxRadius), 1, 1);

  bestError = shiftedError(bestDx, bestDy, 1);
  const zeroError = shiftedError(0, 0, 1);
  const magnitude = Math.hypot(bestDx, bestDy);
  if (!Number.isFinite(bestError) || !Number.isFinite(zeroError) || magnitude < 0.5) {
    return [0, 0, 0, 0];
  }

  const improvement = Math.max(0, (zeroError - bestError) / Math.max(zeroError, 0.0001));
  if (improvement < 0.009) return [0, 0, 0, 0];

  const dxLeft = bestDx > -maxRadius ? shiftedError(bestDx - 1, bestDy, 1) : bestError;
  const dxRight = bestDx < maxRadius ? shiftedError(bestDx + 1, bestDy, 1) : bestError;
  const dyDown = bestDy > -maxRadius ? shiftedError(bestDx, bestDy - 1, 1) : bestError;
  const dyUp = bestDy < maxRadius ? shiftedError(bestDx, bestDy + 1, 1) : bestError;

  const refinedDx = bestDx + quadraticSubpixelMinimumOffset(dxLeft, bestError, dxRight);
  const refinedDy = bestDy + quadraticSubpixelMinimumOffset(dyDown, bestError, dyUp);

  const confidence = Math.min(0.92, Math.max(0.30, improvement * 6.5));
  const flowX = Math.max(-MAX_GLOBAL_FLOW_UV, Math.min(MAX_GLOBAL_FLOW_UV, refinedDx / width));
  const flowY = Math.max(-MAX_GLOBAL_FLOW_UV, Math.min(MAX_GLOBAL_FLOW_UV, refinedDy / height));

  return [flowX, flowY, confidence, 0];
}

/** Adjacent frame pairs eligible for flow, in time order. */
export function selectFlowPairCandidates(frames: StoredFrame[]): Array<[StoredFrame, StoredFrame]> {
  const sorted = [...frames].sort((a, b) => a.timeMs - b.timeMs);
  const pairs: Array<[StoredFrame, StoredFrame]> = [];
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const prev = sorted[i];
    const next = sorted[i + 1];
    if (next.timeMs > prev.timeMs && prev.gridKey === next.gridKey) pairs.push([prev, next]);
  }
  return pairs;
}

export function shouldStartSatelliteCompositeForTesting(args: {
  activeSatellites: number;
  readySatellites: number;
  bufferedFrames: number;
}): boolean {
  if (args.activeSatellites <= 0) return false;
  return args.readySatellites > 0 || args.bufferedFrames > 0;
}

/** A time is buffered for the composite iff buffered for every entry. */
export function intersectBufferedRanges(perEntry: BufferedRange[][], frameIntervalMs: number): BufferedRange[] {
  if (perEntry.length === 0) return [];
  if (perEntry.length === 1) return perEntry[0];

  let result = perEntry[0];
  for (let i = 1; i < perEntry.length; i += 1) {
    const intersected: BufferedRange[] = [];
    for (const a of result) {
      for (const b of perEntry[i]) {
        const start = Math.max(a.startMs, b.startMs);
        const end = Math.min(a.endMs, b.endMs);
        if (end >= start) intersected.push({ startMs: start, endMs: end });
      }
    }
    result = intersected
      .sort((x, y) => x.startMs - y.startMs)
      .reduce<BufferedRange[]>((acc, r) => {
        const last = acc[acc.length - 1];
        if (last && r.startMs <= last.endMs + frameIntervalMs) {
          last.endMs = Math.max(last.endMs, r.endMs);
        } else {
          acc.push({ ...r });
        }
        return acc;
      }, []);
  }
  return result;
}

function pairKeyOf(prev: StoredFrame, next: StoredFrame): string {
  return `${prev.gridKey}@${prev.timeMs}=>${next.timeMs}`;
}

/** Index of the frame with the given timeMs in a time-sorted array, or -1.
 * O(log n) — the draw loop runs per display frame and must not scan. */
function indexOfFrameTime(frames: StoredFrame[], timeMs: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = frames[mid].timeMs;
    if (t === timeMs) return mid;
    if (t < timeMs) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

function clampMercatorLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function mercatorBoundsFromViewport(viewport: {
  getBounds: () => [number, number, number, number];
}): [number, number, number, number] {
  const b = viewport.getBounds();
  const west = Math.min(b[0], b[2]);
  const south = clampMercatorLat(Math.min(b[1], b[3]));
  const east = Math.max(b[0], b[2]);
  const north = clampMercatorLat(Math.max(b[1], b[3]));

  return [
    west * DEG_TO_RAD * EARTH_RADIUS_M,
    Math.log(Math.tan((90 + south) * DEG_TO_RAD * 0.5)) * EARTH_RADIUS_M,
    east * DEG_TO_RAD * EARTH_RADIUS_M,
    Math.log(Math.tan((90 + north) * DEG_TO_RAD * 0.5)) * EARTH_RADIUS_M,
  ];
}

function lonLatToMercator(lon: number, lat: number): [number, number] {
  const clampedLat = clampMercatorLat(lat);
  return [
    lon * DEG_TO_RAD * EARTH_RADIUS_M,
    Math.log(Math.tan((90 + clampedLat) * DEG_TO_RAD * 0.5)) * EARTH_RADIUS_M,
  ];
}

function viewportGeometryKey(
  viewport: { width: number; height: number; longitude?: number; latitude?: number; zoom?: number; bearing?: number; pitch?: number },
  mercBounds: [number, number, number, number],
  segments: number,
): string {
  const parts = [
    segments,
    viewport.width,
    viewport.height,
    viewport.longitude,
    viewport.latitude,
    viewport.zoom,
    viewport.bearing,
    viewport.pitch,
    ...mercBounds,
  ];
  return parts.map((part) => (typeof part === "number" ? part.toFixed(4) : String(part ?? ""))).join("|");
}

function mercatorAtScreenPoint(
  viewport: { unproject?: (xy: [number, number]) => number[] | null; width: number; height: number },
  x: number,
  y: number,
  mercBounds: [number, number, number, number],
): [number, number] {
  try {
    const lonLat = viewport.unproject?.([x, y]);
    if (Array.isArray(lonLat) && Number.isFinite(lonLat[0]) && Number.isFinite(lonLat[1])) {
      return lonLatToMercator(lonLat[0], lonLat[1]);
    }
  } catch {
    // Fall through to axis-aligned fallback.
  }

  const u = x / Math.max(1, viewport.width);
  const v = y / Math.max(1, viewport.height);

  return [
    mercBounds[0] + (mercBounds[2] - mercBounds[0]) * u,
    mercBounds[3] + (mercBounds[1] - mercBounds[3]) * v,
  ];
}

function createViewportGeometry(
  viewport: { width: number; height: number; unproject?: (xy: [number, number]) => number[] | null },
  mercBounds: [number, number, number, number],
  segments: number,
): Geometry {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const segCount = Math.max(4, Math.round(segments));
  const positions: number[] = [];
  const mercators: number[] = [];

  const pushVertex = (ix: number, iy: number) => {
    const x = (ix / segCount) * width;
    const y = (iy / segCount) * height;
    positions.push((x / width) * 2 - 1, 1 - (y / height) * 2);
    mercators.push(...mercatorAtScreenPoint(viewport, x, y, mercBounds));
  };

  for (let iy = 0; iy < segCount; iy += 1) {
    for (let ix = 0; ix < segCount; ix += 1) {
      pushVertex(ix, iy);
      pushVertex(ix + 1, iy);
      pushVertex(ix, iy + 1);
      pushVertex(ix + 1, iy);
      pushVertex(ix + 1, iy + 1);
      pushVertex(ix, iy + 1);
    }
  }

  return new Geometry({
    topology: "triangle-list",
    attributes: {
      aPosition: { size: 2, value: new Float32Array(positions) },
      aMercator: { size: 2, value: new Float32Array(mercators) },
    },
  });
}

function createInitialCompositeGeometry(): Geometry {
  return new Geometry({
    topology: "triangle-strip",
    vertexCount: 4,
    attributes: {
      aPosition: {
        size: 2,
        value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      },
      aMercator: {
        size: 2,
        value: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      },
    },
  });
}

function createFallbackTexture(device: Device): Texture {
  return device.createTexture({
    data: new Uint8Array([0, 0, 0, 0]),
    width: 1,
    height: 1,
    format: "rgba8unorm" as never,
    sampler: {
      minFilter: "linear" as never,
      magFilter: "linear" as never,
      addressModeU: "clamp-to-edge" as never,
      addressModeV: "clamp-to-edge" as never,
    },
  });
}

function subPointCartesian(lon: number, lat: number): [number, number, number] {
  const phi = lat * DEG_TO_RAD;
  const lambda = lon * DEG_TO_RAD;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function chordParams(coverageDeg: number, featherDeg: number): { maxChord: number; featherStartChord: number } {
  const maxChord = 2 * Math.sin(coverageDeg * DEG_TO_RAD * 0.5);
  const featherStart = 2 * Math.sin(Math.max(0.001, coverageDeg - featherDeg) * DEG_TO_RAD * 0.5);
  return { maxChord, featherStartChord: featherStart };
}

function maxSatellitesForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 1;
  if (quality === "quality") return 3;
  return 2;
}

function maxTextureDimForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 1280;
  if (quality === "quality") return 2560;
  return 2048;
}

function fetchPaddingForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 0.12;
  if (quality === "quality") return 0.24;
  return 0.18;
}

function viewportMeshSegmentsForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 12;
  if (quality === "quality") return 24;
  return 18;
}

function viewportTexDimensions(
  viewport: { width: number; height: number },
  opts: { fetchPadding: number; maxTexDim: number },
): [number, number] {
  // deck viewport dimensions are CSS pixels; without the device-pixel-ratio
  // factor every satellite texture renders at half resolution (or worse) on
  // HiDPI displays. Clamp DPR at 2 — beyond that the WMS payload cost
  // outweighs visible gain.
  const dpr = typeof window !== "undefined"
    ? Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    : 1;
  const scale = (1 + opts.fetchPadding * 2) * dpr;
  const viewportMax = Math.max(viewport.width, viewport.height) * dpr;
  const adaptiveMax = Math.max(768, Math.min(opts.maxTexDim, Math.round(viewportMax * 1.15)));

  return [
    Math.max(256, Math.min(Math.round(viewport.width * scale) || 768, adaptiveMax)),
    Math.max(256, Math.min(Math.round(viewport.height * scale) || 512, adaptiveMax)),
  ];
}

function availableTimesFor(config: SatelliteCompositeConfig): number[] {
  if (config.timeExtent) {
    const times = parseWmsTimeDimension(config.timeExtent);
    if (times.length > 0) return times;
  }
  // No advertised extent: synthesize a recent observation window ending at the
  // template time (or now), at the nominal 10-minute cadence.
  const anchor = templateTimeMs(config.wmsUrlTemplate) ?? Date.now();
  const out: number[] = [];
  const frames = Math.ceil(LOOP_BUFFER_SPAN_MS / SATELLITE_FRAME_INTERVAL_MS) * 2;
  for (let i = frames; i >= 0; i -= 1) {
    out.push(anchor - i * SATELLITE_FRAME_INTERVAL_MS);
  }
  return out;
}

export class SatelliteCompositeLayer extends Layer<SatelliteCompositeLayerProps> {
  static override layerName = "SatelliteCompositeLayer";

  private _lastLoadingStateKey = "";
  private _lastRangesKey = "";
  /** Draw-loop gates: skip recomputing ranges / loading / flow schedules when
   * no frame store changed and the playhead stayed in the same frame slot. */
  private _lastDrawGateKey = "";
  private _serverFieldRequested = new Set<string>();

  private _drawGateKey(state: CompositorState, timelineMs: number): string {
    let revisions = "";
    for (const entry of state.entries) revisions += `${entry.frameStore.revision()},`;
    return `${revisions}${Math.floor(timelineMs / SATELLITE_FRAME_INTERVAL_MS)}`;
  }

  override initializeState(): void {
    const device = this.context.device;
    this.getAttributeManager()?.remove(["instancePickingColors"]);

    const fallbackTexture = createFallbackTexture(device);

    const uniforms: Record<string, unknown> = {
      uMercBounds: [0, 0, 0, 0],
      uEarthRadius: EARTH_RADIUS_M,
      uSatParams: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uSatFeather: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uPrevBounds: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uNextBounds: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uGlobalFlow: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uIncomingGlobalFlow: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uOutgoingGlobalFlow: new Array(SHADER_SATELLITE_SLOTS * 4).fill(0),
      uSatCount: 0,
      uSatOpacity: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasPrevTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasNextTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasFlowTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasBgMask: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uRequiresStableVisibleLight: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uTimeProgress: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uMaxFlowUv: MAX_FLOW_UV,
      uSunCartesian: sunCartesianAt(Number.isFinite(this.props.timelineMs) ? this.props.timelineMs! : null),
    };

    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: "triangle-strip" as never,
      vertexCount: 4,
      geometry: createInitialCompositeGeometry(),
      uniforms,
      disableWarnings: false,
      parameters: {
        blend: true,
        blendColorSrcFactor: "src-alpha",
        blendColorDstFactor: "one-minus-src-alpha",
      } as never,
    });

    const entries = this.props.satellites
      .slice(0, maxSatellitesForQuality(normalizeQuality(this.props.quality)))
      .map((config) => this._createEntry(config, device));

    this.setState({
      model,
      flowPipeline: new FlowPipeline(device),
      entries,
      fallbackTexture,
      device,
      anyTextureLoaded: false,
      started: false,
      loading: true,
      uniforms,
      timelineMs: Number.isFinite(this.props.timelineMs) ? this.props.timelineMs! : null,
      timeProgressValue: Math.max(0, Math.min(1, Number.isFinite(this.props.timeProgress) ? this.props.timeProgress : 0)),
      geometryKey: null,
      pairGlobalFlows: new Map(),
      idlePumpHandle: null,
      lastViewMercBounds: null,
    });
  }

  private _createEntry(config: SatelliteCompositeConfig, device: Device): SatEntry {
    const availableTimesMs = availableTimesFor(config);
    return {
      config,
      availableTimesMs,
      frameStore: new FrameStore({
        satelliteId: config.id,
        wmsUrlTemplate: config.wmsUrlTemplate,
        availableTimesMs,
        frameIntervalMs: SATELLITE_FRAME_INTERVAL_MS,
        fetchFrame: createGpuFetchFrame(device),
        onChange: () => {
          const state = this.state as unknown as CompositorState | undefined;
          if (state) state.anyTextureLoaded = true;
          this._emitBufferedRanges();
          this.setNeedsRedraw();
        },
      }),
    };
  }

  setWmsUrlTemplates(templates: Record<string, string>): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;

    for (const entry of state.entries) {
      const nextTemplate = templates[entry.config.id];
      if (nextTemplate !== undefined && nextTemplate !== entry.config.wmsUrlTemplate) {
        entry.config = { ...entry.config, wmsUrlTemplate: nextTemplate };
        entry.availableTimesMs = availableTimesFor(entry.config);
        entry.frameStore.setTemplate(nextTemplate, entry.availableTimesMs);
      }
    }
    this.setNeedsRedraw();
  }

  setTimeProgress(value: number): void {
    if (!this.state) return;
    const state = this.state as unknown as CompositorState;
    state.timeProgressValue = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    this.setNeedsRedraw();
  }

  setTimelineMs(value: number): void {
    if (!this.state) return;
    const state = this.state as unknown as CompositorState;
    state.timelineMs = Number.isFinite(value) ? value : null;
    this.setNeedsRedraw();
  }

  setTimelineSample(progress: number, timelineMs: number): void {
    if (!this.state) return;
    const state = this.state as unknown as CompositorState;
    state.timeProgressValue = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
    state.timelineMs = Number.isFinite(timelineMs) ? timelineMs : null;
    this.setNeedsRedraw();
  }

  private _motionFieldFor(state: CompositorState, entry: SatEntry, timelineMs: number): MotionField | null {
    const pair = entry.frameStore.framesAt(timelineMs);
    if (!pair || pair.next.timeMs <= pair.prev.timeMs) return null;
    const pixels = state.flowPipeline?.readMotionPixels(pairKeyOf(pair.prev, pair.next));
    if (!pixels) return null;
    return {
      ...pixels,
      mercBounds: pair.prev.mercBounds,
      intervalMs: pair.next.timeMs - pair.prev.timeMs,
    };
  }

  /** AMV-style motion vectors for the current view, gated by confidence,
   * occlusion, and cloud probability. Static per satellite scene. */
  getMotionVectors(maxCount = 512): MotionVectorSample[] {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries || !state.lastViewMercBounds) return [];
    const timelineMs = state.timelineMs ?? Date.now();
    const bounds = state.lastViewMercBounds;
    const viewWidth = Math.max(1, Math.abs(bounds[2] - bounds[0]));
    const aspect = Math.abs(bounds[3] - bounds[1]) / viewWidth;

    const out: MotionVectorSample[] = [];
    for (const entry of state.entries) {
      const field = this._motionFieldFor(state, entry, timelineMs);
      if (!field) continue;
      // Zoom-adaptive density: never place more than one arrow per two flow
      // texels across the view, so zoomed-in views show fewer, meaningful
      // vectors instead of duplicated neighbors; zoomed-out views fill in.
      const frameWidth = Math.max(1, Math.abs(field.mercBounds[2] - field.mercBounds[0]));
      const texelsAcrossView = field.width * (viewWidth / frameWidth);
      const cols = Math.max(6, Math.min(32, Math.floor(texelsAcrossView / 2)));
      const rows = Math.max(4, Math.min(24, Math.round(cols * aspect)));
      out.push(...sampleMotionGrid(field, {
        viewMercBounds: bounds,
        cols,
        rows,
        maxCount: Math.max(0, maxCount - out.length),
      }));
      if (out.length >= maxCount) break;
    }
    return out;
  }

  /** Point interrogation of derived cloud motion at a lon/lat. */
  probeMotionAt(lon: number, lat: number): {
    speedMps: number;
    speedKmh: number;
    bearingDeg: number;
    bearingCardinal: string;
    confidence: number;
    cloudProbability: number;
    satelliteId: string;
    validTime: string;
  } | null {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return null;
    const timelineMs = state.timelineMs ?? Date.now();
    const [mercX, mercY] = lonLatToMercator(lon, lat);

    for (const entry of state.entries) {
      const field = this._motionFieldFor(state, entry, timelineMs);
      if (!field) continue;
      const sample = decodeMotionSample(field, mercX, mercY);
      if (!sample) continue;
      return {
        speedMps: sample.speedMps,
        speedKmh: sample.speedMps * 3.6,
        bearingDeg: sample.bearingFromDeg,
        bearingCardinal: bearingToCardinal(sample.bearingFromDeg),
        confidence: sample.confidence,
        cloudProbability: sample.cloudProbability,
        satelliteId: entry.config.id,
        validTime: new Date(timelineMs).toISOString(),
      };
    }
    return null;
  }

  getBufferedRanges(): BufferedRange[] {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries || state.entries.length === 0) return [];
    return intersectBufferedRanges(
      state.entries.map((entry) => entry.frameStore.getBufferedRanges()),
      SATELLITE_FRAME_INTERVAL_MS,
    );
  }

  whenTimeBuffered(timeMs: number): Promise<void> {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return Promise.resolve();
    return Promise.all(state.entries.map((entry) => entry.frameStore.whenTimeBuffered(timeMs))).then(() => undefined);
  }

  private _emitBufferedRanges(): void {
    const ranges = this.getBufferedRanges();
    const key = ranges.map((r) => `${r.startMs}-${r.endMs}`).join("|");
    if (key === this._lastRangesKey) return;
    this._lastRangesKey = key;
    this.props.onBufferedRangesChange?.(ranges);
  }

  override updateState(params: UpdateParameters<Layer<SatelliteCompositeLayerProps>>): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;

    const nextQuality = normalizeQuality(params.props.quality);
    const prevQuality = normalizeQuality(params.oldProps.quality);

    if (params.props.timeProgress !== params.oldProps.timeProgress) {
      this.setTimeProgress(params.props.timeProgress);
    }
    if (params.props.timelineMs !== params.oldProps.timelineMs) {
      this.setTimelineMs(params.props.timelineMs ?? Number.NaN);
    }

    if (params.props.satellites === params.oldProps.satellites && nextQuality === prevQuality) return;

    const newSats = params.props.satellites.slice(0, maxSatellitesForQuality(nextQuality));
    const oldById = new Map(state.entries.map((entry) => [entry.config.id, entry]));

    for (const old of state.entries) {
      if (!newSats.some((satellite) => satellite.id === old.config.id)) {
        old.frameStore.destroy();
      }
    }

    state.entries = newSats.map((config) => {
      const old = oldById.get(config.id);
      if (!old) return this._createEntry(config, state.device!);
      old.config = config;
      old.availableTimesMs = availableTimesFor(config);
      old.frameStore.setTemplate(config.wmsUrlTemplate, old.availableTimesMs);
      return old;
    });

    if (!state.started) state.loading = true;
    this.setNeedsRedraw();
  }

  private _pairGlobalFlow(state: CompositorState, prev: StoredFrame, next: StoredFrame): [number, number, number, number] {
    const key = pairKeyOf(prev, next);
    const cached = state.pairGlobalFlows.get(key);
    if (cached) return cached;
    const flow = estimateGlobalFlow(getMotionSample(prev.texture), getMotionSample(next.texture));
    state.pairGlobalFlows.set(key, flow);
    if (state.pairGlobalFlows.size > 256) {
      // Drop oldest entries opportunistically.
      const first = state.pairGlobalFlows.keys().next().value;
      if (first !== undefined) state.pairGlobalFlows.delete(first);
    }
    return flow;
  }

  private _scheduleFlow(state: CompositorState, timelineMs: number): void {
    if (!state.flowPipeline) return;

    const requests: FlowPairRequest[] = [];
    const keepPairs = new Set<string>();
    const keepSequences = new Set<string>();

    for (const entry of state.entries) {
      const frames = entry.frameStore.activeFrames();
      const sequenceKey = `${entry.config.id}|${entry.frameStore.activeGridKey() ?? ""}`;
      keepSequences.add(sequenceKey);
      const visible = isVisibleSatelliteMotionSource(entry.config.id);

      for (const [prev, next] of selectFlowPairCandidates(frames)) {
        const key = pairKeyOf(prev, next);
        keepPairs.add(key);
        const globalFlow = this._pairGlobalFlow(state, prev, next);
        const gpuPrev = prev.texture as GpuFrameTexture;
        const gpuNext = next.texture as GpuFrameTexture;
        if (!gpuPrev.gpuTexture || !gpuNext.gpuTexture) continue;
        requests.push({
          key,
          sequenceKey,
          prevTexture: gpuPrev.gpuTexture,
          nextTexture: gpuNext.gpuTexture,
          prevTimeMs: prev.timeMs,
          nextTimeMs: next.timeMs,
          mercWidthM: Math.abs(prev.mercBounds[2] - prev.mercBounds[0]),
          globalFlow: [globalFlow[0], globalFlow[1], globalFlow[2]],
          visibleProduct: visible,
        });
      }
    }

    state.flowPipeline.prune(keepPairs, keepSequences);
    state.flowPipeline.schedule(requests, timelineMs);

    // Server-side shared motion field: authoritative IR-derived flow per
    // pair, fetched in parallel with (and replacing) local GPU estimation.
    for (const request of requests) {
      if (this._serverFieldRequested.has(request.key)) continue;
      const satellite = motionSatelliteFor(request.sequenceKey);
      if (!satellite) continue;
      this._serverFieldRequested.add(request.key);
      if (this._serverFieldRequested.size > 256) this._serverFieldRequested.clear();
      const prevBounds = state.entries
        .flatMap((e) => e.frameStore.activeFrames())
        .find((f) => f.timeMs === request.prevTimeMs)?.mercBounds;
      const url = motionFieldUrl({
        satellite,
        mercBounds: prevBounds ?? [0, 0, 1, 1],
        t0Ms: request.prevTimeMs,
        t1Ms: request.nextTimeMs,
      });
      void fetchMotionField(url).then((field) => {
        if (!field) return;
        if (state.flowPipeline?.adoptServerField(request.key, field)) {
          this.setNeedsRedraw();
        }
      });
    }

    // One unit of GPU work per draw keeps the frame budget intact; the idle
    // loop drains the rest of the queue between draws.
    state.flowPipeline.pump();
    this._ensureIdlePump(state);
  }

  private _ensureIdlePump(state: CompositorState): void {
    if (state.idlePumpHandle !== null || !state.flowPipeline?.hasPendingWork()) return;
    state.idlePumpHandle = window.setTimeout(() => {
      state.idlePumpHandle = null;
      if (state.flowPipeline?.pump()) {
        this.setNeedsRedraw();
        this._ensureIdlePump(state);
      }
    }, 0);
  }

  override draw(opts: { context: { viewport: unknown }; renderPass: unknown }): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;

    const { context, renderPass } = opts;
    const viewport = context.viewport as {
      getBounds: () => [number, number, number, number];
      width: number;
      height: number;
      unproject?: (xy: [number, number]) => number[] | null;
    };

    const quality = normalizeQuality(this.props.quality);
    const meshSegments = viewportMeshSegmentsForQuality(quality);
    const maxSatellites = maxSatellitesForQuality(quality);

    const mercBounds = mercatorBoundsFromViewport(viewport);
    state.lastViewMercBounds = mercBounds;
    const geometryKey = viewportGeometryKey(viewport as never, mercBounds, meshSegments);
    const [texW, texH] = viewportTexDimensions(viewport, {
      fetchPadding: fetchPaddingForQuality(quality),
      maxTexDim: maxTextureDimForQuality(quality),
    });

    const timelineMs = state.timelineMs ?? Date.now();
    const activeEntries = state.entries.slice(0, Math.min(maxSatellites, SHADER_SATELLITE_SLOTS));

    for (const entry of activeEntries) {
      entry.frameStore.update({
        viewBounds: mercBounds,
        playheadMs: timelineMs,
        loopStartMs: timelineMs - LOOP_BUFFER_SPAN_MS / 2,
        loopEndMs: timelineMs + LOOP_BUFFER_SPAN_MS / 2,
        texSize: [texW, texH],
      });
    }

    // Ranges, loading state, and flow scheduling only change when a frame
    // store mutates or the playhead crosses a frame slot — not per display
    // frame. Skipping them here removes all per-draw allocation and sorting
    // during steady playback.
    const gateKey = this._drawGateKey(state, timelineMs);
    if (gateKey !== this._lastDrawGateKey) {
      this._lastDrawGateKey = gateKey;
      this._scheduleFlow(state, timelineMs);
      this._emitBufferedRanges();
      this._emitLoadingState(state, activeEntries, timelineMs);
    } else if (state.flowPipeline?.hasPendingWork()) {
      state.flowPipeline.pump();
      this._ensureIdlePump(state);
    }

    if (!state.model || !state.anyTextureLoaded) return;

    if (state.geometryKey !== geometryKey) {
      state.model.setGeometry(createViewportGeometry(viewport, mercBounds, meshSegments));
      state.geometryKey = geometryKey;
    }

    const satParams: number[] = [];
    const satFeather: number[] = [];
    const prevBounds: number[] = [];
    const nextBounds: number[] = [];
    const globalFlowU: number[] = [];
    const incomingGlobalFlow: number[] = [];
    const outgoingGlobalFlow: number[] = [];
    const satOpacity: number[] = [];
    const hasPrevTex: number[] = [];
    const hasNextTex: number[] = [];
    const hasFlowTex: number[] = [];
    const hasBgMask: number[] = [];
    const requiresStableVisibleLight: number[] = [];
    const timeProgress: number[] = [];
    const bindings: Record<string, Texture> = {};

    for (let i = 0; i < SHADER_SATELLITE_SLOTS; i += 1) {
      const entry = activeEntries[i];
      const pair = entry ? entry.frameStore.framesAt(timelineMs) : null;

      if (entry && pair) {
        const { prev, next } = pair;
        const animated = next.timeMs > prev.timeMs;
        // Raw, unclamped ratio: the morph shader handles phase<0 (backward) and
        // phase>1 (continuous live-edge extrapolation) deliberately, so do NOT
        // clamp here — clamping freezes motion at the live edge.
        const phase = animated
          ? (timelineMs - prev.timeMs) / (next.timeMs - prev.timeMs)
          : 0;

        const pairFlowKey = animated ? pairKeyOf(prev, next) : null;
        const flowResult = pairFlowKey && state.flowPipeline ? state.flowPipeline.get(pairFlowKey) : null;
        const globalFlow = animated ? this._pairGlobalFlow(state, prev, next) : [0, 0, 0, 0];

        // Neighbor pairs for C1 velocity continuity at keyframes. The cached
        // sorted list + binary search keep this O(log n) per draw.
        const frames = entry.frameStore.activeFrames();
        const prevIndex = indexOfFrameTime(frames, prev.timeMs);
        const incoming = prevIndex > 0 && animated && frames[prevIndex].gridKey === prev.gridKey
          ? this._pairGlobalFlow(state, frames[prevIndex - 1], prev)
          : [0, 0, 0, 0];
        const nextIndex = indexOfFrameTime(frames, next.timeMs);
        const outgoing = nextIndex >= 0 && nextIndex + 1 < frames.length && animated && frames[nextIndex].gridKey === next.gridKey
          ? this._pairGlobalFlow(state, next, frames[nextIndex + 1])
          : [0, 0, 0, 0];

        const [sx, sy, sz] = subPointCartesian(entry.config.subPoint[0], entry.config.subPoint[1]);
        const chord = chordParams(entry.config.coverageRadiusDeg, entry.config.featherRadiusDeg);

        satParams.push(sx, sy, sz, chord.maxChord);
        satFeather.push(chord.featherStartChord);
        prevBounds.push(...prev.mercBounds);
        nextBounds.push(...next.mercBounds);
        globalFlowU.push(...globalFlow);
        incomingGlobalFlow.push(...incoming);
        outgoingGlobalFlow.push(...outgoing);
        satOpacity.push(entry.config.opacity);
        hasPrevTex.push(1);
        hasNextTex.push(1);
        hasFlowTex.push(flowResult ? 1 : 0);
        hasBgMask.push(flowResult?.bgMaskTexture ? 1 : 0);
        requiresStableVisibleLight.push(isVisibleSatelliteMotionSource(entry.config.id) ? 1 : 0);
        timeProgress.push(animated ? phase : 0);

        bindings[`uPrevTex${i}`] = (prev.texture as GpuFrameTexture).gpuTexture;
        bindings[`uNextTex${i}`] = (next.texture as GpuFrameTexture).gpuTexture;
        bindings[`uFlowTex${i}`] = flowResult?.flowTexture ?? state.fallbackTexture!;
        bindings[`uBgMaskTex${i}`] = flowResult?.bgMaskTexture ?? state.fallbackTexture!;
      } else {
        satParams.push(0, 0, 0, 0);
        satFeather.push(0);
        prevBounds.push(0, 0, 1, 1);
        nextBounds.push(0, 0, 1, 1);
        globalFlowU.push(0, 0, 0, 0);
        incomingGlobalFlow.push(0, 0, 0, 0);
        outgoingGlobalFlow.push(0, 0, 0, 0);
        satOpacity.push(0);
        hasPrevTex.push(0);
        hasNextTex.push(0);
        hasFlowTex.push(0);
        hasBgMask.push(0);
        requiresStableVisibleLight.push(0);
        timeProgress.push(0);

        bindings[`uPrevTex${i}`] = state.fallbackTexture!;
        bindings[`uNextTex${i}`] = state.fallbackTexture!;
        bindings[`uFlowTex${i}`] = state.fallbackTexture!;
        bindings[`uBgMaskTex${i}`] = state.fallbackTexture!;
      }
    }

    const uniforms = state.uniforms!;
    uniforms.uMercBounds = mercBounds;
    uniforms.uSatParams = satParams;
    uniforms.uSatFeather = satFeather;
    uniforms.uPrevBounds = prevBounds;
    uniforms.uNextBounds = nextBounds;
    uniforms.uGlobalFlow = globalFlowU;
    uniforms.uIncomingGlobalFlow = incomingGlobalFlow;
    uniforms.uOutgoingGlobalFlow = outgoingGlobalFlow;
    uniforms.uSatCount = Math.min(activeEntries.length, SHADER_SATELLITE_SLOTS);
    uniforms.uSatOpacity = satOpacity;
    uniforms.uHasPrevTex = hasPrevTex;
    uniforms.uHasNextTex = hasNextTex;
    uniforms.uHasFlowTex = hasFlowTex;
    uniforms.uHasBgMask = hasBgMask;
    uniforms.uRequiresStableVisibleLight = requiresStableVisibleLight;
    uniforms.uTimeProgress = timeProgress;
    uniforms.uMaxFlowUv = MAX_FLOW_UV;
    uniforms.uSunCartesian = sunCartesianAt(timelineMs);

    if (typeof window !== "undefined") {
      (window as unknown as Record<string, unknown>).__canwxFlowDebug = {
        hasFlowTex: hasFlowTex.slice(),
        globalFlow: globalFlowU.slice(0, 4),
        timeProgress: timeProgress.slice(),
        pairs: activeEntries.map((entry) => {
          const pair = entry.frameStore.framesAt(timelineMs);
          if (!pair) return { id: entry.config.id, pair: null };
          const key = pairKeyOf(pair.prev, pair.next);
          return {
            id: entry.config.id,
            key,
            animated: pair.next.timeMs > pair.prev.timeMs,
            flowStatus: state.flowPipeline?.status(key) ?? null,
            serverField: state.flowPipeline?.isServerField(key) ?? false,
            serverRequested: this._serverFieldRequested.has(key),
            frames: entry.frameStore.activeFrames().length,
          };
        }),
      };
    }

    try {
      state.model.setBindings(bindings as never);
      (state.model as never as { setUniforms?: (u: Record<string, unknown>) => void }).setUniforms?.(uniforms);
      state.model.draw(renderPass as never);
    } catch (err) {
      logManager.warn("satellite", "Composite draw failed; possible WebGL context loss", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  override finalizeState(): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state) return;

    if (state.idlePumpHandle !== null) {
      window.clearTimeout(state.idlePumpHandle);
      state.idlePumpHandle = null;
    }
    for (const entry of state.entries ?? []) entry.frameStore.destroy();
    state.flowPipeline?.destroy();
    state.fallbackTexture?.destroy();
    state.model?.destroy();

    state.flowPipeline = null;
    state.fallbackTexture = null;
    state.model = null;
    state.entries = [];
    state.started = false;
    state.loading = true;
  }

  private _emitLoadingState(state: CompositorState, activeEntries: SatEntry[], timelineMs: number): void {
    const inFlightFrames = activeEntries.reduce((sum, e) => sum + e.frameStore.inFlightCount(), 0);
    const pendingFlows = state.flowPipeline?.hasPendingWork() ? 1 : 0;
    const ranges = this.getBufferedRanges();
    const playheadBuffered = ranges.some((r) =>
      timelineMs >= r.startMs - SATELLITE_FRAME_INTERVAL_MS && timelineMs <= r.endMs + SATELLITE_FRAME_INTERVAL_MS,
    );

    const readySatellites = activeEntries.filter((e) => e.frameStore.getBufferedRanges().length > 0).length;
    const totalSatellites = activeEntries.length;

    // Honest progress: count buffered frames inside the prefetch window around
    // the playhead against the number of frames the window actually wants.
    // The old requiredFrames = satellite count made the bar jump 0 → 100.
    const half = LOOP_BUFFER_SPAN_MS / 2;
    let bufferedFrames = 0;
    let requiredFrames = 0;
    for (const entry of activeEntries) {
      const wanted = entry.availableTimesMs.filter(
        (t) => t >= timelineMs - half && t <= timelineMs + half,
      ).length;
      requiredFrames += Math.max(1, wanted);
      bufferedFrames += entry.frameStore.activeFrames().filter(
        (f) => f.timeMs >= timelineMs - half && f.timeMs <= timelineMs + half,
      ).length;
    }

    if (!state.started && readySatellites > 0) {
      state.started = true;
    }
    const loading = totalSatellites > 0 && (!playheadBuffered || readySatellites < totalSatellites);
    state.loading = loading;

    let phase: SatelliteCompositeLoadingState["phase"] = "idle";
    if (!loading && readySatellites >= totalSatellites && totalSatellites > 0) {
      phase = "ready";
    } else if (inFlightFrames > 0) {
      phase = "fetching";
    } else if (pendingFlows > 0) {
      phase = "computing-flow";
    }

    const missingSatellites = Math.max(0, totalSatellites - readySatellites);
    const fetchEstimate = inFlightFrames > 0 ? inFlightFrames * 3 + missingSatellites * 2 : 0;
    const estimatedSecondsRemaining = fetchEstimate > 0 ? Math.ceil(fetchEstimate) : null;

    const key = `${loading}|${readySatellites}|${totalSatellites}|${bufferedFrames}|${requiredFrames}|${phase}|${inFlightFrames}|${pendingFlows}`;
    if (key === this._lastLoadingStateKey) return;
    this._lastLoadingStateKey = key;

    this.props.onLoadingStateChange?.({
      loading,
      started: state.started,
      readySatellites,
      totalSatellites,
      bufferedFrames,
      requiredFrames,
      phase,
      inFlightFrames,
      pendingFlows,
      estimatedSecondsRemaining,
    });
  }
}

export function createSatelliteCompositeLayer(configs: {
  satellites: SatelliteCompositeConfig[];
  timeProgress?: number;
  timelineMs?: number;
  quality?: RenderQualityPreset;
  id?: string;
  onLoadingStateChange?: (state: SatelliteCompositeLoadingState) => void;
  onBufferedRangesChange?: (ranges: BufferedRange[]) => void;
}): SatelliteCompositeLayer | null {
  if (configs.satellites.length === 0) return null;

  const quality = normalizeQuality(configs.quality);

  return new SatelliteCompositeLayer({
    id: configs.id ?? "satellite-composite",
    satellites: configs.satellites.slice(0, maxSatellitesForQuality(quality)),
    timeProgress: configs.timeProgress ?? 0,
    timelineMs: configs.timelineMs,
    quality,
    pickable: false,
    onLoadingStateChange: configs.onLoadingStateChange,
    onBufferedRangesChange: configs.onBufferedRangesChange,
  });
}

export function getSatelliteDiskParams(layerId: string): SatelliteDiskParams | null {
  const params = GEOSTATIONARY_SATELLITES[layerId];
  if (!params) return null;
  return { ...params };
}

export function isGeostationarySatellite(layerId: string): boolean {
  return layerId in GEOSTATIONARY_SATELLITES;
}
