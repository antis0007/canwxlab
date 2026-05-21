/** GPU multi-texture satellite compositor with buffered temporal morphing.
 *
 * This layer still uses client-side motion heuristics as a fallback. The
 * production target is a server-derived motion product with QC and confidence
 * masks, but the browser path keeps playback usable when that product is not
 * available. Dense GPU flow is computed opportunistically for every adjacent
 * buffered pair; draw never waits for flow compilation or flow passes.
 */

import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";
import type { Device, Framebuffer, Texture } from "@luma.gl/core";
import type { RenderQualityPreset } from "../types";

import { API_BASE_URL } from "../../lib/api";
import { cachedGetImageBlob } from "../../lib/localCache";
import { logManager } from "../../lib/logging";
import { parseWmsTimeDimension } from "../../time/wmsTime";
import { subSolarPoint } from "./terminator";

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
  /** Current loading phase for honest user messaging */
  phase: "idle" | "fetching" | "computing-flow" | "ready";
  /** Number of in-flight frame downloads across all satellites */
  inFlightFrames: number;
  /** Number of optical-flow pairs still being computed */
  pendingFlows: number;
  /** Rough estimate of remaining wait in seconds, or null if unknown */
  estimatedSecondsRemaining: number | null;
}

interface SatelliteCompositeLayerProps extends LayerProps {
  satellites: SatelliteCompositeConfig[];
  timeProgress: number;
  timelineMs?: number;
  quality?: RenderQualityPreset;
  onLoadingStateChange?: (state: SatelliteCompositeLoadingState) => void;
}

interface MotionSample {
  width: number;
  height: number;
  luma: Float32Array;
}

interface SatelliteFrame {
  key: string;
  template: string;
  timeMs: number | null;
  mercBounds: [number, number, number, number];
  texture: Texture;
  motionSample: MotionSample | null;
  width: number;
  height: number;
  loadedAtMs: number;
}

interface FlowPairState {
  key: string;
  prevFrameKey: string;
  nextFrameKey: string;
  globalFlow: [number, number, number, number];
  motionSource: "ir-flow" | "visible-flow" | "temporal-fill";
  motionConfidence: number;
  motionFlags: {
    nearTerminator: boolean;
    suspectIlluminationChange: boolean;
  };
  flowTexture: Texture | null;
  flowScratchTexture: Texture | null;
  flowFramebuffer: Framebuffer | null;
  flowScratchFramebuffer: Framebuffer | null;
  coarseFlowTexture: Texture | null;
  coarseFlowFBO: Framebuffer | null;
  flowSize: [number, number] | null;
  coarseFlowSize: [number, number] | null;
  status: "pending" | "computing" | "ready" | "failed";
  lastError: string | null;
}

interface InFlightFrameRequest {
  key: string;
  template: string;
  url: string;
  controller: AbortController;
  timer: number | null;
  requestId: number;
}

interface SatEntry {
  config: SatelliteCompositeConfig;
  frames: SatelliteFrame[];
  flows: FlowPairState[];
  inFlight: Map<string, InFlightFrameRequest>;
  failedUrls: Map<string, number>;
  loadingMercBounds: [number, number, number, number] | null;
  bufferFetchMercBounds: [number, number, number, number] | null;
  lastTemplateTimeMs: number | null;
  loadError: boolean;
  requestId: number;
  activePairKey: string | null;
  activePairStartedMs: number;
  flowComputeTimer: number | null;
  // Pair transition smoothing: when activePairKey changes, lerp uniforms
  // from the old pair's values to the new pair's over ~400ms to hide
  // flow-field discontinuities at satellite frame boundaries.
  prevPairGlobalFlow: [number, number, number, number];
  prevPairHasFlowTex: number;
  pairTransitionStartMs: number;
}

interface CompositorState {
  model: Model | null;
  flowModel: Model | null;
  entries: SatEntry[];
  fallbackTexture: Texture | null;
  device: Device | null;
  lastFetchMercBounds: [number, number, number, number] | null;
  anyTextureLoaded: boolean;
  started: boolean;
  loading: boolean;
  uniforms: Record<string, unknown> | null;
  flowUniforms: Record<string, unknown> | null;
  timelineMs: number | null;
  timeProgressValue: number;
  timeProgress: number[];
  geometryKey: string | null;
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

const SHADER_SATELLITE_SLOTS = 4;
const ENABLE_DENSE_OPTICAL_FLOW = true;

const FLOW_TEX_DIM = 512;
const COARSE_FLOW_DIM = 128;
const MAX_FLOW_UV = 0.25;
const MOTION_SAMPLE_DIM = 256;
const MOTION_SEARCH_RADIUS_PX = 10;
const MAX_GLOBAL_FLOW_UV = 0.11;
const VISIBLE_MOTION_START_SIN_ELEV = 0.13917; // sin(8 deg)
const VISIBLE_MOTION_FULL_SIN_ELEV = 0.30902; // sin(18 deg)
const VISIBLE_MOTION_MIN_TRUST = 0.65;

const PRELOAD_LOOKBEHIND_FRAMES = 1;
const PRELOAD_AHEAD_FRAMES = 4;
const MIN_START_BUFFER_FRAMES = 3;
const MIN_STEADY_BUFFER_FRAMES = 2;
const MAX_RETAINED_FRAMES = 8;
const FLOW_COMPUTE_DELAY_MS = 0;

const REFETCH_THRESHOLD = 0.15;
const FETCH_STAGGER_MS = 140;
const RETRY_DELAYS_MS = [500, 1500, 4500];
const FAILED_URL_COOLDOWN_MS = 5 * 60 * 1000;
const SATELLITE_FRAME_INTERVAL_MS = 10 * 60 * 1000;
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

const FLOW_VS = `\
#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
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
uniform sampler2D uPrevTex3;
uniform sampler2D uNextTex0;
uniform sampler2D uNextTex1;
uniform sampler2D uNextTex2;
uniform sampler2D uNextTex3;
uniform sampler2D uFlowTex0;
uniform sampler2D uFlowTex1;
uniform sampler2D uFlowTex2;
uniform sampler2D uFlowTex3;
uniform vec4 uMercBounds;
uniform float uEarthRadius;
uniform vec4 uSatParams[4];
uniform float uSatFeather[4];
uniform vec4 uPrevBounds[4];
uniform vec4 uNextBounds[4];
uniform vec4 uGlobalFlow[4];
uniform int uSatCount;
uniform float uSatOpacity[4];
uniform float uHasPrevTex[4];
uniform float uHasNextTex[4];
uniform float uHasFlowTex[4];
uniform float uRequiresStableVisibleLight[4];
uniform float uTimeProgress[4];
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
  if (idx == 2) return texture(uPrevTex2, uv);
  return texture(uPrevTex3, uv);
}

vec4 sampleNextTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uNextTex0, uv);
  if (idx == 1) return texture(uNextTex1, uv);
  if (idx == 2) return texture(uNextTex2, uv);
  return texture(uNextTex3, uv);
}

vec4 sampleFlowTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uFlowTex0, uv);
  if (idx == 1) return texture(uFlowTex1, uv);
  if (idx == 2) return texture(uFlowTex2, uv);
  return texture(uFlowTex3, uv);
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

vec4 sampleMorph(int idx, vec2 merc, vec2 screenUv) {
  bool hasPrev = uHasPrevTex[idx] > 0.5;
  bool hasNext = uHasNextTex[idx] > 0.5;
  vec2 prevUv = mercToTexUv(merc, uPrevBounds[idx]);
  vec2 nextUv = mercToTexUv(merc, uNextBounds[idx]);
  bool prevInside = hasPrev && uvInside(prevUv);
  bool nextInside = hasNext && uvInside(nextUv);

  if (!prevInside && !nextInside) return vec4(0.0);
  if (prevInside && !nextInside) return cleanTexel(samplePrevTex(idx, prevUv));
  if (!prevInside && nextInside) return cleanTexel(sampleNextTex(idx, nextUv));

  float phase = uTimeProgress[idx];
  if (phase < 0.0) {
    vec4 globalMotion = uGlobalFlow[idx];
    vec2 backFlow = globalMotion.xy;
    // Continuous backward advection — no min() cap, consistent with forward path
    return cleanTexel(samplePrevTex(idx, clamp(prevUv + backFlow * (-phase), vec2(0.0), vec2(1.0))));
  }

  // Continuous extrapolation past the latest frame — no fract() wrapping.
  // The old fract(extrapolated) caused the advection to reset every full
  // interval, creating a cyclic "breathing" artifact. Now clouds keep
  // drifting in the same direction until they hit the texture edge.
  float extrapolated = max(phase - 1.0, 0.0);
  if (extrapolated > 0.0) {
    vec4 globalMotion = uGlobalFlow[idx];
    vec2 forwardFlow = globalMotion.xy * (1.0 + extrapolated);
    return cleanTexel(sampleNextTex(idx, clamp(nextUv - forwardFlow, vec2(0.0), vec2(1.0))));
  }

  // Linear interpolation preserves constant-velocity cloud advection.
  // Smoothstep was removed: its zero-derivative at endpoints causes
  // visible pauses at every keyframe — real clouds don't decelerate
  // when approaching a satellite capture time.
  float t = clamp(phase, 0.0, 1.0);

  vec4 globalMotion = uGlobalFlow[idx];
  vec2 globalFlowUV = globalMotion.xy;
  float motionTrust = mix(1.0, stableDaylightMotionTrust(merc), uRequiresStableVisibleLight[idx]);
  float globalConf = clamp(globalMotion.z, 0.0, 1.0) * motionTrust;

  // Single-frame advection: warp the prev frame forward by flow * t.
  // Optical flow alone creates intermediate frames — no cross-fade needed
  // across most of the cycle. This eliminates the double-image artifact
  // that made keyframes visible as "noise" or "blur" at mid-cycle.
  //
  // Only near the next keyframe (last 15% of the interval) do we introduce
  // a narrow correction blend to the actual next frame, correcting any
  // accumulated flow errors before the pair switch.
  float flowBlend = uHasFlowTex[idx];
  vec2 flowUV = globalFlowUV;
  if (flowBlend > 0.001) {
    vec4 packed = sampleFlowTex(idx, screenUv);
    float denseConf = clamp(packed.b, 0.0, 1.0);
    vec2 denseScreen = (packed.rg - vec2(0.5)) * (uMaxFlowUv * 2.0);

    vec2 screenSpan = uMercBounds.zw - uMercBounds.xy;
    vec2 prevSpan = max(uPrevBounds[idx].zw - uPrevBounds[idx].xy, vec2(1.0));
    vec2 mercFlow = denseScreen * screenSpan;

    float denseWeight = smoothstep(0.08, 0.50, denseConf);
    denseWeight = max(denseWeight, globalConf * 0.05);
    denseWeight *= flowBlend;
    flowUV = mix(globalFlowUV, mercFlow / prevSpan, denseWeight);
  }
  flowUV *= motionTrust;

  // Warp the prev frame forward: flowUV pixels per full interval,
  // scaled by t for the current fraction of the interval.
  vec2 warpedUv = prevUv - flowUV * t;
  vec4 result = cleanTexel(samplePrevTex(idx, clamp(warpedUv, vec2(0.0), vec2(1.0))));

  // Correction zone: last 15% of the interval. Blend toward the
  // un-warped next frame so the pair transition is seamless (both
  // old and new pairs render the same frame at the boundary).
  // Quadratic ease-in: barely noticeable at t=0.85, reaches 100%
  // at t=1.0 where the pair switch occurs.
  if (t > 0.85 && hasNext) {
    float correction = (t - 0.85) / 0.15;
    correction = correction * correction; // quadratic ease-in
    vec4 nextSample = cleanTexel(sampleNextTex(idx, nextUv));
    result = mix(result, nextSample, correction);
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

  for (int i = 0; i < 4; i++) {
    if (i >= uSatCount) break;
    if (uHasPrevTex[i] < 0.5 && uHasNextTex[i] < 0.5) continue;

    vec3 subCart = uSatParams[i].xyz;
    float maxChord = uSatParams[i].w;
    float featherStart = uSatFeather[i];
    float chordDist = length(fragCart - subCart);
    float weight = 1.0 - smoothstep(featherStart, maxChord, chordDist);

    if (weight > 0.001) {
      vec4 texel = sampleMorph(i, merc, vUv);
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

const FLOW_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFlowPrevTex;
uniform sampler2D uFlowNextTex;
uniform sampler2D uFlowHistoryTex;
uniform sampler2D uInitialFlowTex;
uniform vec2 uTexelSize;
uniform float uFlowEncodeScale;
uniform float uHasFlowHistory;
uniform float uHasInitialFlow;

vec4 safeSample(sampler2D tex, vec2 uv) {
  return texture(tex, clamp(uv, vec2(0.0), vec2(1.0)));
}

float lumaOf(vec3 rgb) {
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

float validSignal(vec4 texel) {
  float luma = lumaOf(texel.rgb);
  float chroma = max(max(texel.r, texel.g), texel.b) - min(min(texel.r, texel.g), texel.b);
  float visible = smoothstep(0.010, 0.045, luma) + smoothstep(0.012, 0.070, chroma);
  return texel.a * clamp(visible, 0.0, 1.0);
}

float lumaAt(sampler2D tex, vec2 uv) {
  return lumaOf(safeSample(tex, uv).rgb);
}

void main() {
  vec2 initialFlow = vec2(0.0);
  float initialConfidence = 0.0;

  if (uHasInitialFlow > 0.5) {
    vec4 coarse = safeSample(uInitialFlowTex, vUv);
    initialFlow = (coarse.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);
    initialConfidence = coarse.b;
  }

  vec2 warpedPrevBase = vUv - initialFlow;

  float a00 = 0.0;
  float a01 = 0.0;
  float a11 = 0.0;
  float b0 = 0.0;
  float b1 = 0.0;
  float validitySum = 0.0;

  for (int y = -3; y <= 3; y++) {
    for (int x = -3; x <= 3; x++) {
      vec2 offset = vec2(float(x), float(y)) * uTexelSize;
      vec2 prevUv = warpedPrevBase + offset;
      vec2 nextUv = vUv + offset;
      vec4 prevTexel = safeSample(uFlowPrevTex, prevUv);
      vec4 nextTexel = safeSample(uFlowNextTex, nextUv);

      float radius2 = float(x * x + y * y);
      float gaussian = exp(-radius2 / 8.0);
      float validity = gaussian * min(validSignal(prevTexel), validSignal(nextTexel));

      float left = lumaAt(uFlowPrevTex, prevUv - vec2(uTexelSize.x, 0.0));
      float right = lumaAt(uFlowPrevTex, prevUv + vec2(uTexelSize.x, 0.0));
      float down = lumaAt(uFlowPrevTex, prevUv - vec2(0.0, uTexelSize.y));
      float up = lumaAt(uFlowPrevTex, prevUv + vec2(0.0, uTexelSize.y));

      float ix = (right - left) * 0.5;
      float iy = (up - down) * 0.5;
      float it = lumaOf(nextTexel.rgb) - lumaOf(prevTexel.rgb);

      float robust = inversesqrt(0.0004 + it * it);
      float w = validity * robust;

      a00 += ix * ix * w;
      a01 += ix * iy * w;
      a11 += iy * iy * w;
      b0 += -it * ix * w;
      b1 += -it * iy * w;
      validitySum += validity;
    }
  }

  float det = a00 * a11 - a01 * a01;
  float trace = a00 + a11;
  float cornerness = det / max(trace, 1e-6);

  float centerValidity = min(
    validSignal(safeSample(uFlowPrevTex, warpedPrevBase)),
    validSignal(safeSample(uFlowNextTex, vUv))
  );

  float confidence = centerValidity
    * smoothstep(0.0002, 0.012, trace)
    * smoothstep(0.000002, 0.00008, cornerness)
    * smoothstep(3.0, 18.0, validitySum)
    * step(0.0000005, abs(det));

  vec2 residualPx = vec2(0.0);
  if (confidence > 0.0) {
    residualPx = vec2((a11 * b0 - a01 * b1) / det, (-a01 * b0 + a00 * b1) / det);
  }

  vec2 residualUv = residualPx * uTexelSize;
  vec2 flowUv = clamp(initialFlow + residualUv, vec2(-uFlowEncodeScale), vec2(uFlowEncodeScale));

  if (uHasInitialFlow > 0.5 && initialConfidence > 0.25) {
    confidence = max(confidence, initialConfidence * 0.55);
  }

  if (uHasFlowHistory > 0.5 && confidence > 0.18) {
    vec4 history = safeSample(uFlowHistoryTex, vUv);
    if (history.b > 0.20) {
      vec2 historyFlow = (history.rg - vec2(0.5)) * (uFlowEncodeScale * 2.0);
      float agreement = dot(normalize(flowUv + vec2(1e-6)), normalize(historyFlow + vec2(1e-6))) * 0.5 + 0.5;
      float historyWeight = 0.25 * smoothstep(0.35, 0.95, agreement) * min(history.b, confidence);
      flowUv = mix(flowUv, historyFlow, historyWeight);
      confidence = max(confidence, history.b * 0.35);
    }
  }

  if (confidence > 0.20) {
    float prevLuma = lumaAt(uFlowPrevTex, warpedPrevBase);
    float forwardError = abs(prevLuma - lumaAt(uFlowNextTex, vUv + flowUv));
    float reverseError = abs(prevLuma - lumaAt(uFlowNextTex, vUv - flowUv));

    if (reverseError + 0.012 < forwardError) {
      flowUv = -flowUv;
      confidence *= 0.55;
    } else {
      confidence *= smoothstep(0.18, 0.018, forwardError);
    }
  }

  vec2 encoded = flowUv / (uFlowEncodeScale * 2.0) + vec2(0.5);
  fragColor = vec4(clamp(encoded, vec2(0.0), vec2(1.0)), clamp(confidence, 0.0, 1.0), 1.0);
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

export function isVisibleSatelliteMotionSource(layerId: string): boolean {
  const normalized = layerId.toLowerCase();
  return normalized.includes("natural") || normalized.includes("visible") || normalized.includes("_vis");
}

export function stableVisibleMotionTrustFromSolarElevation(sinElevation: number): number {
  if (!Number.isFinite(sinElevation)) return 0;
  // This daylight gate is a heuristic approximation, not a full solar
  // geometry/illumination validity mask. That mask belongs in preprocessing.
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

function solarElevationSinAtMercator(timeMs: number, mercX: number, mercY: number): number {
  const [sx, sy, sz] = sunCartesianAt(timeMs);
  const lon = (mercX / EARTH_RADIUS_M) / DEG_TO_RAD;
  const lat = (2 * Math.atan(Math.exp(mercY / EARTH_RADIUS_M)) - Math.PI / 2) / DEG_TO_RAD;
  const phi = lat * DEG_TO_RAD;
  const lambda = lon * DEG_TO_RAD;
  const x = Math.cos(phi) * Math.cos(lambda);
  const y = Math.cos(phi) * Math.sin(lambda);
  const z = Math.sin(phi);
  return x * sx + y * sy + z * sz;
}

function visibleMotionTrustForBounds(timeMs: number | null, bounds: [number, number, number, number]): number {
  if (timeMs === null || !Number.isFinite(timeMs)) return 1;
  const [west, south, east, north] = bounds;
  const cx = (west + east) * 0.5;
  const cy = (south + north) * 0.5;
  const points: [number, number][] = [
    [cx, cy],
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ];
  return points.reduce((minTrust, [x, y]) => {
    const trust = stableVisibleMotionTrustFromSolarElevation(solarElevationSinAtMercator(timeMs, x, y));
    return Math.min(minTrust, trust);
  }, 1);
}

function assessMotionPair(
  layerId: string,
  prev: SatelliteFrame,
  next: SatelliteFrame,
): {
  source: FlowPairState["motionSource"];
  confidence: number;
  allowsDenseFlow: boolean;
  flags: FlowPairState["motionFlags"];
} {
  const visible = isVisibleSatelliteMotionSource(layerId);
  if (!visible) {
    return {
      source: "ir-flow",
      confidence: 1,
      allowsDenseFlow: true,
      flags: { nearTerminator: false, suspectIlluminationChange: false },
    };
  }

  // This samples the frame bounds instead of a full per-pixel terminator mask.
  // It is sufficient for a browser-side fallback, but not the optimal path.
  const prevTrust = visibleMotionTrustForBounds(prev.timeMs, prev.mercBounds);
  const nextTrust = visibleMotionTrustForBounds(next.timeMs, next.mercBounds);
  const trust = Math.min(prevTrust, nextTrust);
  const nearTerminator = trust < VISIBLE_MOTION_MIN_TRUST;

  return {
    source: nearTerminator ? "temporal-fill" : "visible-flow",
    confidence: trust,
    allowsDenseFlow: trust >= VISIBLE_MOTION_MIN_TRUST,
    flags: {
      nearTerminator,
      suspectIlluminationChange: nearTerminator,
    },
  };
}

function maxSatellitesForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 1;
  if (quality === "quality") return 3;
  return 2;
}

function maxTextureDimForQuality(quality: RenderQualityPreset): number {
  if (quality === "performance") return 1024;
  if (quality === "quality") return 1600;
  return 1280;
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
  viewport: any,
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
  viewport: any,
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
  viewport: { width: number; height: number; getBounds: () => [number, number, number, number] },
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

function shouldRefetch(
  current: [number, number, number, number],
  last: [number, number, number, number] | null,
): boolean {
  if (!last) return true;

  const currentW = Math.abs(current[2] - current[0]);
  const currentH = Math.abs(current[3] - current[1]);
  const lastW = Math.abs(last[2] - last[0]);
  const lastH = Math.abs(last[3] - last[1]);

  if (currentW < 1000 || currentH < 1000) return false;

  const currentCx = (current[0] + current[2]) * 0.5;
  const currentCy = (current[1] + current[3]) * 0.5;
  const lastCx = (last[0] + last[2]) * 0.5;
  const lastCy = (last[1] + last[3]) * 0.5;

  return (
    Math.abs(currentCx - lastCx) > currentW * REFETCH_THRESHOLD ||
    Math.abs(currentCy - lastCy) > currentH * REFETCH_THRESHOLD ||
    Math.abs(currentW - lastW) > currentW * 0.25 ||
    Math.abs(currentH - lastH) > currentH * 0.25
  );
}

function expandMercatorBounds(
  bounds: [number, number, number, number],
  padding: number,
): [number, number, number, number] {
  const dx = Math.abs(bounds[2] - bounds[0]) * padding;
  const dy = Math.abs(bounds[3] - bounds[1]) * padding;
  return [bounds[0] - dx, bounds[1] - dy, bounds[2] + dx, bounds[3] + dy];
}

function boundsContain(
  outer: [number, number, number, number] | null,
  inner: [number, number, number, number],
): boolean {
  if (!outer) return false;

  const tolX = Math.max(1, Math.abs(inner[2] - inner[0]) * 0.002);
  const tolY = Math.max(1, Math.abs(inner[3] - inner[1]) * 0.002);

  return (
    inner[0] >= outer[0] - tolX &&
    inner[1] >= outer[1] - tolY &&
    inner[2] <= outer[2] + tolX &&
    inner[3] <= outer[3] + tolY
  );
}

function boundsEquivalent(
  a: [number, number, number, number] | null,
  b: [number, number, number, number] | null,
): boolean {
  if (!a || !b) return false;

  const width = Math.max(1, Math.abs(a[2] - a[0]));
  const height = Math.max(1, Math.abs(a[3] - a[1]));

  return (
    Math.abs(a[0] - b[0]) < width * 0.001 &&
    Math.abs(a[1] - b[1]) < height * 0.001 &&
    Math.abs(a[2] - b[2]) < width * 0.001 &&
    Math.abs(a[3] - b[3]) < height * 0.001
  );
}

function mercBoundsKey(bounds: [number, number, number, number]): string {
  return bounds.map((value) => value.toFixed(1)).join(",");
}

function frameKey(template: string, bounds: [number, number, number, number], width: number, height: number): string {
  return `${template}|${mercBoundsKey(bounds)}|${width}x${height}`;
}

function pairKey(prev: SatelliteFrame, next: SatelliteFrame): string {
  return `${prev.key}=>${next.key}`;
}

function buildWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string {
  const bbox = `${mercBounds[0].toFixed(1)},${mercBounds[1].toFixed(1)},${mercBounds[2].toFixed(1)},${mercBounds[3].toFixed(1)}`;
  return template
    .replace(/\{bbox-epsg-3857\}/g, bbox)
    .replace(/WIDTH=\d+/i, `WIDTH=${width}`)
    .replace(/HEIGHT=\d+/i, `HEIGHT=${height}`);
}

function serializeMercatorBbox(bounds: [number, number, number, number]): string | null {
  if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) return null;
  return bounds.map((value) => value.toFixed(1)).join(",");
}

function isValidBbox(value: string): boolean {
  const parts = value.split(",");
  return parts.length === 4 && parts.every((part) => Number.isFinite(Number(part.trim())));
}

function apiUrl(path: string): string {
  try {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
    return new URL(path.replace(/^\//, ""), base).toString();
  } catch {
    const left = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const right = path.startsWith("/") ? path : `/${path}`;
    return `${left}${right}`;
  }
}

function parseUrl(value: string): URL {
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(value, fallbackBase);
}

function buildProxiedWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string | null {
  const directUrl = buildWmsUrl(template, mercBounds, width, height);

  try {
    const source = parseUrl(directUrl);
    const proxy = new URL(apiUrl("/api/eccc/wms/image"));

    const get = (...keys: string[]) => {
      for (const key of keys) {
        const value = source.searchParams.get(key);
        if (value !== null && value !== "") return value;
      }
      return "";
    };

    const layerName = get("LAYERS", "layers");
    const bbox = serializeMercatorBbox(mercBounds) ?? get("BBOX", "bbox");

    if (!layerName || !bbox || !isValidBbox(bbox)) return null;

    proxy.searchParams.set("layer_name", layerName);
    proxy.searchParams.set("bbox", bbox);
    proxy.searchParams.set("width", get("WIDTH", "width") || String(width));
    proxy.searchParams.set("height", get("HEIGHT", "height") || String(height));
    proxy.searchParams.set("crs", get("CRS", "SRS", "crs") || "EPSG:3857");
    proxy.searchParams.set("format", get("FORMAT", "format") || "image/png");
    proxy.searchParams.set("transparent", get("TRANSPARENT", "transparent") || "TRUE");

    const styles = get("STYLES", "styles", "STYLE", "style");
    if (styles) proxy.searchParams.set("style", styles);

    const time = get("TIME", "time");
    if (time) proxy.searchParams.set("time", time);

    return proxy.toString();
  } catch {
    return null;
  }
}

function templateTimeMs(template: string | null): number | null {
  if (!template) return null;

  try {
    const parsed = parseUrl(template);
    const raw = parsed.searchParams.get("TIME") ?? parsed.searchParams.get("time");
    if (!raw) return null;

    const value = Date.parse(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    const match = /[?&]time=([^&]+)/i.exec(template);
    if (!match) return null;

    const value = Date.parse(decodeURIComponent(match[1]));
    return Number.isFinite(value) ? value : null;
  }
}

function replaceTemplateTime(template: string, isoTime: string): string {
  try {
    const parsed = parseUrl(template);

    if (parsed.searchParams.has("TIME")) {
      parsed.searchParams.set("TIME", isoTime);
    } else if (parsed.searchParams.has("time")) {
      parsed.searchParams.set("time", isoTime);
    }

    return parsed.toString().replace(/%7Bbbox-epsg-3857%7D/gi, "{bbox-epsg-3857}");
  } catch {
    return template.replace(/([?&]time=)[^&]+/i, `$1${encodeURIComponent(isoTime)}`);
  }
}

function shiftedTemplate(template: string, frameOffset: number): string | null {
  if (frameOffset === 0) return template;

  const ms = templateTimeMs(template);
  if (ms === null) return null;

  return replaceTemplateTime(template, new Date(ms + frameOffset * SATELLITE_FRAME_INTERVAL_MS).toISOString());
}

function timeRangeFromExtent(timeExtent: string | null | undefined): { start: number; end: number } | null {
  if (!timeExtent) return null;
  const times = parseWmsTimeDimension(timeExtent);
  if (times.length === 0) return null;
  return { start: times[0], end: times[times.length - 1] };
}

function templateWithinRange(template: string, range: { start: number; end: number } | null): boolean {
  if (range === null) return true;
  const ms = templateTimeMs(template);
  return ms !== null && ms >= range.start && ms <= range.end;
}

function clampTemplateToRange(template: string, range: { start: number; end: number } | null): string | null {
  if (range === null) return template;
  const ms = templateTimeMs(template);
  if (ms === null) return null;
  if (ms < range.start) return replaceTemplateTime(template, new Date(range.start).toISOString());
  if (ms > range.end) return replaceTemplateTime(template, new Date(range.end).toISOString());
  return template;
}

function preloadTemplates(template: string, allowAhead = true, timeExtent?: string | null): string[] {
  const templates: string[] = [];
  const maxAhead = allowAhead ? PRELOAD_AHEAD_FRAMES : 0;
  const range = timeRangeFromExtent(timeExtent);

  for (let offset = -PRELOAD_LOOKBEHIND_FRAMES; offset <= maxAhead; offset += 1) {
    const shifted = shiftedTemplate(template, offset);
    if (shifted && templateWithinRange(shifted, range) && !templates.includes(shifted)) {
      templates.push(shifted);
    }
  }

  if (templates.length === 0) {
    const clamped = clampTemplateToRange(template, range);
    if (clamped) templates.push(clamped);
  }
  return templates;
}

function viewportTexDimensions(
  viewport: { width: number; height: number },
  opts: { fetchPadding: number; maxTexDim: number },
): [number, number] {
  const scale = 1 + opts.fetchPadding * 2;
  const viewportMax = Math.max(viewport.width, viewport.height);
  const adaptiveMax = Math.max(768, Math.min(opts.maxTexDim, Math.round(viewportMax * 1.15)));

  return [
    Math.max(256, Math.min(Math.round(viewport.width * scale) || 768, adaptiveMax)),
    Math.max(256, Math.min(Math.round(viewport.height * scale) || 512, adaptiveMax)),
  ];
}

async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await cachedGetImageBlob(url, signal, {
    ttlMs: 30 * 60 * 1000,
    staleIfErrorMs: 6 * 60 * 60 * 1000,
  });

  if (!response.ok) {
    const error = new Error(`WMS image request failed ${response.status}: ${url.slice(0, 120)}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`WMS proxy returned ${contentType || "non-image"} for ${url.slice(0, 120)}`);
  }

  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function loadImageWithRetry(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await loadImage(url, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;

      const status = typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;

      if (status !== null && status >= 400 && status < 600) break;

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);

        const onAbort = () => {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };

        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("WMS image request failed");
}

function createFallbackTexture(device: Device): Texture {
  return device.createTexture({
    data: new Uint8Array([0, 0, 0, 0]),
    width: 1,
    height: 1,
    format: "rgba8unorm" as any,
    sampler: {
      minFilter: "linear" as any,
      magFilter: "linear" as any,
      addressModeU: "clamp-to-edge" as any,
      addressModeV: "clamp-to-edge" as any,
    },
  });
}

function createSatelliteTexture(device: Device, bitmap: ImageBitmap): Texture {
  const texture = device.createTexture({
    width: bitmap.width,
    height: bitmap.height,
    format: "rgba8unorm" as any,
    sampler: {
      minFilter: "linear" as any,
      magFilter: "linear" as any,
      addressModeU: "clamp-to-edge" as any,
      addressModeV: "clamp-to-edge" as any,
    },
  });

  texture.copyExternalImage({
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    flipY: false,
  });

  return texture;
}

function createMotionSample(bitmap: ImageBitmap): MotionSample | null {
  // This downsampled luma buffer is a cheap client-side proxy for a motion
  // product. The optimal design is to ingest a server-built AMV/IR/WV field
  // with explicit confidence and validity masks.
  const aspect = bitmap.width / Math.max(1, bitmap.height);
  const width = aspect >= 1 ? MOTION_SAMPLE_DIM : Math.max(32, Math.round(MOTION_SAMPLE_DIM * aspect));
  const height = aspect >= 1 ? Math.max(32, Math.round(MOTION_SAMPLE_DIM / aspect)) : MOTION_SAMPLE_DIM;

  try {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;

    if (!ctx) return null;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);

    for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
      const alpha = data[p + 3] / 255;
      luma[i] = alpha * (
        data[p] * 0.2126 +
        data[p + 1] * 0.7152 +
        data[p + 2] * 0.0722
      ) / 255;
    }

    return { width, height, luma };
  } catch {
    return null;
  }
}

function estimateGlobalFlow(prev: MotionSample | null, next: MotionSample | null): [number, number, number, number] {
  if (!prev || !next || prev.width !== next.width || prev.height !== next.height) {
    return [0, 0, 0, 0];
  }

  // Brute-force shift search is intentionally simple and bounded. It is not
  // the optimal meteorological estimator; it is a low-cost fallback that keeps
  // the client responsive until a server-side motion field is wired in.
  const { width, height } = prev;
  const radius = Math.min(MOTION_SEARCH_RADIUS_PX, Math.floor(Math.min(width, height) / 5));
  const stride = 2;

  let bestDx = 0;
  let bestDy = 0;
  let bestError = Number.POSITIVE_INFINITY;
  let zeroError = Number.POSITIVE_INFINITY;

  const shiftedError = (dx: number, dy: number): number => {
    let err = 0;
    let weightSum = 0;

    for (let y = radius; y < height - radius; y += stride) {
      const nextY = y + dy;

      for (let x = radius; x < width - radius; x += stride) {
        const nextX = x + dx;
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

  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const err = shiftedError(dx, dy);

      if (dx === 0 && dy === 0) zeroError = err;

      if (err < bestError) {
        bestError = err;
        bestDx = dx;
        bestDy = dy;
      }
    }
  }

  const magnitude = Math.hypot(bestDx, bestDy);
  if (!Number.isFinite(bestError) || !Number.isFinite(zeroError) || magnitude < 0.5) {
    return [0, 0, 0, 0];
  }

  const improvement = Math.max(0, (zeroError - bestError) / Math.max(zeroError, 0.0001));
  if (improvement < 0.009) return [0, 0, 0, 0];

  const confidence = Math.min(0.90, Math.max(0.30, improvement * 6.0));
  const flowX = Math.max(-MAX_GLOBAL_FLOW_UV, Math.min(MAX_GLOBAL_FLOW_UV, bestDx / width));
  const flowY = Math.max(-MAX_GLOBAL_FLOW_UV, Math.min(MAX_GLOBAL_FLOW_UV, bestDy / height));

  return [flowX, flowY, confidence, 0];
}

function createFullscreenGeometry(): Geometry {
  return new Geometry({
    topology: "triangle-strip",
    vertexCount: 4,
    attributes: {
      aPosition: {
        size: 2,
        value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      },
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

function createEntry(config: SatelliteCompositeConfig): SatEntry {
  return {
    config,
    frames: [],
    flows: [],
    inFlight: new Map(),
    failedUrls: new Map(),
    loadingMercBounds: null,
    bufferFetchMercBounds: null,
    lastTemplateTimeMs: templateTimeMs(config.wmsUrlTemplate),
    loadError: false,
    requestId: 0,
    activePairKey: null,
    activePairStartedMs: 0,
    flowComputeTimer: null,
    prevPairGlobalFlow: [0, 0, 0, 0],
    prevPairHasFlowTex: 0,
    pairTransitionStartMs: 0,
  };
}

function setModelUniforms(model: Model | null, uniforms: Record<string, unknown> | null): void {
  if (!model || !uniforms) return;
  (model as any).setUniforms?.(uniforms);
}

function destroyFlowPair(pair: FlowPairState): void {
  pair.flowFramebuffer?.destroy();
  pair.flowScratchFramebuffer?.destroy();
  pair.flowTexture?.destroy();
  pair.flowScratchTexture?.destroy();
  pair.coarseFlowFBO?.destroy();
  pair.coarseFlowTexture?.destroy();
  pair.flowFramebuffer = null;
  pair.flowScratchFramebuffer = null;
  pair.flowTexture = null;
  pair.flowScratchTexture = null;
  pair.coarseFlowFBO = null;
  pair.coarseFlowTexture = null;
}

function destroyFrame(frame: SatelliteFrame): void {
  frame.texture.destroy();
}

function abortEntryRequests(entry: SatEntry): void {
  entry.requestId += 1;

  for (const request of entry.inFlight.values()) {
    if (request.timer !== null) window.clearTimeout(request.timer);
    request.controller.abort();
  }

  entry.inFlight.clear();
  entry.loadingMercBounds = null;
}

function resetEntryBuffer(entry: SatEntry, nextFetchMercBounds: [number, number, number, number] | null = null): void {
  abortEntryRequests(entry);

  if (entry.flowComputeTimer !== null) {
    window.clearTimeout(entry.flowComputeTimer);
    entry.flowComputeTimer = null;
  }

  for (const frame of entry.frames) destroyFrame(frame);
  for (const flow of entry.flows) destroyFlowPair(flow);

  entry.frames = [];
  entry.flows = [];
  entry.activePairKey = null;
  entry.activePairStartedMs = 0;
  entry.bufferFetchMercBounds = nextFetchMercBounds;
  entry.loadError = false;
}

function destroyEntry(entry: SatEntry): void {
  abortEntryRequests(entry);

  if (entry.flowComputeTimer !== null) {
    window.clearTimeout(entry.flowComputeTimer);
    entry.flowComputeTimer = null;
  }

  for (const frame of entry.frames) destroyFrame(frame);
  for (const flow of entry.flows) destroyFlowPair(flow);

  entry.frames = [];
  entry.flows = [];
  entry.activePairKey = null;
  entry.activePairStartedMs = 0;
}

function usableFrame(
  frame: SatelliteFrame,
  template: string,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
): boolean {
  return (
    frame.template === template &&
    boundsContain(frame.mercBounds, viewMercBounds) &&
    !shouldRefetch(fetchMercBounds, frame.mercBounds)
  );
}

function getUsableFrame(
  entry: SatEntry,
  template: string,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
): SatelliteFrame | null {
  return entry.frames.find((frame) => usableFrame(frame, template, viewMercBounds, fetchMercBounds)) ?? null;
}

function getUsableFrames(
  entry: SatEntry,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
): SatelliteFrame[] {
  return entry.frames
    .filter((frame) => boundsContain(frame.mercBounds, viewMercBounds) && !shouldRefetch(fetchMercBounds, frame.mercBounds))
    .sort((a, b) => {
      if (a.timeMs !== null && b.timeMs !== null) return a.timeMs - b.timeMs;
      return a.loadedAtMs - b.loadedAtMs;
    });
}

function isEntryBuffered(
  entry: SatEntry,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
  minFrames: number,
): boolean {
  const templates = preloadTemplates(entry.config.wmsUrlTemplate, true, entry.config.timeExtent)
    .filter((template) => {
      const templateMs = templateTimeMs(template);
      const currentMs = templateTimeMs(entry.config.wmsUrlTemplate);
      return templateMs === null || currentMs === null || templateMs >= currentMs;
    });
  const required = templates.slice(0, minFrames);

  if (required.length <= 1) {
    return getUsableFrames(entry, viewMercBounds, fetchMercBounds).length > 0;
  }

  return required.every((template) => !!getUsableFrame(entry, template, viewMercBounds, fetchMercBounds));
}

function selectDrawPair(
  entry: SatEntry,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
  timelineMs: number | null,
): { prev: SatelliteFrame; next: SatelliteFrame } | null {
  const usable = getUsableFrames(entry, viewMercBounds, fetchMercBounds);
  if (timelineMs !== null && usable.length >= 2) {
    for (let i = 0; i + 1 < usable.length; i += 1) {
      const prevMs = usable[i].timeMs;
      const nextMs = usable[i + 1].timeMs;
      if (prevMs === null || nextMs === null) continue;
      if (timelineMs >= prevMs && timelineMs <= nextMs) {
        return { prev: usable[i], next: usable[i + 1] };
      }
    }
    const firstMs = usable[0].timeMs;
    const last = usable[usable.length - 1];
    const lastMs = last.timeMs;
    if (firstMs !== null && timelineMs < firstMs) return { prev: usable[0], next: usable[1] };
    if (lastMs !== null && timelineMs > lastMs) return { prev: usable[usable.length - 2], next: last };
  }

  const currentTemplate = entry.config.wmsUrlTemplate;
  const nextTemplate = shiftedTemplate(currentTemplate, 1);

  const current = getUsableFrame(entry, currentTemplate, viewMercBounds, fetchMercBounds);
  const next = nextTemplate ? getUsableFrame(entry, nextTemplate, viewMercBounds, fetchMercBounds) : null;

  if (current && next) return { prev: current, next };

  const activePair = entry.activePairKey ? entry.flows.find((flow) => flow.key === entry.activePairKey) : null;
  if (activePair) {
    const prevFrame = entry.frames.find((frame) => frame.key === activePair.prevFrameKey);
    const nextFrame = entry.frames.find((frame) => frame.key === activePair.nextFrameKey);
    if (prevFrame && nextFrame) return { prev: prevFrame, next: nextFrame };
  }

  if (usable.length < 2) return null;

  const currentMs = templateTimeMs(currentTemplate);
  if (currentMs !== null) {
    const idx = usable.findIndex((frame) => frame.timeMs !== null && frame.timeMs >= currentMs);
    if (idx >= 0 && idx + 1 < usable.length) return { prev: usable[idx], next: usable[idx + 1] };
  }

  return { prev: usable[0], next: usable[1] };
}

function progressForPair(
  pair: { prev: SatelliteFrame; next: SatelliteFrame },
  timelineMs: number | null,
  fallbackProgress: number,
): number {
  const prevMs = pair.prev.timeMs;
  const nextMs = pair.next.timeMs;
  if (timelineMs === null || prevMs === null || nextMs === null || nextMs <= prevMs) {
    return fallbackProgress;
  }
  return (timelineMs - prevMs) / (nextMs - prevMs);
}

export class SatelliteCompositeLayer extends Layer<SatelliteCompositeLayerProps> {
  static override layerName = "SatelliteCompositeLayer";

  private _flowModelLogged = false;
  private _lastLoadingStateKey = "";

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
      uSatCount: 0,
      uSatOpacity: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasPrevTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasNextTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uHasFlowTex: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uRequiresStableVisibleLight: new Array(SHADER_SATELLITE_SLOTS).fill(0),
      uTimeProgress: [0, 0, 0, 0],
      uMaxFlowUv: MAX_FLOW_UV,
      uSunCartesian: sunCartesianAt(Number.isFinite(this.props.timelineMs) ? this.props.timelineMs! : null),
    };

    let flowModel: Model | null = null;
    let flowUniforms: Record<string, unknown> | null = null;

    if (ENABLE_DENSE_OPTICAL_FLOW) {
      try {
        flowUniforms = {
          uTexelSize: [1 / FLOW_TEX_DIM, 1 / FLOW_TEX_DIM],
          uFlowEncodeScale: MAX_FLOW_UV,
          uHasFlowHistory: 0,
          uHasInitialFlow: 0,
        };

        flowModel = new Model(device, {
          id: `${this.props.id}-flow-model`,
          vs: FLOW_VS,
          fs: FLOW_FS,
          topology: "triangle-strip" as any,
          vertexCount: 4,
          geometry: createFullscreenGeometry(),
          uniforms: flowUniforms,
          disableWarnings: false,
          parameters: { depthWriteEnabled: false } as any,
        });

        logManager.debug("satellite", "Dense optical-flow shader compiled.");
      } catch (err) {
        logManager.warn("satellite", "Dense optical-flow shader failed; global-flow fallback remains active", {
          error: err instanceof Error ? err.message : String(err),
        });
        flowModel = null;
        flowUniforms = null;
      }
    }

    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: "triangle-strip" as any,
      vertexCount: 4,
      geometry: createInitialCompositeGeometry(),
      uniforms,
      disableWarnings: false,
      parameters: {
        blend: true,
        blendColorSrcFactor: "src-alpha",
        blendColorDstFactor: "one-minus-src-alpha",
      } as any,
    });

    const entries = this.props.satellites
      .slice(0, maxSatellitesForQuality(normalizeQuality(this.props.quality)))
      .map(createEntry);

    this.setState({
      model,
      flowModel,
      entries,
      fallbackTexture,
      device,
      lastFetchMercBounds: null,
      anyTextureLoaded: false,
      started: false,
      loading: true,
      uniforms,
      flowUniforms,
      timelineMs: Number.isFinite(this.props.timelineMs) ? this.props.timelineMs! : null,
      timeProgressValue: Math.max(0, Math.min(1, Number.isFinite(this.props.timeProgress) ? this.props.timeProgress : 0)),
      timeProgress: [0, 0, 0, 0],
      geometryKey: null,
    });
  }

  setWmsUrlTemplates(templates: Record<string, string>): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;

    let changed = false;

    for (const entry of state.entries) {
      const nextTemplate = templates[entry.config.id];
      if (nextTemplate !== undefined && nextTemplate !== entry.config.wmsUrlTemplate) {
        const nextMs = templateTimeMs(nextTemplate);

        entry.config = { ...entry.config, wmsUrlTemplate: nextTemplate };
        entry.lastTemplateTimeMs = nextMs;
        changed = true;
      }
    }

    if (changed) this.setNeedsRedraw();
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
        destroyEntry(old);
      }
    }

    state.entries = newSats.map((config) => {
      const old = oldById.get(config.id);
      if (!old) return createEntry(config);

      const nextMs = templateTimeMs(config.wmsUrlTemplate);
      old.config = config;
      old.lastTemplateTimeMs = nextMs;
      return old;
    });

    state.anyTextureLoaded = state.entries.some((entry) => entry.frames.length > 0);
    if (!state.started) state.loading = true;
    this.setNeedsRedraw();
  }

  override draw(opts: any): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;

    const { context, renderPass } = opts;
    const viewport = context.viewport as {
      getBounds: () => [number, number, number, number];
      width: number;
      height: number;
    };

    const quality = normalizeQuality(this.props.quality);
    const fetchPadding = fetchPaddingForQuality(quality);
    const meshSegments = viewportMeshSegmentsForQuality(quality);
    const maxSatellites = maxSatellitesForQuality(quality);

    const mercBounds = mercatorBoundsFromViewport(viewport);
    const fetchMercBounds = expandMercatorBounds(mercBounds, fetchPadding);
    const geometryKey = viewportGeometryKey(viewport, mercBounds, meshSegments);

    this._maintainPreloadQueue(mercBounds, fetchMercBounds, viewport);

    const activeEntries = state.entries.slice(0, Math.min(maxSatellites, SHADER_SATELLITE_SLOTS));
    const readySatellites = activeEntries.filter((entry) => {
      const lockedBounds = entry.bufferFetchMercBounds ?? fetchMercBounds;
      return isEntryBuffered(entry, mercBounds, lockedBounds, MIN_START_BUFFER_FRAMES);
    }).length;
    const bufferedFrames = activeEntries.reduce((sum, entry) => {
      const lockedBounds = entry.bufferFetchMercBounds ?? fetchMercBounds;
      return sum + getUsableFrames(entry, mercBounds, lockedBounds).length;
    }, 0);
    const requiredFrames = activeEntries.length * MIN_START_BUFFER_FRAMES;

    if (!state.started) {
      const ready = activeEntries.length > 0 && readySatellites === activeEntries.length;
      state.loading = !ready;
      this._emitLoadingState(state.loading, readySatellites, activeEntries.length, bufferedFrames, requiredFrames);

      if (!ready) return;

      state.started = true;
      state.loading = false;
      this._emitLoadingState(false, readySatellites, activeEntries.length, bufferedFrames, requiredFrames);
    } else {
      const steadyReady = activeEntries.filter((entry) => {
        const lockedBounds = entry.bufferFetchMercBounds ?? fetchMercBounds;
        return isEntryBuffered(entry, mercBounds, lockedBounds, MIN_STEADY_BUFFER_FRAMES);
      }).length;
      const loading = steadyReady !== activeEntries.length;
      state.loading = loading;
      this._emitLoadingState(loading, steadyReady, activeEntries.length, bufferedFrames, activeEntries.length * MIN_STEADY_BUFFER_FRAMES);
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
    const globalFlow: number[] = [];
    const satOpacity: number[] = [];
    const hasPrevTex: number[] = [];
    const hasNextTex: number[] = [];
    const hasFlowTex: number[] = [];
    const requiresStableVisibleLight: number[] = [];
    const timeProgress: number[] = [];
    const bindings: Record<string, Texture> = {};

    const progress = Math.max(0, Math.min(1, state.timeProgressValue));
    const timelineMs = state.timelineMs;

    for (let i = 0; i < SHADER_SATELLITE_SLOTS; i += 1) {
      const entry = activeEntries[i];
      const lockedBounds = entry?.bufferFetchMercBounds ?? fetchMercBounds;
      const pair = entry ? selectDrawPair(entry, mercBounds, lockedBounds, timelineMs) : null;

      if (entry && pair) {
        const flow = this._ensureFlowPair(entry, pair.prev, pair.next);
        const key = flow.key;

        if (entry.activePairKey !== key) {
          // Save previous pair's flow uniforms for transition blending
          const oldFlow = entry.activePairKey
            ? entry.flows.find((f) => f.key === entry.activePairKey)
            : null;
          if (oldFlow && entry.activePairKey !== null) {
            entry.prevPairGlobalFlow = [...oldFlow.globalFlow] as [number, number, number, number];
            entry.prevPairHasFlowTex = oldFlow.flowTexture && oldFlow.status === "ready" ? 1 : 0;
            entry.pairTransitionStartMs = performance.now();
          }
          entry.activePairKey = key;
          entry.activePairStartedMs = performance.now();
        }

        // Blend uniforms during pair transition (400ms) to smooth
        // flow-field discontinuities at satellite frame boundaries
        let useGlobalFlow = flow.globalFlow;
        let useHasFlowTex = flow.flowTexture && flow.status === "ready" ? 1 : 0;
        if (entry.pairTransitionStartMs > 0) {
          const elapsed = performance.now() - entry.pairTransitionStartMs;
          if (elapsed < 400) {
            // ease-out: 1 → 0 over 400ms
            const blend = 1.0 - elapsed / 400;
            useGlobalFlow = [
              flow.globalFlow[0] * (1 - blend) + entry.prevPairGlobalFlow[0] * blend,
              flow.globalFlow[1] * (1 - blend) + entry.prevPairGlobalFlow[1] * blend,
              flow.globalFlow[2] * (1 - blend) + entry.prevPairGlobalFlow[2] * blend,
              flow.globalFlow[3] * (1 - blend) + entry.prevPairGlobalFlow[3] * blend,
            ] as [number, number, number, number];
            useHasFlowTex = useHasFlowTex * (1 - blend) + entry.prevPairHasFlowTex * blend;
          }
        }

        const [sx, sy, sz] = subPointCartesian(entry.config.subPoint[0], entry.config.subPoint[1]);
        const chord = chordParams(entry.config.coverageRadiusDeg, entry.config.featherRadiusDeg);

        satParams.push(sx, sy, sz, chord.maxChord);
        satFeather.push(chord.featherStartChord);
        prevBounds.push(...pair.prev.mercBounds);
        nextBounds.push(...pair.next.mercBounds);
        globalFlow.push(...useGlobalFlow);
        satOpacity.push(entry.config.opacity);
        hasPrevTex.push(1);
        hasNextTex.push(1);
        hasFlowTex.push(useHasFlowTex);
        requiresStableVisibleLight.push(isVisibleSatelliteMotionSource(entry.config.id) ? 1 : 0);
        timeProgress.push(progressForPair(pair, timelineMs, progress));

        bindings[`uPrevTex${i}`] = pair.prev.texture;
        bindings[`uNextTex${i}`] = pair.next.texture;
        bindings[`uFlowTex${i}`] = flow.flowTexture && flow.status === "ready" ? flow.flowTexture : state.fallbackTexture!;
      } else {
        satParams.push(0, 0, 0, 0);
        satFeather.push(0);
        prevBounds.push(0, 0, 1, 1);
        nextBounds.push(0, 0, 1, 1);
        globalFlow.push(0, 0, 0, 0);
        satOpacity.push(0);
        hasPrevTex.push(0);
        hasNextTex.push(0);
        hasFlowTex.push(0);
        requiresStableVisibleLight.push(0);
        timeProgress.push(0);

        bindings[`uPrevTex${i}`] = state.fallbackTexture!;
        bindings[`uNextTex${i}`] = state.fallbackTexture!;
        bindings[`uFlowTex${i}`] = state.fallbackTexture!;
      }
    }

    const uniforms = state.uniforms!;
    uniforms.uMercBounds = mercBounds;
    uniforms.uSatParams = satParams;
    uniforms.uSatFeather = satFeather;
    uniforms.uPrevBounds = prevBounds;
    uniforms.uNextBounds = nextBounds;
    uniforms.uGlobalFlow = globalFlow;
    uniforms.uSatCount = Math.min(activeEntries.length, SHADER_SATELLITE_SLOTS);
    uniforms.uSatOpacity = satOpacity;
    uniforms.uHasPrevTex = hasPrevTex;
    uniforms.uHasNextTex = hasNextTex;
    uniforms.uHasFlowTex = hasFlowTex;
    uniforms.uRequiresStableVisibleLight = requiresStableVisibleLight;
    uniforms.uTimeProgress = timeProgress;
    uniforms.uMaxFlowUv = MAX_FLOW_UV;
    uniforms.uSunCartesian = sunCartesianAt(timelineMs);
    state.timeProgress = timeProgress;

    try {
      state.model.setBindings(bindings as any);
      setModelUniforms(state.model, uniforms);
      state.model.draw(renderPass);
    } catch (err) {
      logManager.warn("satellite", "Composite draw failed; possible WebGL context loss", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  override finalizeState(): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state) return;

    for (const entry of state.entries ?? []) destroyEntry(entry);

    state.fallbackTexture?.destroy();
    state.flowModel?.destroy();
    state.model?.destroy();

    state.fallbackTexture = null;
    state.flowModel = null;
    state.model = null;
    state.entries = [];
    state.started = false;
    state.loading = true;
  }

  private _emitLoadingState(
    loading: boolean,
    readySatellites: number,
    totalSatellites: number,
    bufferedFrames: number,
    requiredFrames: number,
  ): void {
    const rawState = this.state as unknown as CompositorState | undefined;
    const entries = rawState?.entries ?? [];
    const inFlightFrames = entries.reduce((sum, e) => sum + e.inFlight.size, 0);
    const pendingFlows = entries.reduce(
      (sum, e) => sum + e.flows.filter((f) => f.status === "pending" || f.status === "computing").length,
      0,
    );

    // Determine phase honestly:
    // - idle: nothing happening
    // - fetching: frames downloading (inFlight > 0)
    // - computing-flow: optical flow GPU passes running
    // - ready: all buffered
    let phase: SatelliteCompositeLoadingState["phase"] = "idle";
    if (!loading && readySatellites >= totalSatellites) {
      phase = "ready";
    } else if (inFlightFrames > 0 && pendingFlows === 0) {
      phase = "fetching";
    } else if (pendingFlows > 0) {
      phase = "computing-flow";
    } else if (inFlightFrames > 0) {
      phase = "fetching";
    }

    // Rough time estimate:
    // - Each WMS frame fetch: ~3-5 seconds (cached images faster)
    // - Each optical-flow GPU pass: ~0.3 seconds
    // First frame(s) per satellite: ~4-8 seconds (cold cache)
    const missingFrames = Math.max(0, requiredFrames - bufferedFrames);
    const missingSatellites = Math.max(0, totalSatellites - readySatellites);
    const fetchEstimate = inFlightFrames > 0
      ? missingFrames * 3 + missingSatellites * 2
      : 0;
    const flowEstimate = pendingFlows * 0.3;
    const estimatedSecondsRemaining = (fetchEstimate + flowEstimate > 0)
      ? Math.ceil(fetchEstimate + flowEstimate)
      : null;

    const key = `${loading}|${readySatellites}|${totalSatellites}|${bufferedFrames}|${requiredFrames}|${phase}|${inFlightFrames}|${pendingFlows}`;
    if (key === this._lastLoadingStateKey) return;
    this._lastLoadingStateKey = key;

    this.props.onLoadingStateChange?.({
      loading,
      started: !rawState?.loading,
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

  private _maintainPreloadQueue(
    viewMercBounds: [number, number, number, number],
    fetchMercBounds: [number, number, number, number],
    viewport: { width: number; height: number },
  ): void {
    const state = this.state as unknown as CompositorState;
    const quality = normalizeQuality(this.props.quality);
    state.lastFetchMercBounds = fetchMercBounds;

    const [texW, texH] = viewportTexDimensions(viewport, {
      fetchPadding: fetchPaddingForQuality(quality),
      maxTexDim: maxTextureDimForQuality(quality),
    });

    state.entries.forEach((entry, satelliteIndex) => {
      if (!entry.bufferFetchMercBounds) {
        entry.bufferFetchMercBounds = fetchMercBounds;
      }

      // All frames in one buffered sequence must use exactly the same BBOX.
      // If the viewport moves outside the locked buffer, start a new loading
      // phase instead of mixing old/new bounds and disabling optical flow.
      if (
        !boundsContain(entry.bufferFetchMercBounds, viewMercBounds) ||
        shouldRefetch(fetchMercBounds, entry.bufferFetchMercBounds)
      ) {
        resetEntryBuffer(entry, fetchMercBounds);
        state.started = false;
        state.loading = true;
      }

      const lockedFetchMercBounds = entry.bufferFetchMercBounds ?? fetchMercBounds;
      const wantedTemplates = preloadTemplates(entry.config.wmsUrlTemplate, true, entry.config.timeExtent);

      wantedTemplates.forEach((template, templateIndex) => {
        const key = frameKey(template, lockedFetchMercBounds, texW, texH);
        const alreadyLoaded = entry.frames.some((frame) => frame.key === key && usableFrame(frame, template, viewMercBounds, lockedFetchMercBounds));
        const alreadyLoading = entry.inFlight.has(key);

        if (alreadyLoaded || alreadyLoading || !entry.config.wmsUrlTemplate) return;

        const url = buildProxiedWmsUrl(template, lockedFetchMercBounds, texW, texH);
        if (!url) {
          entry.loadError = true;
          logManager.warn("satellite", "Invalid WMS template for proxied fetch", { id: entry.config.id });
          return;
        }

        const failedAt = entry.failedUrls.get(url);
        if (failedAt !== undefined && Date.now() - failedAt < FAILED_URL_COOLDOWN_MS) return;

        this._fetchFrame(entry, template, key, url, lockedFetchMercBounds, satelliteIndex * FETCH_STAGGER_MS + templateIndex * 60);
      });

      this._cleanupEntryBuffers(entry, wantedTemplates, viewMercBounds, lockedFetchMercBounds);
    });
  }

  private _fetchFrame(
    entry: SatEntry,
    template: string,
    key: string,
    url: string,
    fetchMercBounds: [number, number, number, number],
    delayMs: number,
  ): void {
    const state = this.state as unknown as CompositorState;
    const controller = new AbortController();
    const requestId = entry.requestId + 1;
    entry.requestId = requestId;
    entry.loadingMercBounds = fetchMercBounds;
    entry.loadError = false;

    const request: InFlightFrameRequest = {
      key,
      template,
      url,
      controller,
      timer: null,
      requestId,
    };

    entry.inFlight.set(key, request);

    request.timer = window.setTimeout(() => {
      request.timer = null;

      if (!entry.inFlight.has(key) || controller.signal.aborted) return;

      loadImageWithRetry(url, controller.signal)
        .then((bitmap) => {
          if (!entry.inFlight.has(key) || controller.signal.aborted) {
            bitmap.close?.();
            return;
          }

          const texture = createSatelliteTexture(state.device!, bitmap);
          const motionSample = createMotionSample(bitmap);
          const timeMs = templateTimeMs(template);

          const frame: SatelliteFrame = {
            key,
            template,
            timeMs,
            mercBounds: fetchMercBounds,
            texture,
            motionSample,
            width: bitmap.width,
            height: bitmap.height,
            loadedAtMs: performance.now(),
          };

          bitmap.close?.();

          const replaced = entry.frames.filter((existing) => existing.template === template);
          entry.frames = entry.frames.filter((existing) => existing.template !== template);
          for (const oldFrame of replaced) destroyFrame(oldFrame);

          entry.frames.push(frame);
          entry.frames.sort((a, b) => {
            if (a.timeMs !== null && b.timeMs !== null) return a.timeMs - b.timeMs;
            return a.loadedAtMs - b.loadedAtMs;
          });

          entry.inFlight.delete(key);
          entry.failedUrls.delete(url);
          entry.loadError = false;
          state.anyTextureLoaded = true;

          this._scheduleFlowForBufferedPairs(entry);
          this.setNeedsRedraw();
        })
        .catch((err) => {
          entry.inFlight.delete(key);

          if (err instanceof DOMException && err.name === "AbortError") {
            this.setNeedsRedraw();
            return;
          }

          entry.failedUrls.set(url, Date.now());
          entry.loadError = entry.frames.length === 0;

          logManager.warn("satellite", "Frame fetch failed", {
            id: entry.config.id,
            time: templateTimeMs(template) !== null
              ? new Date(templateTimeMs(template)!).toISOString()
              : null,
            error: err instanceof Error ? err.message : String(err),
          });

          this.setNeedsRedraw();
        });
    }, delayMs);
  }

  private _cleanupEntryBuffers(
    entry: SatEntry,
    wantedTemplates: string[],
    viewMercBounds: [number, number, number, number],
    fetchMercBounds: [number, number, number, number],
  ): void {
    const keepTemplates = new Set(wantedTemplates);
    const activeFlow = entry.activePairKey ? entry.flows.find((flow) => flow.key === entry.activePairKey) : null;
    const keepFrameKeys = new Set<string>();

    if (activeFlow) {
      keepFrameKeys.add(activeFlow.prevFrameKey);
      keepFrameKeys.add(activeFlow.nextFrameKey);
    }

    const retained: SatelliteFrame[] = [];
    const removedKeys = new Set<string>();

    for (const frame of entry.frames) {
      const keep = (
        keepTemplates.has(frame.template) ||
        keepFrameKeys.has(frame.key)
      ) && boundsContain(frame.mercBounds, viewMercBounds) && !shouldRefetch(fetchMercBounds, frame.mercBounds);

      if (keep) {
        retained.push(frame);
      } else {
        removedKeys.add(frame.key);
        destroyFrame(frame);
      }
    }

    if (retained.length > MAX_RETAINED_FRAMES) {
      const overflow = retained.splice(0, retained.length - MAX_RETAINED_FRAMES);
      for (const frame of overflow) {
        removedKeys.add(frame.key);
        destroyFrame(frame);
      }
    }

    entry.frames = retained;

    if (removedKeys.size > 0) {
      const keptFlows: FlowPairState[] = [];
      for (const flow of entry.flows) {
        if (removedKeys.has(flow.prevFrameKey) || removedKeys.has(flow.nextFrameKey)) {
          if (entry.activePairKey === flow.key) entry.activePairKey = null;
          destroyFlowPair(flow);
        } else {
          keptFlows.push(flow);
        }
      }
      entry.flows = keptFlows;
    }

    for (const [url, failedAt] of entry.failedUrls) {
      if (Date.now() - failedAt >= FAILED_URL_COOLDOWN_MS) entry.failedUrls.delete(url);
    }
  }

  private _ensureFlowPair(entry: SatEntry, prev: SatelliteFrame, next: SatelliteFrame): FlowPairState {
    const key = pairKey(prev, next);
    let flow = entry.flows.find((candidate) => candidate.key === key);

    if (flow) return flow;

    const assessment = assessMotionPair(entry.config.id, prev, next);
    const globalFlow = assessment.allowsDenseFlow && boundsEquivalent(prev.mercBounds, next.mercBounds)
      ? estimateGlobalFlow(prev.motionSample, next.motionSample)
      : [0, 0, 0, 0] as [number, number, number, number];

    flow = {
      key,
      prevFrameKey: prev.key,
      nextFrameKey: next.key,
      globalFlow,
      motionSource: assessment.source,
      motionConfidence: assessment.confidence,
      motionFlags: assessment.flags,
      flowTexture: null,
      flowScratchTexture: null,
      flowFramebuffer: null,
      flowScratchFramebuffer: null,
      coarseFlowTexture: null,
      coarseFlowFBO: null,
      flowSize: null,
      coarseFlowSize: null,
      status: ENABLE_DENSE_OPTICAL_FLOW && assessment.allowsDenseFlow ? "pending" : "failed",
      lastError: assessment.allowsDenseFlow ? null : "Visible motion rejected near terminator.",
    };

    entry.flows.push(flow);
    this._scheduleFlowForBufferedPairs(entry);
    return flow;
  }

  private _scheduleFlowForBufferedPairs(entry: SatEntry): void {
    if (!ENABLE_DENSE_OPTICAL_FLOW) return;
    if (entry.flowComputeTimer !== null) return;

    entry.flowComputeTimer = window.setTimeout(() => {
      entry.flowComputeTimer = null;
      this._computeNextPendingFlow(entry);
    }, FLOW_COMPUTE_DELAY_MS);
  }

  private _computeNextPendingFlow(entry: SatEntry): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.device || !state.flowModel) {
      if (!this._flowModelLogged) {
        logManager.warn("satellite", "Dense optical-flow model unavailable; using global flow only.");
        this._flowModelLogged = true;
      }
      return;
    }

    const frames = entry.frames.slice().sort((a, b) => {
      if (a.timeMs !== null && b.timeMs !== null) return a.timeMs - b.timeMs;
      return a.loadedAtMs - b.loadedAtMs;
    });

    for (let i = 0; i + 1 < frames.length; i += 1) {
      this._ensureFlowPair(entry, frames[i], frames[i + 1]);
    }

    const pending = entry.flows.find((flow) => flow.status === "pending");
    if (!pending) return;

    const prev = entry.frames.find((frame) => frame.key === pending.prevFrameKey);
    const next = entry.frames.find((frame) => frame.key === pending.nextFrameKey);

    if (!prev || !next || !boundsEquivalent(prev.mercBounds, next.mercBounds)) {
      pending.status = "failed";
      pending.lastError = "Missing frames or non-equivalent bounds.";
      this._scheduleFlowForBufferedPairs(entry);
      return;
    }

    pending.status = "computing";

    try {
      this._computeFlowTextureForPair(state, pending, prev, next);
      pending.status = pending.flowTexture ? "ready" : "failed";
    } catch (err) {
      destroyFlowPair(pending);
      pending.status = "failed";
      pending.lastError = err instanceof Error ? err.message : String(err);
      logManager.warn("satellite", "Dense optical-flow pass failed", { error: pending.lastError });
    }

    this.setNeedsRedraw();

    if (entry.flows.some((flow) => flow.status === "pending")) {
      this._scheduleFlowForBufferedPairs(entry);
    }
  }

  private _ensureFlowBuffers(
    device: Device,
    pair: FlowPairState,
    w: number,
    h: number,
  ): boolean {
    if (
      pair.flowTexture &&
      pair.flowScratchTexture &&
      pair.flowFramebuffer &&
      pair.flowScratchFramebuffer &&
      pair.flowSize?.[0] === w &&
      pair.flowSize?.[1] === h
    ) {
      return true;
    }

    pair.flowFramebuffer?.destroy();
    pair.flowScratchFramebuffer?.destroy();
    pair.flowTexture?.destroy();
    pair.flowScratchTexture?.destroy();

    const texParams = {
      format: "rgba8unorm" as any,
      sampler: {
        minFilter: "linear" as any,
        magFilter: "linear" as any,
        addressModeU: "clamp-to-edge" as any,
        addressModeV: "clamp-to-edge" as any,
      },
    };

    pair.flowTexture = device.createTexture({ width: w, height: h, ...texParams });
    pair.flowScratchTexture = device.createTexture({ width: w, height: h, ...texParams });
    pair.flowFramebuffer = device.createFramebuffer({ colorAttachments: [pair.flowTexture] });
    pair.flowScratchFramebuffer = device.createFramebuffer({ colorAttachments: [pair.flowScratchTexture] });
    pair.flowSize = [w, h];

    return false;
  }

  private _ensureCoarseBuffers(device: Device, pair: FlowPairState, w: number, h: number): void {
    if (
      pair.coarseFlowTexture &&
      pair.coarseFlowFBO &&
      pair.coarseFlowSize?.[0] === w &&
      pair.coarseFlowSize?.[1] === h
    ) {
      return;
    }

    pair.coarseFlowFBO?.destroy();
    pair.coarseFlowTexture?.destroy();

    const texParams = {
      format: "rgba8unorm" as any,
      sampler: {
        minFilter: "linear" as any,
        magFilter: "linear" as any,
        addressModeU: "clamp-to-edge" as any,
        addressModeV: "clamp-to-edge" as any,
      },
    };

    pair.coarseFlowTexture = device.createTexture({ width: w, height: h, ...texParams });
    pair.coarseFlowFBO = device.createFramebuffer({ colorAttachments: [pair.coarseFlowTexture] });
    pair.coarseFlowSize = [w, h];
  }

  private _runFlowPass(
    state: CompositorState,
    pair: FlowPairState,
    prev: SatelliteFrame,
    next: SatelliteFrame,
    fbo: Framebuffer,
    w: number,
    h: number,
    hasInitialFlow: boolean,
    hasHistory: boolean,
  ): void {
    if (!state.device || !state.flowModel || !state.flowUniforms) return;

    const uniforms = state.flowUniforms;
    uniforms.uTexelSize = [1 / w, 1 / h];
    uniforms.uFlowEncodeScale = MAX_FLOW_UV;
    uniforms.uHasInitialFlow = hasInitialFlow ? 1 : 0;
    uniforms.uHasFlowHistory = hasHistory ? 1 : 0;

    state.flowModel.setBindings({
      uFlowPrevTex: prev.texture,
      uFlowNextTex: next.texture,
      uFlowHistoryTex: hasHistory && pair.flowTexture ? pair.flowTexture : state.fallbackTexture!,
      uInitialFlowTex: hasInitialFlow && pair.coarseFlowTexture ? pair.coarseFlowTexture : state.fallbackTexture!,
    } as any);

    setModelUniforms(state.flowModel, uniforms);

    const encoder = state.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      framebuffer: fbo,
      clearColor: [0.5, 0.5, 0, 1],
      parameters: {
        viewport: [0, 0, w, h],
        depthTest: false,
      } as any,
    });

    state.flowModel.draw(pass);
    pass.end();
    state.device.submit(encoder.finish());
  }

  private _computeFlowTextureForPair(
    state: CompositorState,
    pair: FlowPairState,
    prev: SatelliteFrame,
    next: SatelliteFrame,
  ): void {
    if (!state.device || !state.flowModel) return;
    if (prev.width !== next.width || prev.height !== next.height) return;

    const flowW = Math.min(FLOW_TEX_DIM, Math.max(64, Math.round(next.width / 4)));
    const flowH = Math.min(FLOW_TEX_DIM, Math.max(64, Math.round(next.height / 4)));
    const coarseW = Math.min(COARSE_FLOW_DIM, Math.max(16, Math.round(flowW / 4)));
    const coarseH = Math.min(COARSE_FLOW_DIM, Math.max(16, Math.round(flowH / 4)));

    this._ensureCoarseBuffers(state.device, pair, coarseW, coarseH);
    this._runFlowPass(state, pair, prev, next, pair.coarseFlowFBO!, coarseW, coarseH, false, false);

    const hadHistory = this._ensureFlowBuffers(state.device, pair, flowW, flowH);
    this._runFlowPass(state, pair, prev, next, pair.flowScratchFramebuffer!, flowW, flowH, true, hadHistory);

    const oldTex = pair.flowTexture;
    const oldFBO = pair.flowFramebuffer;

    pair.flowTexture = pair.flowScratchTexture;
    pair.flowFramebuffer = pair.flowScratchFramebuffer;
    pair.flowScratchTexture = oldTex;
    pair.flowScratchFramebuffer = oldFBO;

    if (!this._flowModelLogged) {
      logManager.debug("satellite", "Dense optical-flow is active", { flowW, flowH, coarseW, coarseH });
      this._flowModelLogged = true;
    }
  }
}

export function createSatelliteCompositeLayer(configs: {
  satellites: SatelliteCompositeConfig[];
  timeProgress?: number;
  timelineMs?: number;
  quality?: RenderQualityPreset;
  id?: string;
  onLoadingStateChange?: (state: SatelliteCompositeLoadingState) => void;
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
