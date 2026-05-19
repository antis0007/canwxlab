/** GPU multi-texture satellite compositor.

Replaces the black-ellipse mask approach with a proper WebGL fragment shader
that blends geostationary satellite imagery at the per-pixel level using
great-circle distance weights and smoothstep feathering.

Each satellite's WMS imagery is fetched at viewport resolution and uploaded
as a WebGL texture. A full-viewport quad samples all active satellite textures
in a single draw call, computing coverage weights from the inverse-Mercator
geographic position of each fragment. */

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
  /** WMS GetMap template URL with `{bbox-epsg-3857}` placeholder and
    time parameter already resolved. */
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
  /** Mercator bounds that the previous/next textures cover (meters). */
  prevMercBounds: [number, number, number, number] | null;
  nextMercBounds: [number, number, number, number] | null;
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
  /** Uniforms object kept by reference so draw() can mutate it without a setUniforms() API. */
  uniforms: Record<string, unknown> | null;
  flowUniforms: Record<string, unknown> | null;
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
const MAX_SATELLITES = 6;
const MAX_TEX_DIM = 2048;
const FLOW_TEX_DIM = 256;
const MAX_FLOW_UV = 0.05;
const REFETCH_THRESHOLD = 0.15;
const FETCH_STAGGER_MS = 200;
const RETRY_DELAYS_MS = [500, 1500, 4500];

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

const FS = `\
#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPrevTex0;
uniform sampler2D uPrevTex1;
uniform sampler2D uPrevTex2;
uniform sampler2D uPrevTex3;
uniform sampler2D uPrevTex4;
uniform sampler2D uPrevTex5;
uniform sampler2D uNextTex0;
uniform sampler2D uNextTex1;
uniform sampler2D uNextTex2;
uniform sampler2D uNextTex3;
uniform sampler2D uNextTex4;
uniform sampler2D uNextTex5;
uniform sampler2D uFlowTex0;
uniform sampler2D uFlowTex1;
uniform sampler2D uFlowTex2;
uniform sampler2D uFlowTex3;
uniform sampler2D uFlowTex4;
uniform sampler2D uFlowTex5;
uniform vec4 uMercBounds;
uniform float uEarthRadius;
uniform vec4 uSatParams[6];
uniform int uSatCount;
uniform float uSatOpacity[6];
uniform float uHasPrevTex[6];
uniform float uHasNextTex[6];
uniform float uHasFlowTex[6];
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

float greatCircleDistDeg(float lat1, float lon1, float lat2, float lon2) {
  float dLat = (lat2 - lat1) * DEG_TO_RAD;
  float dLon = (lon2 - lon1) * DEG_TO_RAD;
  float sinDLat = sin(dLat * 0.5);
  float sinDLon = sin(dLon * 0.5);
  float a = sinDLat * sinDLat +
            cos(lat1 * DEG_TO_RAD) * cos(lat2 * DEG_TO_RAD) *
            sinDLon * sinDLon;
  return 2.0 * atan(sqrt(a), sqrt(1.0 - a)) * RAD_TO_DEG;
}

vec4 samplePrevTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uPrevTex0, uv);
  if (idx == 1) return texture(uPrevTex1, uv);
  if (idx == 2) return texture(uPrevTex2, uv);
  if (idx == 3) return texture(uPrevTex3, uv);
  if (idx == 4) return texture(uPrevTex4, uv);
  return texture(uPrevTex5, uv);
}

vec4 sampleNextTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uNextTex0, uv);
  if (idx == 1) return texture(uNextTex1, uv);
  if (idx == 2) return texture(uNextTex2, uv);
  if (idx == 3) return texture(uNextTex3, uv);
  if (idx == 4) return texture(uNextTex4, uv);
  return texture(uNextTex5, uv);
}

vec4 sampleFlowTex(int idx, vec2 uv) {
  if (idx == 0) return texture(uFlowTex0, uv);
  if (idx == 1) return texture(uFlowTex1, uv);
  if (idx == 2) return texture(uFlowTex2, uv);
  if (idx == 3) return texture(uFlowTex3, uv);
  if (idx == 4) return texture(uFlowTex4, uv);
  return texture(uFlowTex5, uv);
}

vec4 sampleMorph(int idx, vec2 uv) {
  bool hasPrev = uHasPrevTex[idx] > 0.5;
  bool hasNext = uHasNextTex[idx] > 0.5;
  if (hasPrev && hasNext) {
    vec2 flow = vec2(0.0);
    if (uHasFlowTex[idx] > 0.5) {
      vec4 packed = sampleFlowTex(idx, uv);
      if (packed.b > 0.25) {
        flow = (packed.rg - vec2(0.5)) * (uMaxFlowUv * 2.0);
      }
    }
    vec2 advectedUv = clamp(uv + flow * uTimeProgress, vec2(0.0), vec2(1.0));
    vec4 advected = samplePrevTex(idx, advectedUv);
    vec4 nextSample = sampleNextTex(idx, uv);
    return mix(advected, nextSample, uTimeProgress);
  }
  if (hasNext) return sampleNextTex(idx, uv);
  if (hasPrev) return samplePrevTex(idx, uv);
  return vec4(0.0);
}

void main() {
  float xMerc = mix(uMercBounds.x, uMercBounds.z, vUv.x);
  float yMerc = mix(uMercBounds.y, uMercBounds.w, vUv.y);
  float lon = mercatorXToLon(xMerc);
  float lat = mercatorYToLat(yMerc);

  vec4 color = vec4(0.0);
  float totalWeight = 0.0;

  for (int i = 0; i < 6; i++) {
    if (i >= uSatCount) break;
    if (uHasPrevTex[i] < 0.5 && uHasNextTex[i] < 0.5) continue;

    vec4 params = uSatParams[i];
    float subLon = params.x;
    float subLat = params.y;
    float coverageDeg = params.z;
    float featherDeg = params.w;

    float dist = greatCircleDistDeg(lat, lon, subLat, subLon);
    float weight = 1.0 - smoothstep(coverageDeg - featherDeg, coverageDeg, dist);

    if (weight > 0.001) {
      vec4 texel = sampleMorph(i, vUv);
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

  const d2r = Math.PI / 180;
  const westM = west * d2r * EARTH_RADIUS_M;
  const eastM = east * d2r * EARTH_RADIUS_M;
  const southM = Math.log(Math.tan((90 + south) * d2r * 0.5)) * EARTH_RADIUS_M;
  const northM = Math.log(Math.tan((90 + north) * d2r * 0.5)) * EARTH_RADIUS_M;

  return [westM, southM, eastM, northM];
}

function shouldRefetch(
  current: [number, number, number, number],
  last: [number, number, number, number] | null,
): boolean {
  if (!last) return true;
  const dx = Math.abs(current[2] - current[0]);
  const dy = Math.abs(current[3] - current[1]);
  if (dx < 1000 || dy < 1000) return false;
  const ex = Math.abs(current[0] - last[0]);
  const ey = Math.abs(current[1] - last[1]);
  return ex > dx * REFETCH_THRESHOLD || ey > dy * REFETCH_THRESHOLD;
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
  return [
    Math.min(Math.round(viewport.width) || 1024, MAX_TEX_DIM),
    Math.min(Math.round(viewport.height) || 768, MAX_TEX_DIM),
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

// ── Custom Layer ─────────────────────────────────────────────────────────

export class SatelliteCompositeLayer extends Layer<SatelliteCompositeLayerProps> {
  static override layerName = "SatelliteCompositeLayer";

  override initializeState(): void {
    const device = this.context.device;
    const fallbackTexture = createFallbackTexture(device);

    // Uniforms object kept by reference — mutated in draw() per frame.
    // luma.gl 9.x passes `this.props.uniforms` to each pipeline draw call,
    // so updating the referenced object is sufficient.
    const uniforms: Record<string, unknown> = {
      uMercBounds: [0, 0, 0, 0],
      uEarthRadius: EARTH_RADIUS_M,
      uSatParams: new Array(MAX_SATELLITES * 4).fill(0),
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
      entries: [],
      fallbackTexture,
      device,
      lastFetchMercBounds: null,
      anyTextureLoaded: false,
      uniforms,
      flowUniforms,
    });
  }

  override updateState(
    params: UpdateParameters<Layer<SatelliteCompositeLayerProps>>,
  ): void {
    const state = this.state as unknown as CompositorState;
    const newSats = params.props.satellites;
    const oldSats = params.oldProps.satellites;

    if (newSats === oldSats) return;

    const oldById = new Map(state.entries.map((e) => [e.config.id, e]));

    // Clean up entries whose satellites were removed
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
      // Same URL — keep existing texture
      if (old && old.config.wmsUrlTemplate === config.wmsUrlTemplate) {
        return { ...old, config };
      }
      // Config exists but URL changed (time advanced / viewport moved).
      // Abort any in-flight load, keep showing old texture.
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
      // Brand-new satellite
      return {
        config,
        prevTexture: null,
        nextTexture: null,
        flowTexture: null,
        flowFramebuffer: null,
        flowSize: null,
        prevMercBounds: null,
        nextMercBounds: null,
        loadedUrlTemplate: null,
        loadError: false,
        loading: false,
        abortController: null,
        fetchTimer: null,
        retryTimer: null,
      };
    });
  }

  override draw(opts: any): void {
    const state = this.state as unknown as CompositorState;
    const { context, renderPass } = opts;
    const viewport = context.viewport as {
      getBounds: () => [number, number, number, number];
      width: number;
      height: number;
    };

    const mercBounds = mercatorBoundsFromViewport(viewport);

    if (
      shouldRefetch(mercBounds, state.lastFetchMercBounds) ||
      state.entries.some((e) => !e.nextTexture && !e.loading && !e.loadError)
    ) {
      this._fetchTextures(mercBounds, viewport);
    }

    if (!state.model || !state.anyTextureLoaded) return;

    const satParams: number[] = [];
    const satOpacity: number[] = [];
    const hasPrevTex: number[] = [];
    const hasNextTex: number[] = [];
    const hasFlowTex: number[] = [];
    const bindings: Record<string, Texture> = {};

    for (let i = 0; i < MAX_SATELLITES; i++) {
      const entry = state.entries[i];
      if (entry?.prevTexture || entry?.nextTexture) {
        satParams.push(
          entry.config.subPoint[0],
          entry.config.subPoint[1],
          entry.config.coverageRadiusDeg,
          entry.config.featherRadiusDeg,
        );
        satOpacity.push(entry.config.opacity);
        hasPrevTex.push(entry.prevTexture ? 1 : 0);
        hasNextTex.push(entry.nextTexture ? 1 : 0);
        hasFlowTex.push(entry.flowTexture ? 1 : 0);
        bindings[`uPrevTex${i}`] = entry.prevTexture ?? state.fallbackTexture!;
        bindings[`uNextTex${i}`] = entry.nextTexture ?? entry.prevTexture ?? state.fallbackTexture!;
        bindings[`uFlowTex${i}`] = entry.flowTexture ?? state.fallbackTexture!;
      } else {
        satParams.push(0, 0, 0, 0);
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
    while (satOpacity.length < MAX_SATELLITES) satOpacity.push(0);
    while (hasPrevTex.length < MAX_SATELLITES) hasPrevTex.push(0);
    while (hasNextTex.length < MAX_SATELLITES) hasNextTex.push(0);
    while (hasFlowTex.length < MAX_SATELLITES) hasFlowTex.push(0);

    state.model.setBindings(bindings as any);

    // Mutate the uniforms object by reference — luma.gl 9.x reads
    // `this.props.uniforms` on each draw call (no setUniforms API).
    const u = state.uniforms!;
    u.uMercBounds = mercBounds;
    u.uSatParams = satParams;
    u.uSatCount = state.entries.length;
    u.uSatOpacity = satOpacity;
    u.uHasPrevTex = hasPrevTex;
    u.uHasNextTex = hasNextTex;
    u.uHasFlowTex = hasFlowTex;
    u.uTimeProgress = Math.max(0, Math.min(1, this.props.timeProgress ?? 0));
    u.uMaxFlowUv = MAX_FLOW_UV;

    state.model.draw(renderPass);
  }

  override finalizeState(): void {
    const state = this.state as unknown as CompositorState;
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
    mercBounds: [number, number, number, number],
    viewport: { width: number; height: number },
  ): void {
    const state = this.state as unknown as CompositorState;
    state.lastFetchMercBounds = mercBounds;

    const [texW, texH] = viewportTexDimensions(viewport);

    state.entries.forEach((entry, index) => {
      if (entry.loading) return;
      if (
        entry.nextTexture &&
        entry.nextMercBounds &&
        entry.loadedUrlTemplate === entry.config.wmsUrlTemplate &&
        !shouldRefetch(mercBounds, entry.nextMercBounds) &&
        entry.config.wmsUrlTemplate
      ) {
        return;
      }
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

      const url = buildProxiedWmsUrl(entry.config.wmsUrlTemplate, mercBounds, texW, texH);

      entry.fetchTimer = window.setTimeout(() => {
        entry.fetchTimer = null;
        loadImageWithRetry(url, controller.signal)
          .then((bitmap) => {
            if (controller.signal.aborted) {
              bitmap.close?.();
              return;
            }
            const newTexture = state.device!.createTexture({
              data: bitmap,
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
            bitmap.close?.();

            const oldPrev = entry.prevTexture;
            if (entry.nextTexture) {
              entry.prevTexture = entry.nextTexture;
              entry.prevMercBounds = entry.nextMercBounds;
            }
            entry.nextTexture = newTexture;
            entry.nextMercBounds = mercBounds;
            entry.loadedUrlTemplate = entry.config.wmsUrlTemplate;
            entry.loadError = false;
            entry.loading = false;
            entry.abortController = null;
            oldPrev?.destroy();

            if (entry.prevTexture && entry.nextTexture) {
              this._computeFlowTexture(entry);
            }
            state.anyTextureLoaded = true;
            this.setNeedsRedraw();
          })
          .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError") {
              entry.loading = false;
              return;
            }
            entry.loadError = !entry.nextTexture && !entry.prevTexture;
            entry.loading = false;
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
      // Flow is an enhancement. If it fails on a WebGL driver, keep the dual
      // texture morph alive as a plain cross-dissolve instead of blanking.
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

// ── Public API ─────────────────────────────────────────────────────────────

/** Create a SatelliteCompositeLayer for active geostationary satellite layers.
  Returns null when there are no satellites to composite. */
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

/** Retrieve satellite disk params for a layer, if it is a geostationary satellite. */
export function getSatelliteDiskParams(
  layerId: string,
): SatelliteDiskParams | null {
  const params = GEOSTATIONARY_SATELLITES[layerId];
  if (!params) return null;
  return { ...params };
}

/** Check if a layer ID belongs to a known geostationary satellite. */
export function isGeostationarySatellite(layerId: string): boolean {
  return layerId in GEOSTATIONARY_SATELLITES;
}
