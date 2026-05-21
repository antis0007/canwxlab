import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";

/**
 * Day/night terminator polygon for a given UTC time.
 *
 * Returns a single closed ring covering the night hemisphere, ready to feed
 * into a deck.gl PolygonLayer. The sub-solar point is computed via a
 * simplified solar position model accurate to ~0.5° — plenty for visual
 * shading at zoom levels we care about.
 */

function julianCenturyUTC(date: Date): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  return (jd - 2_451_545.0) / 36_525.0;
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}

/** Returns the sub-solar point [lon, lat] in degrees for a given UTC instant. */
export function subSolarPoint(date: Date): [number, number] {
  // Simplified NOAA solar position algorithm (Meeus, simplified).
  const T = julianCenturyUTC(date);

  // Geometric mean longitude (deg)
  const L0 = (280.46646 + T * (36_000.76983 + T * 0.0003032)) % 360;
  // Mean anomaly
  const M = 357.52911 + T * (35_999.05029 - 0.0001537 * T);
  // Equation of center
  const Mr = deg2rad(M);
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  // Apparent longitude
  const omega = 125.04 - 1934.136 * T;
  const lambda = deg2rad(trueLong - 0.00569 - 0.00478 * Math.sin(deg2rad(omega)));
  // Obliquity of ecliptic
  const epsilon = deg2rad(
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60,
  );
  // Declination
  const decl = rad2deg(Math.asin(Math.sin(epsilon) * Math.sin(lambda)));

  // Greenwich mean sidereal time (deg)
  const gmst =
    (280.46061837 +
      360.98564736629 * (date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0) +
      0.000387933 * T * T -
      (T * T * T) / 38_710_000) %
    360;

  // Right ascension of the Sun
  const ra = rad2deg(Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)));
  let subLon = ra - gmst;
  subLon = ((subLon + 540) % 360) - 180; // wrap to [-180, 180]
  return [subLon, decl];
}

/** Polygon ring (lng,lat) outlining the night hemisphere for the given UTC time. */
export function nightHemisphereRing(date: Date, steps = 180): [number, number][] {
  const [sunLon, sunLat] = subSolarPoint(date);
  // Antipodal point (centre of the night hemisphere)
  const cLon = ((sunLon + 360) % 360) - 180 + 180; // = sunLon + 180
  const cLat = -sunLat;
  // Walk a great circle 90° from the antipodal centre — that's the terminator.
  const ring: [number, number][] = [];
  const cLatR = deg2rad(cLat);
  const cLonR = deg2rad(((cLon + 540) % 360) - 180);
  const d = Math.PI / 2; // angular distance = 90°
  for (let i = 0; i <= steps; i += 1) {
    const brg = deg2rad((i / steps) * 360);
    const lat = Math.asin(
      Math.sin(cLatR) * Math.cos(d) + Math.cos(cLatR) * Math.sin(d) * Math.cos(brg),
    );
    const lon =
      cLonR +
      Math.atan2(
        Math.sin(brg) * Math.sin(d) * Math.cos(cLatR),
        Math.cos(d) - Math.sin(cLatR) * Math.sin(lat),
      );
    ring.push([((rad2deg(lon) + 540) % 360) - 180, rad2deg(lat)]);
  }
  return ring;
}

export interface TerminatorLayerOptions {
  id?: string;
  timeMs: number;
  /** 0..1 darkness intensity of the night-side shading. */
  intensity?: number;
}

interface TerminatorLayerProps extends LayerProps {
  timeMs: number;
  intensity: number;
}

interface TerminatorState {
  model: Model | null;
  uniforms: Record<string, unknown> | null;
  geometryKey: string | null;
}

const EARTH_RADIUS_M = 6_378_137.0;
const VIEWPORT_MESH_SEGMENTS = 64;

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

uniform float uEarthRadius;
uniform vec3 uSunCartesian;
uniform float uIntensity;

const float PI = 3.141592653589793;
const float DEG_TO_RAD = PI / 180.0;
const float RAD_TO_DEG = 180.0 / PI;

// Atmospheric refraction lifts the apparent sun ~0.5° above the geometric
// horizon — shifts the effective terminator by sin(0.5°) ≈ 0.00873.
const float REFRACTION = 0.00873;

// Twilight band boundaries in sin(solar-elevation) space.
// sunDot = sin(elevation): 0 at horizon, negative below.
// Civil end / nautical start: sin(-6°)  = -0.10453
// Nautical end / astro start: sin(-12°) = -0.20791
// Astronomical end / night:   sin(-18°) = -0.30902
const float CIVIL_END   = -0.10453;
const float NAUTICAL_END = -0.20791;
const float NIGHT_START  = -0.30902;

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

void main() {
  float lon = mercatorXToLon(vMercator.x);
  float lat = mercatorYToLat(vMercator.y);
  vec3 fragCart = latLonToCartesian(lat, lon);

  // sin(solar elevation) at this surface point, with refraction correction.
  float sinElev = dot(normalize(fragCart), normalize(uSunCartesian)) + REFRACTION;

  if (sinElev >= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // Normalized depth into twilight: 0 at terminator, 1 at astronomical night.
  float t = clamp(sinElev / NIGHT_START, 0.0, 1.0);

  // Twilight colors physically motivated by Rayleigh scattering:
  //  Civil:       warm orange-amber (scattered red/orange photons near horizon)
  //  Nautical:    deep blue-indigo (shorter wavelengths dominate)
  //  Astronomical/night: near-black with cool blue tint
  vec3 civilColor = vec3(0.32, 0.09, 0.02);
  vec3 nautColor  = vec3(0.04, 0.05, 0.22);
  vec3 astroColor = vec3(0.018, 0.025, 0.095);
  vec3 nightColor = vec3(0.010, 0.016, 0.055);

  // Transition factors — each goes 0→1 through its respective band.
  // Chained mix: civil→nautical→astro→night as sinElev decreases.
  float c2n = smoothstep(0.0, CIVIL_END / NIGHT_START, t);    // civil→nautical
  float n2a = smoothstep(CIVIL_END / NIGHT_START, NAUTICAL_END / NIGHT_START, t); // nautical→astro
  float a2n = smoothstep(NAUTICAL_END / NIGHT_START, 1.0, t); // astro→night

  vec3 rgb = civilColor;
  rgb = mix(rgb, nautColor, c2n);
  rgb = mix(rgb, astroColor, n2a);
  rgb = mix(rgb, nightColor, a2n);

  // Alpha: 0 at terminator, ~0.90 deep in true night.
  // S-curved so civil twilight reads as a glow, nautical darkens more steeply.
  float alpha = t * t * (3.0 - 2.0 * t) * 0.92;

  fragColor = vec4(rgb, clamp(alpha * uIntensity, 0.0, 0.92));
}
`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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

function sunCartesian(timeMs: number): [number, number, number] {
  const [lon, lat] = subSolarPoint(new Date(timeMs));
  const phi = deg2rad(lat);
  const lambda = deg2rad(lon);
  return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
}

export class TerminatorLayer extends Layer<TerminatorLayerProps> {
  static override layerName = "TerminatorLayer";

  override initializeState(): void {
    const device = this.context.device;
    this.getAttributeManager()?.remove(["instancePickingColors"]);
    const uniforms: Record<string, unknown> = {
      uEarthRadius: EARTH_RADIUS_M,
      uSunCartesian: sunCartesian(this.props.timeMs),
      uIntensity: clamp(this.props.intensity, 0, 1),
    };
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
        blendColorDstFactor: "one-minus-src-alpha",
        depthTest: false,
        depthWriteEnabled: false,
      } as any,
    });

    this.setState({ model, uniforms, geometryKey: null });
  }

  override updateState(params: UpdateParameters<Layer<TerminatorLayerProps>>): void {
    const state = this.state as unknown as TerminatorState | undefined;
    if (!state?.uniforms) return;
    if (
      params.props.timeMs !== params.oldProps.timeMs
      || params.props.intensity !== params.oldProps.intensity
    ) {
      state.uniforms.uSunCartesian = sunCartesian(params.props.timeMs);
      state.uniforms.uIntensity = clamp(params.props.intensity, 0, 1);
      this.setNeedsRedraw();
    }
  }

  override draw(opts: any): void {
    const state = this.state as unknown as TerminatorState | undefined;
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
    state.model.draw(opts.renderPass);
  }

  /** Imperatively update the sun position without a React prop cycle. */
  setTimeMs(ms: number): void {
    const state = this.state as unknown as TerminatorState | undefined;
    if (!state?.uniforms) return;
    state.uniforms.uSunCartesian = sunCartesian(ms);
    this.setNeedsRedraw();
  }

  override finalizeState(): void {
    const state = this.state as unknown as TerminatorState | undefined;
    state?.model?.destroy();
  }
}

/** A deck.gl layer shading the night side of the Earth. */
export function createTerminatorLayer(opts: TerminatorLayerOptions): TerminatorLayer {
  return new TerminatorLayer({
    id: opts.id ?? "terminator-night",
    timeMs: opts.timeMs,
    intensity: clamp(opts.intensity ?? 0.45, 0, 1),
    pickable: false,
  });
}
