/** GPU multi-texture satellite compositor with optical-flow temporal morphing.

Pass 1 (low-res FBO): Lucas-Kanade optical flow between prev/next frames.
Pass 2 (full-res): per-pixel advected cross-dissolve with great-circle edge blending.

Satellites limited to 4 to keep total texture uniforms (4×3=12) under
MAX_TEXTURE_IMAGE_UNITS(16) on integrated/low-end hardware. */

import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";
import { Texture } from "@luma.gl/core";
import type { Device, Framebuffer } from "@luma.gl/core";

import { API_BASE_URL } from "../../lib/api";

// ── Types ────────────────────────────────────────────────────────────────

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
  opacity: number;
}

interface SatEntry {
  config: SatelliteCompositeConfig;
  prevTexture: Texture | null;
  nextTexture: Texture | null;
  flowTexture: Texture | null;
  flowFramebuffer: Framebuffer | null;
  flowSize: [number, number] | null;
  prevMercBounds: [number, number, number, number] | null;
  nextMercBounds: [number, number, number, number] | null;
  loadingMercBounds: [number, number, number, number] | null;
  loadedUrlTemplate: string | null;
  loadError: boolean;
  loading: boolean;
  abortController: AbortController | null;
  fetchTimer: number | null;
  retryTimer: number | null;
}

interface CompositorState {
  model: Model | null;
  flowModel: Model | null;
  entries: SatEntry[];
  fallbackTexture: Texture | null;
  device: Device | null;
  lastFetchMercBounds: [number, number, number, number] | null;
  anyTextureLoaded: boolean;
  uniforms: Record<string, unknown> | null;
  flowUniforms: Record<string, unknown> | null;
  /** Imperatively updated every frame; read by draw(). */
  timeProgress: number;
}

interface SatelliteCompositeLayerProps extends LayerProps {
  satellites: SatelliteCompositeConfig[];
  timeProgress: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

const GEOSTATIONARY_SATELLITES: Record<string, SatelliteDiskParams> = {
  eccc_goes_east_natural: {
    layerId: "eccc_goes_east_natural",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 5.0,
    opacity: 0.72,
  },
  eccc_goes_east_ir: {
    layerId: "eccc_goes_east_ir",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 5.0,
    opacity: 0.72,
  },
  eccc_goes_east_cloud_type: {
    layerId: "eccc_goes_east_cloud_type",
    subPoint: [-75.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 5.0,
    opacity: 0.72,
  },
  eccc_goes_west_natural: {
    layerId: "eccc_goes_west_natural",
    subPoint: [-137.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 5.0,
    opacity: 0.72,
  },
  eccc_goes_west_cloud_type: {
    layerId: "eccc_goes_west_cloud_type",
    subPoint: [-137.2, 0],
    coverageRadiusDeg: 81.5,
    featherRadiusDeg: 5.0,
    opacity: 0.72,
  },
};

const EARTH_RADIUS_M = 6_378_137.0;
/** Max concurrent geostationary satellites. Bounded by
  MAX_TEXTURE_IMAGE_UNITS(16) — 4 sats × 3 textures (prev/next/flow) = 12,
  plus 2 for flow compute pass = 14, well under 16. */
const MAX_SATELLITES = 4;
const MAX_TEX_DIM = 2048;
const FLOW_TEX_DIM = 256;
const MAX_FLOW_UV = 0.05;
const REFETCH_THRESHOLD = 0.15;
const FETCH_PADDING = 0.5;
const FETCH_STAGGER_MS = 200;
const RETRY_DELAYS_MS = [500, 1500, 4500];

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ── GLSL Shaders ─────────────────────────────────────────────────────────

const VS = `\
#version 300 es
in vec2 aPosition;
out vec2 vUv;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vUv = aPosition * 0.5 + 0.5;
}
`;

// Chord-length approximation replaces the great-circle haversine, trading
// ~1% edge-blend error for eliminating sin/cos/atan/sqrt per-pixel-per-sat.
// Sub-point Cartesian coords and chord-space radii are pre-computed on CPU
// and packed into uSatParams (x,y,z = subCartesian, w = maxChord,
// uSatFeather[i] = featherStartChord).
const FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
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
uniform int uSatCount;
uniform float uSatOpacity[4];
uniform float uHasPrevTex[4];
uniform float uHasNextTex[4];
uniform float uHasFlowTex[4];
uniform float uTimeProgress;
uniform float uMaxFlowUv;

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
  return (merc - bounds.xy) / span;
}

bool uvInside(vec2 uv) {
  return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

vec4 sampleMorph(int idx, vec2 merc) {
  bool hasPrev = uHasPrevTex[idx] > 0.5;
  bool hasNext = uHasNextTex[idx] > 0.5;
  vec2 prevUv = mercToTexUv(merc, uPrevBounds[idx]);
  vec2 nextUv = mercToTexUv(merc, uNextBounds[idx]);
  bool prevInside = hasPrev && uvInside(prevUv);
  bool nextInside = hasNext && uvInside(nextUv);
  if (!prevInside && !nextInside) return vec4(0.0);

  if (hasPrev && hasNext) {
    vec2 flow = vec2(0.0);
    if (uHasFlowTex[idx] > 0.5 && prevInside && nextInside) {
      vec4 packed = sampleFlowTex(idx, nextUv);
      if (packed.b > 0.25) {
        flow = (packed.rg - vec2(0.5)) * (uMaxFlowUv * 2.0);
      }
    }
    vec4 advected = prevInside
      ? samplePrevTex(idx, clamp(prevUv + flow * uTimeProgress, vec2(0.0), vec2(1.0)))
      : vec4(0.0);
    vec4 nextSample = nextInside ? sampleNextTex(idx, nextUv) : vec4(0.0);
    if (!prevInside) return nextSample;
    if (!nextInside) return advected;
    return mix(advected, nextSample, uTimeProgress);
  }
  if (nextInside) return sampleNextTex(idx, nextUv);
  if (prevInside) return samplePrevTex(idx, prevUv);
  return vec4(0.0);
}

void main() {
  float xMerc = mix(uMercBounds.x, uMercBounds.z, vUv.x);
  float yMerc = mix(uMercBounds.y, uMercBounds.w, vUv.y);
  vec2 merc = vec2(xMerc, yMerc);
  float lon = mercatorXToLon(xMerc);
  float lat = mercatorYToLat(yMerc);
  vec3 fragCart = latLonToCartesian(lat, lon);

  vec4 color = vec4(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < 4; i++) {
    if (i >= uSatCount) break;
    if (uHasPrevTex[i] < 0.5 && uHasNextTex[i] < 0.5) continue;

    // Chord distance between fragment and satellite sub-point (both on unit sphere).
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
  float alpha = clamp(totalWeight, 0.0, 1.0);

  fragColor = vec4(color.rgb, alpha);
}
`;

const FLOW_FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uFlowPrevTex;
uniform sampler2D uFlowNextTex;
uniform vec2 uTexelSize;
uniform float uFlowEncodeScale;

float lumaAt(sampler2D tex, vec2 uv) {
  vec3 rgb = texture(tex, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  float a00 = 0.0;
  float a01 = 0.0;
  float a11 = 0.0;
  float b0 = 0.0;
  float b1 = 0.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 offset = vec2(float(x), float(y)) * uTexelSize;
      vec2 uv = vUv + offset;
      float left = lumaAt(uFlowPrevTex, uv - vec2(uTexelSize.x, 0.0));
      float right = lumaAt(uFlowPrevTex, uv + vec2(uTexelSize.x, 0.0));
      float down = lumaAt(uFlowPrevTex, uv - vec2(0.0, uTexelSize.y));
      float up = lumaAt(uFlowPrevTex, uv + vec2(0.0, uTexelSize.y));
      float ix = (right - left) * 0.5;
      float iy = (up - down) * 0.5;
      float it = lumaAt(uFlowNextTex, uv) - lumaAt(uFlowPrevTex, uv);
      a00 += ix * ix;
      a01 += ix * iy;
      a11 += iy * iy;
      b0 += -it * ix;
      b1 += -it * iy;
    }
  }

  float det = a00 * a11 - a01 * a01;
  float gradientEnergy = a00 + a11;
  float confidence = smoothstep(0.0005, 0.02, gradientEnergy) * step(0.000001, abs(det));
  vec2 flowPx = vec2(0.0);
  if (confidence > 0.0) {
    flowPx = vec2((a11 * b0 - a01 * b1) / det, (-a01 * b0 + a00 * b1) / det);
  }
  vec2 flowUv = clamp(flowPx * uTexelSize, vec2(-uFlowEncodeScale), vec2(uFlowEncodeScale));
  vec2 encoded = flowUv / (uFlowEncodeScale * 2.0) + vec2(0.5);
  fragColor = vec4(encoded, confidence, 1.0);
}
`;

// ── Helpers ──────────────────────────────────────────────────────────────

function mercatorBoundsFromViewport(viewport: {
  getBounds: () => [number, number, number, number];
}): [number, number, number, number] {
  const b = viewport.getBounds();
  const west = Math.min(b[0], b[2]);
  const south = Math.min(b[1], b[3]);
  const east = Math.max(b[0], b[2]);
  const north = Math.max(b[1], b[3]);

  const westM = west * DEG_TO_RAD * EARTH_RADIUS_M;
  const eastM = east * DEG_TO_RAD * EARTH_RADIUS_M;
  const southM = Math.log(Math.tan((90 + south) * DEG_TO_RAD * 0.5)) * EARTH_RADIUS_M;
  const northM = Math.log(Math.tan((90 + north) * DEG_TO_RAD * 0.5)) * EARTH_RADIUS_M;

  return [westM, southM, eastM, northM];
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
  const centerShifted =
    Math.abs(currentCx - lastCx) > currentW * REFETCH_THRESHOLD ||
    Math.abs(currentCy - lastCy) > currentH * REFETCH_THRESHOLD;
  const scaleChanged =
    Math.abs(currentW - lastW) > currentW * 0.25 ||
    Math.abs(currentH - lastH) > currentH * 0.25;
  return centerShifted || scaleChanged;
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

function buildWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string {
  const bbox = `${mercBounds[0].toFixed(1)},${mercBounds[1].toFixed(1)},${mercBounds[2].toFixed(1)},${mercBounds[3].toFixed(1)}`;
  let url = template.replace("{bbox-epsg-3857}", bbox);
  url = url.replace(/WIDTH=\d+/i, `WIDTH=${width}`);
  url = url.replace(/HEIGHT=\d+/i, `HEIGHT=${height}`);
  return url;
}

function apiUrl(path: string): string {
  try {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
    return new URL(path.replace(/^\//, ""), base).toString();
  } catch {
    return `${API_BASE_URL}${path}`;
  }
}

function buildProxiedWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string {
  const directUrl = buildWmsUrl(template, mercBounds, width, height);
  try {
    const source = new URL(directUrl);
    const proxy = new URL(apiUrl("/api/eccc/wms/image"));
    const get = (...keys: string[]) => {
      for (const key of keys) {
        const value = source.searchParams.get(key);
        if (value !== null && value !== "") return value;
      }
      return "";
    };
    const layerName = get("LAYERS", "layers");
    const bbox = get("BBOX", "bbox");
    if (!layerName || !bbox) return directUrl;
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
    return directUrl;
  }
}

function viewportTexDimensions(viewport: {
  width: number;
  height: number;
}): [number, number] {
  const scale = 1 + FETCH_PADDING * 2;
  return [
    Math.min(Math.round(viewport.width * scale) || 1024, MAX_TEX_DIM),
    Math.min(Math.round(viewport.height * scale) || 768, MAX_TEX_DIM),
  ];
}

async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  const response = await fetch(url, { signal, mode: "cors" });
  if (!response.ok) {
    throw new Error(`WMS image request failed ${response.status}: ${url.slice(0, 120)}`);
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
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);
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
    sampler: { minFilter: "linear" as any, magFilter: "linear" as any },
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
    flipY: true,
  });
  return texture;
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

/** Convert lon/lat sub-point to unit-sphere Cartesian. */
function subPointCartesian(lon: number, lat: number): [number, number, number] {
  const phi = lat * DEG_TO_RAD;
  const lambda = lon * DEG_TO_RAD;
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

/** Convert coverage/feather radii from degrees to chord-space distances. */
function chordParams(coverageDeg: number, featherDeg: number): { maxChord: number; featherStartChord: number } {
  const maxChord = 2 * Math.sin(coverageDeg * DEG_TO_RAD * 0.5);
  const featherStart = 2 * Math.sin(Math.max(0.001, coverageDeg - featherDeg) * DEG_TO_RAD * 0.5);
  return { maxChord, featherStartChord: featherStart };
}

function createEntry(config: SatelliteCompositeConfig): SatEntry {
  return {
    config,
    prevTexture: null,
    nextTexture: null,
    flowTexture: null,
    flowFramebuffer: null,
    flowSize: null,
    prevMercBounds: null,
    nextMercBounds: null,
    loadingMercBounds: null,
    loadedUrlTemplate: null,
    loadError: false,
    loading: false,
    abortController: null,
    fetchTimer: null,
    retryTimer: null,
  };
}

function hasUsableLoadedTexture(
  entry: SatEntry,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
): boolean {
  return (
    !!entry.nextTexture &&
    entry.loadedUrlTemplate === entry.config.wmsUrlTemplate &&
    boundsContain(entry.nextMercBounds, viewMercBounds) &&
    !shouldRefetch(fetchMercBounds, entry.nextMercBounds)
  );
}

function hasUsablePendingRequest(
  entry: SatEntry,
  fetchMercBounds: [number, number, number, number],
): boolean {
  return entry.loading && !shouldRefetch(fetchMercBounds, entry.loadingMercBounds);
}

function needsTextureFetch(
  entry: SatEntry,
  viewMercBounds: [number, number, number, number],
  fetchMercBounds: [number, number, number, number],
): boolean {
  if (!entry.config.wmsUrlTemplate) return false;
  return (
    !hasUsableLoadedTexture(entry, viewMercBounds, fetchMercBounds) &&
    !hasUsablePendingRequest(entry, fetchMercBounds)
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

// ── Custom Layer ─────────────────────────────────────────────────────────

export class SatelliteCompositeLayer extends Layer<SatelliteCompositeLayerProps> {
  static override layerName = "SatelliteCompositeLayer";

  override initializeState(): void {
    const device = this.context.device;
    const fallbackTexture = createFallbackTexture(device);

    const uniforms: Record<string, unknown> = {
      uMercBounds: [0, 0, 0, 0],
      uEarthRadius: EARTH_RADIUS_M,
      uSatParams: new Array(MAX_SATELLITES * 4).fill(0),
      uSatFeather: new Array(MAX_SATELLITES).fill(0),
      uPrevBounds: new Array(MAX_SATELLITES * 4).fill(0),
      uNextBounds: new Array(MAX_SATELLITES * 4).fill(0),
      uSatCount: 0,
      uSatOpacity: new Array(MAX_SATELLITES).fill(0),
      uHasPrevTex: new Array(MAX_SATELLITES).fill(0),
      uHasNextTex: new Array(MAX_SATELLITES).fill(0),
      uHasFlowTex: new Array(MAX_SATELLITES).fill(0),
      uTimeProgress: 0,
      uMaxFlowUv: MAX_FLOW_UV,
    };
    const flowUniforms: Record<string, unknown> = {
      uTexelSize: [1 / FLOW_TEX_DIM, 1 / FLOW_TEX_DIM],
      uFlowEncodeScale: MAX_FLOW_UV,
    };
    const geometry = createFullscreenGeometry();

    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: "triangle-strip" as any,
      vertexCount: 4,
      geometry,
      uniforms,
      parameters: {
        blend: true,
        blendColorSrcFactor: "src-alpha",
        blendColorDstFactor: "one-minus-src-alpha",
      },
    });
    const flowModel = new Model(device, {
      id: `${this.props.id}-flow-model`,
      vs: VS,
      fs: FLOW_FS,
      topology: "triangle-strip" as any,
      vertexCount: 4,
      geometry: createFullscreenGeometry(),
      uniforms: flowUniforms,
      parameters: { depthWriteEnabled: false } as any,
    });

    this.setState({
      model,
      flowModel,
      entries: this.props.satellites.slice(0, MAX_SATELLITES).map(createEntry),
      fallbackTexture,
      device,
      lastFetchMercBounds: null,
      anyTextureLoaded: false,
      uniforms,
      flowUniforms,
      timeProgress: 0,
    });
  }

  /** Imperative time update — avoids layer teardown/rebuild on every rAF. */
  setTimeProgress(value: number): void {
    if (!this.state) return; // DeckGL hasn't called initializeState yet
    const state = this.state as unknown as CompositorState;
    state.timeProgress = Math.max(0, Math.min(1, value));
    this.setNeedsRedraw();
  }

  override updateState(
    params: UpdateParameters<Layer<SatelliteCompositeLayerProps>>,
  ): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;
    const newSats = params.props.satellites;
    const oldSats = params.oldProps.satellites;

    if (newSats === oldSats) return;

    const oldById = new Map(state.entries.map((e) => [e.config.id, e]));

    for (const old of state.entries) {
      if (!newSats.find((s) => s.id === old.config.id)) {
        old.abortController?.abort();
        if (old.fetchTimer !== null) window.clearTimeout(old.fetchTimer);
        if (old.retryTimer !== null) window.clearTimeout(old.retryTimer);
        old.prevTexture?.destroy();
        old.nextTexture?.destroy();
        old.flowFramebuffer?.destroy();
        old.flowTexture?.destroy();
      }
    }

    state.entries = newSats.map((config) => {
      const old = oldById.get(config.id);
      if (old && old.config.wmsUrlTemplate === config.wmsUrlTemplate) {
        return { ...old, config };
      }
      if (old) {
        old.abortController?.abort();
        if (old.fetchTimer !== null) window.clearTimeout(old.fetchTimer);
        if (old.retryTimer !== null) window.clearTimeout(old.retryTimer);
        return {
          ...old,
          config,
          loadError: false,
          loading: false,
          abortController: null,
          fetchTimer: null,
          retryTimer: null,
        };
      }
      return createEntry(config);
    });
  }

  override draw(opts: any): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return; // not initialized yet
    const { context, renderPass } = opts;
    const viewport = context.viewport as {
      getBounds: () => [number, number, number, number];
      width: number;
      height: number;
    };

    const mercBounds = mercatorBoundsFromViewport(viewport);
    const fetchMercBounds = expandMercatorBounds(mercBounds, FETCH_PADDING);

    if (state.entries.some((entry) => needsTextureFetch(entry, mercBounds, fetchMercBounds))) {
      this._fetchTextures(mercBounds, fetchMercBounds, viewport);
    }

    if (!state.model || !state.anyTextureLoaded) return;

    const satParams: number[] = [];
    const satFeather: number[] = [];
    const prevBounds: number[] = [];
    const nextBounds: number[] = [];
    const satOpacity: number[] = [];
    const hasPrevTex: number[] = [];
    const hasNextTex: number[] = [];
    const hasFlowTex: number[] = [];
    const bindings: Record<string, Texture> = {};

    for (let i = 0; i < MAX_SATELLITES; i++) {
      const entry = state.entries[i];
      if (entry?.prevTexture || entry?.nextTexture) {
        const [sx, sy, sz] = subPointCartesian(
          entry.config.subPoint[0],
          entry.config.subPoint[1],
        );
        const chord = chordParams(entry.config.coverageRadiusDeg, entry.config.featherRadiusDeg);
        satParams.push(sx, sy, sz, chord.maxChord);
        satFeather.push(chord.featherStartChord);
        prevBounds.push(...(entry.prevMercBounds ?? entry.nextMercBounds ?? mercBounds));
        nextBounds.push(...(entry.nextMercBounds ?? entry.prevMercBounds ?? mercBounds));
        satOpacity.push(entry.config.opacity);
        hasPrevTex.push(entry.prevTexture ? 1 : 0);
        hasNextTex.push(entry.nextTexture ? 1 : 0);
        hasFlowTex.push(
          entry.flowTexture && boundsEquivalent(entry.prevMercBounds, entry.nextMercBounds) ? 1 : 0,
        );
        bindings[`uPrevTex${i}`] = entry.prevTexture ?? state.fallbackTexture!;
        bindings[`uNextTex${i}`] = entry.nextTexture ?? entry.prevTexture ?? state.fallbackTexture!;
        bindings[`uFlowTex${i}`] = entry.flowTexture ?? state.fallbackTexture!;
      } else {
        satParams.push(0, 0, 0, 0);
        satFeather.push(0);
        prevBounds.push(0, 0, 1, 1);
        nextBounds.push(0, 0, 1, 1);
        satOpacity.push(0);
        hasPrevTex.push(0);
        hasNextTex.push(0);
        hasFlowTex.push(0);
        bindings[`uPrevTex${i}`] = state.fallbackTexture!;
        bindings[`uNextTex${i}`] = state.fallbackTexture!;
        bindings[`uFlowTex${i}`] = state.fallbackTexture!;
      }
    }

    while (satParams.length < MAX_SATELLITES * 4) satParams.push(0);
    while (satFeather.length < MAX_SATELLITES) satFeather.push(0);
    while (prevBounds.length < MAX_SATELLITES * 4) prevBounds.push(0, 0, 1, 1);
    while (nextBounds.length < MAX_SATELLITES * 4) nextBounds.push(0, 0, 1, 1);
    while (satOpacity.length < MAX_SATELLITES) satOpacity.push(0);
    while (hasPrevTex.length < MAX_SATELLITES) hasPrevTex.push(0);
    while (hasNextTex.length < MAX_SATELLITES) hasNextTex.push(0);
    while (hasFlowTex.length < MAX_SATELLITES) hasFlowTex.push(0);

    state.model.setBindings(bindings as any);

    const u = state.uniforms!;
    u.uMercBounds = mercBounds;
    u.uSatParams = satParams;
    u.uSatFeather = satFeather;
    u.uPrevBounds = prevBounds;
    u.uNextBounds = nextBounds;
    u.uSatCount = Math.min(state.entries.length, MAX_SATELLITES);
    u.uSatOpacity = satOpacity;
    u.uHasPrevTex = hasPrevTex;
    u.uHasNextTex = hasNextTex;
    u.uHasFlowTex = hasFlowTex;
    // Read from state, not props — updated imperatively by setTimeProgress().
    u.uTimeProgress = state.timeProgress;
    u.uMaxFlowUv = MAX_FLOW_UV;

    state.model.draw(renderPass);
  }

  override finalizeState(): void {
    const state = this.state as unknown as CompositorState | undefined;
    if (!state?.entries) return;
    for (const entry of state.entries) {
      entry.abortController?.abort();
      if (entry.fetchTimer !== null) window.clearTimeout(entry.fetchTimer);
      if (entry.retryTimer !== null) window.clearTimeout(entry.retryTimer);
      entry.prevTexture?.destroy();
      entry.nextTexture?.destroy();
      entry.flowFramebuffer?.destroy();
      entry.flowTexture?.destroy();
    }
    state.fallbackTexture?.destroy();
    state.flowModel?.destroy();
    state.model?.destroy();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private _fetchTextures(
    viewMercBounds: [number, number, number, number],
    fetchMercBounds: [number, number, number, number],
    viewport: { width: number; height: number },
  ): void {
    const state = this.state as unknown as CompositorState;
    state.lastFetchMercBounds = fetchMercBounds;

    const [texW, texH] = viewportTexDimensions(viewport);

    state.entries.forEach((entry, index) => {
      if (hasUsableLoadedTexture(entry, viewMercBounds, fetchMercBounds)) {
        entry.loadError = false;
        return;
      }
      if (hasUsablePendingRequest(entry, fetchMercBounds)) return;
      if (!entry.config.wmsUrlTemplate) {
        entry.loadError = true;
        return;
      }

      entry.abortController?.abort();
      if (entry.fetchTimer !== null) window.clearTimeout(entry.fetchTimer);
      if (entry.retryTimer !== null) window.clearTimeout(entry.retryTimer);
      const controller = new AbortController();
      entry.abortController = controller;
      entry.loading = true;
      entry.loadingMercBounds = fetchMercBounds;
      entry.loadError = false;

      const url = buildProxiedWmsUrl(entry.config.wmsUrlTemplate, fetchMercBounds, texW, texH);

      entry.fetchTimer = window.setTimeout(() => {
        entry.fetchTimer = null;
        loadImageWithRetry(url, controller.signal)
          .then((bitmap) => {
            if (controller.signal.aborted) {
              bitmap.close?.();
              return;
            }
            const newTexture = createSatelliteTexture(state.device!, bitmap);
            bitmap.close?.();

            const oldPrev = entry.prevTexture;
            if (entry.nextTexture) {
              entry.prevTexture = entry.nextTexture;
              entry.prevMercBounds = entry.nextMercBounds;
            }
            entry.nextTexture = newTexture;
            entry.nextMercBounds = fetchMercBounds;
            entry.loadedUrlTemplate = entry.config.wmsUrlTemplate;
            entry.loadError = false;
            entry.loading = false;
            entry.loadingMercBounds = null;
            entry.abortController = null;
            oldPrev?.destroy();

            if (entry.prevTexture && entry.nextTexture && boundsEquivalent(entry.prevMercBounds, entry.nextMercBounds)) {
              this._computeFlowTexture(entry);
            } else {
              entry.flowFramebuffer?.destroy();
              entry.flowTexture?.destroy();
              entry.flowFramebuffer = null;
              entry.flowTexture = null;
              entry.flowSize = null;
            }
            state.anyTextureLoaded = true;
            this.setNeedsRedraw();
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              entry.loading = false;
              entry.loadingMercBounds = null;
              return;
            }
            entry.loadError = !entry.nextTexture && !entry.prevTexture;
            entry.loading = false;
            entry.loadingMercBounds = null;
            entry.abortController = null;
            // eslint-disable-next-line no-console
            console.warn(
              `[SatelliteComposite] ${entry.config.id}:`,
              (err as Error).message,
            );
            this.setNeedsRedraw();
          });
      }, index * FETCH_STAGGER_MS);
    });
  }

  private _computeFlowTexture(entry: SatEntry): void {
    const state = this.state as unknown as CompositorState;
    if (!state.device || !state.flowModel || !entry.prevTexture || !entry.nextTexture) return;

    const flowW = Math.min(FLOW_TEX_DIM, Math.max(64, Math.round(entry.nextTexture.width / 4)));
    const flowH = Math.min(FLOW_TEX_DIM, Math.max(64, Math.round(entry.nextTexture.height / 4)));

    if (!entry.flowTexture || !entry.flowFramebuffer || entry.flowSize?.[0] !== flowW || entry.flowSize?.[1] !== flowH) {
      entry.flowFramebuffer?.destroy();
      entry.flowTexture?.destroy();
      entry.flowTexture = state.device.createTexture({
        width: flowW,
        height: flowH,
        format: "rgba8unorm" as any,
        sampler: {
          minFilter: "linear" as any,
          magFilter: "linear" as any,
          addressModeU: "clamp-to-edge" as any,
          addressModeV: "clamp-to-edge" as any,
        },
      });
      entry.flowFramebuffer = state.device.createFramebuffer({
        colorAttachments: [entry.flowTexture],
      });
      entry.flowSize = [flowW, flowH];
    }

    const u = state.flowUniforms!;
    u.uTexelSize = [1 / Math.max(1, flowW), 1 / Math.max(1, flowH)];
    u.uFlowEncodeScale = MAX_FLOW_UV;
    state.flowModel.setBindings({
      uFlowPrevTex: entry.prevTexture,
      uFlowNextTex: entry.nextTexture,
    } as any);

    try {
      const encoder = state.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        framebuffer: entry.flowFramebuffer,
        clearColor: [0.5, 0.5, 0, 1],
        parameters: {
          viewport: [0, 0, flowW, flowH],
          depthTest: false,
        } as any,
      });
      state.flowModel.draw(pass);
      pass.end();
      state.device.submit(encoder.finish());
    } catch (err) {
      entry.flowFramebuffer?.destroy();
      entry.flowTexture?.destroy();
      entry.flowFramebuffer = null;
      entry.flowTexture = null;
      entry.flowSize = null;
      // eslint-disable-next-line no-console
      console.warn("[SatelliteComposite] optical-flow pass failed:", err);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function createSatelliteCompositeLayer(configs: {
  satellites: SatelliteCompositeConfig[];
  timeProgress?: number;
  id?: string;
}): SatelliteCompositeLayer | null {
  if (configs.satellites.length === 0) return null;
  return new SatelliteCompositeLayer({
    id: configs.id ?? "satellite-composite",
    satellites: configs.satellites.slice(0, MAX_SATELLITES),
    timeProgress: configs.timeProgress ?? 0,
    pickable: false,
  });
}

export function getSatelliteDiskParams(
  layerId: string,
): SatelliteDiskParams | null {
  const params = GEOSTATIONARY_SATELLITES[layerId];
  if (!params) return null;
  return { ...params };
}

export function isGeostationarySatellite(layerId: string): boolean {
  return layerId in GEOSTATIONARY_SATELLITES;
}
