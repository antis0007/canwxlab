import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";

import { hexToRgb, resolveRamp } from "../colorRamps";
import type { LayerRuntimeState } from "../types";

const EARTH_RADIUS_M = 6_378_137.0;
const VIEWPORT_MESH_SEGMENTS = 54;
const MAX_SEGMENTS = 32;
const MAX_ZONES = 8;

type GridStatus = 0 | 1 | 2;

interface GridSegment {
  from: [number, number];
  to: [number, number];
  load: number;
  status: GridStatus;
}

interface GridZone {
  center: [number, number];
  radiusKm: number;
  status: 1 | 2;
}

interface PowerGridLayerProps extends LayerProps {
  timeMs: number;
  opacity: number;
  baseColor: [number, number, number];
  hotColor: [number, number, number];
  warningColor: [number, number, number];
  deadColor: [number, number, number];
  warble: number;
  flowSpeed: number;
  glow: number;
  intensity: number;
  lineWidth: number;
  particleDensity: number;
}

interface PowerGridState {
  model: Model | null;
  uniforms: Record<string, unknown> | null;
  geometryKey: string | null;
}

// Coarse operational-context corridors. These are not a utility network model;
// they are a visual scaffold until source-backed energy adapters provide
// transmission assets and outage events.
const GRID_SEGMENTS: GridSegment[] = [
  { from: [-123.12, 49.28], to: [-120.33, 50.67], load: 0.74, status: 0 },
  { from: [-120.33, 50.67], to: [-114.07, 51.05], load: 0.82, status: 0 },
  { from: [-114.07, 51.05], to: [-113.49, 53.54], load: 0.88, status: 0 },
  { from: [-113.49, 53.54], to: [-110.00, 53.28], load: 0.69, status: 1 },
  { from: [-114.07, 51.05], to: [-112.84, 49.69], load: 0.76, status: 0 },
  { from: [-112.84, 49.69], to: [-106.67, 52.13], load: 0.63, status: 0 },
  { from: [-106.67, 52.13], to: [-97.14, 49.90], load: 0.72, status: 0 },
  { from: [-97.14, 49.90], to: [-89.25, 48.38], load: 0.66, status: 0 },
  { from: [-89.25, 48.38], to: [-79.38, 43.65], load: 0.93, status: 1 },
  { from: [-79.38, 43.65], to: [-75.70, 45.42], load: 0.81, status: 0 },
  { from: [-75.70, 45.42], to: [-73.57, 45.50], load: 0.87, status: 0 },
  { from: [-73.57, 45.50], to: [-71.21, 46.81], load: 0.79, status: 0 },
  { from: [-71.21, 46.81], to: [-66.64, 45.96], load: 0.58, status: 0 },
  { from: [-66.64, 45.96], to: [-63.58, 44.65], load: 0.52, status: 0 },
  { from: [-79.38, 43.65], to: [-82.99, 42.31], load: 0.77, status: 2 },
  { from: [-82.99, 42.31], to: [-87.62, 41.88], load: 0.70, status: 1 },
  { from: [-87.62, 41.88], to: [-93.27, 44.98], load: 0.62, status: 0 },
  { from: [-93.27, 44.98], to: [-104.99, 39.74], load: 0.57, status: 0 },
  { from: [-104.99, 39.74], to: [-112.07, 33.45], load: 0.64, status: 0 },
  { from: [-112.07, 33.45], to: [-118.24, 34.05], load: 0.91, status: 1 },
  { from: [-118.24, 34.05], to: [-122.42, 37.77], load: 0.73, status: 0 },
  { from: [-122.42, 37.77], to: [-123.12, 49.28], load: 0.67, status: 0 },
  { from: [-97.14, 49.90], to: [-96.80, 32.78], load: 0.61, status: 0 },
  { from: [-96.80, 32.78], to: [-90.07, 29.95], load: 0.69, status: 0 },
  { from: [-90.07, 29.95], to: [-84.39, 33.75], load: 0.71, status: 0 },
  { from: [-84.39, 33.75], to: [-77.04, 38.90], load: 0.84, status: 0 },
  { from: [-77.04, 38.90], to: [-74.01, 40.71], load: 0.95, status: 0 },
  { from: [-74.01, 40.71], to: [-73.57, 45.50], load: 0.78, status: 0 },
];

const GRID_ZONES: GridZone[] = [
  { center: [-82.99, 42.31], radiusKm: 210, status: 2 },
  { center: [-79.38, 43.65], radiusKm: 165, status: 1 },
  { center: [-110.00, 53.28], radiusKm: 190, status: 1 },
  { center: [-118.24, 34.05], radiusKm: 230, status: 1 },
];

const VS = `\
#version 300 es
in vec2 aPosition;
in vec2 aMercator;
out vec2 vMercator;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vMercator = aMercator;
}
`;

const FS = `\
#version 300 es
precision highp float;

in vec2 vMercator;
out vec4 fragColor;

uniform int uSegmentCount;
uniform int uZoneCount;
uniform vec2 uSegmentsA[${MAX_SEGMENTS}];
uniform vec2 uSegmentsB[${MAX_SEGMENTS}];
uniform float uSegmentLoad[${MAX_SEGMENTS}];
uniform float uSegmentStatus[${MAX_SEGMENTS}];
uniform vec2 uZoneCenter[${MAX_ZONES}];
uniform float uZoneRadius[${MAX_ZONES}];
uniform float uZoneStatus[${MAX_ZONES}];
uniform float uTime;
uniform float uOpacity;
uniform float uMetersPerPixel;
uniform float uWarblePx;
uniform float uFlowSpeed;
uniform float uGlowPx;
uniform float uIntensity;
uniform float uLineWidthPx;
uniform float uParticleDensity;
uniform vec3 uBaseColor;
uniform vec3 uHotColor;
uniform vec3 uWarningColor;
uniform vec3 uDeadColor;

const float PI = 3.141592653589793;

float hash1(float n) {
  return fract(sin(n * 127.1) * 43758.5453123);
}

float segmentDistance(vec2 p, vec2 a, vec2 b, float idx, out float along) {
  vec2 ba = b - a;
  float h = clamp(dot(p - a, ba) / max(dot(ba, ba), 1.0), 0.0, 1.0);
  vec2 n = normalize(vec2(-ba.y, ba.x));
  float waveA = sin(h * 24.0 + uTime * (1.5 + hash1(idx) * 0.7) + idx);
  float waveB = sin(h * 51.0 - uTime * (0.7 + hash1(idx + 3.0)) + idx * 2.1);
  float warble = (waveA * 0.68 + waveB * 0.32) * uWarblePx * uMetersPerPixel;
  vec2 q = a + ba * h + n * warble;
  along = h;
  return length(p - q);
}

void main() {
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  float zoneAlpha = 0.0;
  vec3 zoneColor = vec3(0.0);

  for (int i = 0; i < ${MAX_ZONES}; i++) {
    if (i >= uZoneCount) break;
    float d = distance(vMercator, uZoneCenter[i]);
    float radius = max(1.0, uZoneRadius[i]);
    float fill = 1.0 - smoothstep(radius * 0.68, radius, d);
    float ring = 1.0 - smoothstep(0.0, radius * 0.08, abs(d - radius * 0.78));
    float pulse = 0.65 + 0.35 * sin(uTime * (uZoneStatus[i] > 1.5 ? 2.2 : 1.35) + float(i) * 1.9);
    vec3 c = mix(uWarningColor, uDeadColor, step(1.5, uZoneStatus[i]));
    float a = (fill * (uZoneStatus[i] > 1.5 ? 0.20 : 0.12) + ring * 0.20 * pulse);
    zoneColor += c * a;
    zoneAlpha = max(zoneAlpha, a);
  }

  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uSegmentCount) break;
    float along = 0.0;
    float d = segmentDistance(vMercator, uSegmentsA[i], uSegmentsB[i], float(i), along);
    float load = clamp(uSegmentLoad[i], 0.0, 1.0);
    float status = uSegmentStatus[i];
    float width = (uLineWidthPx + load * 1.2) * uMetersPerPixel;
    float glowWidth = (uGlowPx * (1.0 + load * 0.9)) * uMetersPerPixel;
    float core = 1.0 - smoothstep(width * 0.45, width * 1.55, d);
    float glow = 1.0 - smoothstep(width, glowWidth, d);
    float flowPhase = along * (10.0 + uParticleDensity * 0.012) - uTime * uFlowSpeed + hash1(float(i)) * 6.0;
    float bead = pow(max(0.0, sin(flowPhase * PI)), 34.0) * (1.0 - smoothstep(width * 0.5, width * 4.2, d));
    float filament = pow(max(0.0, sin((along * 44.0 + uTime * 2.0 + float(i)) * PI)), 8.0) * core * 0.25;
    float alive = 1.0 - step(1.5, status);
    float warning = step(0.5, status) * (1.0 - step(1.5, status));
    vec3 flowColor = mix(uBaseColor, uHotColor, clamp(core + bead, 0.0, 1.0));
    flowColor = mix(flowColor, uWarningColor, warning * 0.72);
    flowColor = mix(flowColor, uDeadColor, step(1.5, status));
    float flicker = 0.82 + 0.18 * sin(uTime * (5.0 + hash1(float(i)) * 2.0) + along * 32.0);
    float lineAlpha = (glow * 0.34 + core * 0.72 + bead * 0.95 + filament) * flicker;
    lineAlpha *= mix(0.28, 1.0, alive);
    rgb += flowColor * lineAlpha * uIntensity;
    alpha = max(alpha, lineAlpha);
  }

  rgb += zoneColor;
  alpha = clamp(max(alpha, zoneAlpha) * uOpacity, 0.0, 0.98);
  if (alpha < 0.006) discard;
  fragColor = vec4(rgb, alpha);
}
`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

function lonLatToMercator(lon: number, lat: number): [number, number] {
  const clampedLat = clamp(lat, -85.05112878, 85.05112878);
  return [
    lon * deg2rad(1) * EARTH_RADIUS_M,
    Math.log(Math.tan((90 + clampedLat) * deg2rad(1) * 0.5)) * EARTH_RADIUS_M,
  ];
}

function mercatorBoundsFromViewport(viewport: {
  getBounds: () => [number, number, number, number];
}): [number, number, number, number] {
  const b = viewport.getBounds();
  const west = Math.min(b[0], b[2]);
  const south = Math.min(b[1], b[3]);
  const east = Math.max(b[0], b[2]);
  const north = Math.max(b[1], b[3]);
  const [westM] = lonLatToMercator(west, 0);
  const [eastM] = lonLatToMercator(east, 0);
  const [, southM] = lonLatToMercator(0, south);
  const [, northM] = lonLatToMercator(0, north);
  return [westM, southM, eastM, northM];
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
    // Fall back to axis-aligned Mercator bounds.
  }
  const u = x / Math.max(1, viewport.width);
  const v = y / Math.max(1, viewport.height);
  return [
    mercBounds[0] + (mercBounds[2] - mercBounds[0]) * u,
    mercBounds[3] + (mercBounds[1] - mercBounds[3]) * v,
  ];
}

function viewportGeometryKey(viewport: any, mercBounds: [number, number, number, number]): string {
  const parts = [
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

function createInitialGeometry(): Geometry {
  return new Geometry({
    topology: "triangle-strip",
    attributes: {
      aPosition: { size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) },
      aMercator: { size: 2, value: new Float32Array(8) },
    },
  });
}

function createViewportGeometry(
  viewport: { width: number; height: number; getBounds: () => [number, number, number, number] },
  mercBounds: [number, number, number, number],
): Geometry {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const positions: number[] = [];
  const mercators: number[] = [];

  const pushVertex = (ix: number, iy: number) => {
    const x = (ix / VIEWPORT_MESH_SEGMENTS) * width;
    const y = (iy / VIEWPORT_MESH_SEGMENTS) * height;
    positions.push((x / width) * 2 - 1, 1 - (y / height) * 2);
    mercators.push(...mercatorAtScreenPoint(viewport, x, y, mercBounds));
  };

  for (let iy = 0; iy < VIEWPORT_MESH_SEGMENTS; iy += 1) {
    for (let ix = 0; ix < VIEWPORT_MESH_SEGMENTS; ix += 1) {
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

function rgbUnit(rgb: [number, number, number]): [number, number, number] {
  return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
}

function segmentUniforms() {
  const segmentsA = new Float32Array(MAX_SEGMENTS * 2);
  const segmentsB = new Float32Array(MAX_SEGMENTS * 2);
  const load = new Float32Array(MAX_SEGMENTS);
  const status = new Float32Array(MAX_SEGMENTS);
  GRID_SEGMENTS.slice(0, MAX_SEGMENTS).forEach((segment, index) => {
    const a = lonLatToMercator(...segment.from);
    const b = lonLatToMercator(...segment.to);
    segmentsA[index * 2] = a[0];
    segmentsA[index * 2 + 1] = a[1];
    segmentsB[index * 2] = b[0];
    segmentsB[index * 2 + 1] = b[1];
    load[index] = segment.load;
    status[index] = segment.status;
  });
  return { segmentsA, segmentsB, load, status };
}

function zoneUniforms() {
  const centers = new Float32Array(MAX_ZONES * 2);
  const radii = new Float32Array(MAX_ZONES);
  const status = new Float32Array(MAX_ZONES);
  GRID_ZONES.slice(0, MAX_ZONES).forEach((zone, index) => {
    const center = lonLatToMercator(...zone.center);
    centers[index * 2] = center[0];
    centers[index * 2 + 1] = center[1];
    radii[index] = zone.radiusKm * 1000;
    status[index] = zone.status;
  });
  return { centers, radii, status };
}

function makeUniforms(props: PowerGridLayerProps): Record<string, unknown> {
  const seg = segmentUniforms();
  const zones = zoneUniforms();
  return {
    uSegmentCount: Math.min(GRID_SEGMENTS.length, MAX_SEGMENTS),
    uZoneCount: Math.min(GRID_ZONES.length, MAX_ZONES),
    uSegmentsA: seg.segmentsA,
    uSegmentsB: seg.segmentsB,
    uSegmentLoad: seg.load,
    uSegmentStatus: seg.status,
    uZoneCenter: zones.centers,
    uZoneRadius: zones.radii,
    uZoneStatus: zones.status,
    uTime: props.timeMs / 1000,
    uOpacity: props.opacity,
    uMetersPerPixel: 1000,
    uWarblePx: props.warble,
    uFlowSpeed: props.flowSpeed,
    uGlowPx: props.glow,
    uIntensity: props.intensity,
    uLineWidthPx: props.lineWidth,
    uParticleDensity: props.particleDensity,
    uBaseColor: props.baseColor,
    uHotColor: props.hotColor,
    uWarningColor: props.warningColor,
    uDeadColor: props.deadColor,
  };
}

export class PowerGridLayer extends Layer<PowerGridLayerProps> {
  static override layerName = "PowerGridLayer";

  override initializeState(): void {
    const device = this.context.device;
    this.getAttributeManager()?.remove(["instancePickingColors"]);
    const uniforms = makeUniforms(this.props);
    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: "triangle-strip" as any,
      vertexCount: 4,
      geometry: createInitialGeometry(),
      uniforms,
      disableWarnings: true,
      parameters: {
        blend: true,
        blendColorSrcFactor: "src-alpha",
        blendColorDstFactor: "one",
        blendAlphaSrcFactor: "one",
        blendAlphaDstFactor: "one-minus-src-alpha",
        depthTest: false,
        depthWriteEnabled: false,
      } as any,
    });
    this.setState({ model, uniforms, geometryKey: null });
  }

  override updateState(params: UpdateParameters<Layer<PowerGridLayerProps>>): void {
    const state = this.state as unknown as PowerGridState | undefined;
    if (!state?.uniforms) return;
    if (params.props !== params.oldProps) {
      Object.assign(state.uniforms, makeUniforms(params.props));
      this.setNeedsRedraw();
    }
  }

  override draw(opts: any): void {
    const state = this.state as unknown as PowerGridState | undefined;
    if (!state?.model || !state.uniforms) return;
    const viewport = opts.context.viewport as {
      getBounds: () => [number, number, number, number];
      width: number;
      height: number;
    };
    const mercBounds = mercatorBoundsFromViewport(viewport);
    const key = viewportGeometryKey(viewport, mercBounds);
    if (state.geometryKey !== key) {
      state.model.setGeometry(createViewportGeometry(viewport, mercBounds));
      state.geometryKey = key;
    }
    const metersPerPixelX = Math.abs(mercBounds[2] - mercBounds[0]) / Math.max(1, viewport.width);
    const metersPerPixelY = Math.abs(mercBounds[3] - mercBounds[1]) / Math.max(1, viewport.height);
    state.uniforms.uMetersPerPixel = Math.max(1, Math.min(metersPerPixelX, metersPerPixelY));
    state.model.draw(opts.renderPass);
  }

  setTimeMs(ms: number): void {
    const state = this.state as unknown as PowerGridState | undefined;
    if (!state?.uniforms) return;
    state.uniforms.uTime = ms / 1000;
    this.setNeedsRedraw();
  }

  override finalizeState(): void {
    const state = this.state as unknown as PowerGridState | undefined;
    state?.model?.destroy();
  }
}

export function createPowerGridLayer(options: {
  id?: string;
  runtime: LayerRuntimeState;
  timeMs: number;
}): PowerGridLayer {
  const ramp = resolveRamp(options.runtime.colourRamp);
  const first = hexToRgb(ramp.stops[1]?.color ?? ramp.stops[0]?.color ?? "#0891b2") ?? [8, 145, 178];
  const hot = hexToRgb(ramp.stops[ramp.stops.length - 1]?.color ?? "#ecfeff") ?? [236, 254, 255];
  return new PowerGridLayer({
    id: options.id ?? "power-grid-flow-vfx",
    pickable: false,
    timeMs: options.timeMs,
    opacity: clamp(options.runtime.opacity, 0, 1),
    baseColor: rgbUnit(first),
    hotColor: rgbUnit(hot),
    warningColor: rgbUnit([250, 204, 21]),
    deadColor: rgbUnit([239, 68, 68]),
    warble: 0.35 + clamp(options.runtime.controls.smoothing, 0, 1) * 2.15,
    flowSpeed: clamp(options.runtime.controls.windScale, 0.1, 4),
    glow: 7 + clamp(options.runtime.controls.cloudOpacity, 0, 1) * 24,
    intensity: clamp(options.runtime.controls.precipitationIntensity, 0.1, 4),
    lineWidth: clamp(options.runtime.controls.contourInterval, 1, 12),
    particleDensity: clamp(options.runtime.controls.particleCount, 100, 8000),
  });
}
