import { Layer } from "@deck.gl/core";
import type { LayerProps, UpdateParameters } from "@deck.gl/core";
import { Geometry, Model } from "@luma.gl/engine";

import { subSolarPoint } from "./terminator";

export interface AtmosphereLayerOptions {
  id?: string;
  timeMs: number;
  photoGrade?: boolean;
  intensity?: number;
}

interface AtmosphereLayerProps extends LayerProps {
  timeMs: number;
  photoGrade: boolean;
  intensity: number;
}

interface AtmosphereState {
  model: Model | null;
  uniforms: Record<string, unknown> | null;
  timeMs: number;
}

const EARTH_CIRCUMFERENCE_TILE_PX = 512;
const MIN_GLOBE_RADIUS_PX = 42;
const MAX_RADIUS_VIEWPORT_MULTIPLIER = 5.5;

const VS = `\
#version 300 es
in vec2 aPosition;
out vec2 vNdc;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
  vNdc = aPosition;
}
`;

const FS = `\
#version 300 es
precision highp float;

in vec2 vNdc;
out vec4 fragColor;

uniform float uAspect;
uniform float uGlobeRadius;
uniform vec3 uSunViewDir;
uniform float uIntensity;
uniform float uPhotoGrade;

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 screen = vec2(vNdc.x * uAspect, vNdc.y);
  vec2 p = screen / max(uGlobeRadius, 0.0001);
  float r = length(p);
  if (r > 1.18) discard;

  vec3 sun = normalize(uSunViewDir);
  vec3 view = vec3(0.0, 0.0, 1.0);
  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (r <= 1.0) {
    float z = sqrt(max(0.0, 1.0 - r * r));
    vec3 normal = normalize(vec3(p, z));
    float mu = dot(normal, sun);
    float viewMu = clamp(dot(normal, view), 0.0, 1.0);
    float limb = pow(1.0 - viewMu, 2.05);
    float daylight = smoothstep(-0.32, 0.78, mu);
    float twilight = exp(-abs(mu) * 7.0) * limb;

    vec3 rayleigh = vec3(0.18, 0.42, 1.0) * (0.18 + 0.82 * daylight) * pow(limb, 1.18);
    vec3 ozone = vec3(0.32, 0.58, 1.0) * twilight * 0.42;
    float miePhase = pow(max(dot(normalize(vec3(p * 0.18, 1.0)), sun), 0.0), 18.0);
    vec3 mie = vec3(1.0, 0.82, 0.56) * miePhase * daylight * 0.055;

    color += rayleigh + ozone + mie;
    alpha += (0.050 * daylight + 0.075 * twilight + limb * 0.070) * uIntensity;

    if (uPhotoGrade > 0.5) {
      float night = 1.0 - smoothstep(-0.18, 0.22, mu);
      float warm = smoothstep(0.25, 1.0, mu) * (1.0 - limb * 0.55);
      vec3 grade = mix(vec3(0.05, 0.10, 0.18), vec3(0.20, 0.17, 0.12), warm);
      color += grade * (0.26 + night * 0.28);
      alpha += (0.018 + night * 0.040 + limb * 0.022) * uIntensity;
    }

    float glint = pow(max(dot(reflect(-sun, normal), view), 0.0), 52.0) * daylight;
    color += vec3(0.70, 0.88, 1.0) * glint * 0.10;
    alpha += glint * 0.050;
  } else {
    float shell = smoothstep(1.18, 1.0, r);
    float horizon = smoothstep(1.18, 1.02, r) * smoothstep(0.98, 1.08, r);
    vec3 shellNormal = normalize(vec3(p / max(r, 0.0001), 0.055));
    float sunAtShell = smoothstep(-0.45, 0.92, dot(shellNormal, sun));
    float forward = pow(max(dot(normalize(vec3(p * 0.22, 1.0)), sun), 0.0), 10.0);

    vec3 rayleigh = vec3(0.16, 0.42, 1.0) * (0.35 + 0.65 * sunAtShell);
    vec3 amber = vec3(1.0, 0.54, 0.22) * forward * 0.22;
    color += rayleigh + amber;
    alpha += horizon * shell * (0.30 * sunAtShell + 0.06) * uIntensity;
  }

  color = mix(color, acesFilm(color * 1.18), uPhotoGrade * 0.35);
  fragColor = vec4(color, clamp(alpha, 0.0, 0.48));
}
`;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}

function cartesianFromLonLat(lon: number, lat: number): [number, number, number] {
  const phi = deg2rad(lat);
  const lambda = deg2rad(lon);
  return [
    Math.cos(phi) * Math.cos(lambda),
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
  ];
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sunViewDirection(timeMs: number, centerLon: number, centerLat: number): [number, number, number] {
  const sun = cartesianFromLonLat(...subSolarPoint(new Date(timeMs)));
  const up = cartesianFromLonLat(centerLon, centerLat);
  const worldNorth: [number, number, number] = [0, 0, 1];
  let east = cross(worldNorth, up);
  if (Math.hypot(...east) < 1e-4) east = [1, 0, 0];
  east = normalize3(east);
  const north = normalize3(cross(up, east));
  return normalize3([dot(sun, east), dot(sun, north), dot(sun, up)]);
}

function globeRadiusPx(zoom: number, width: number, height: number): number {
  const raw = (EARTH_CIRCUMFERENCE_TILE_PX * 2 ** zoom) / (2 * Math.PI);
  const maxRadius = Math.max(width, height) * MAX_RADIUS_VIEWPORT_MULTIPLIER;
  return clamp(raw, MIN_GLOBE_RADIUS_PX, maxRadius);
}

function createFullscreenGeometry(): Geometry {
  return new Geometry({
    topology: "triangle-strip",
    attributes: {
      aPosition: { size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) },
    },
  });
}

export class AtmosphereLayer extends Layer<AtmosphereLayerProps> {
  static override layerName = "AtmosphereLayer";

  override initializeState(): void {
    const device = this.context.device;
    this.getAttributeManager()?.remove(["instancePickingColors"]);
    const uniforms: Record<string, unknown> = {
      uAspect: 1,
      uGlobeRadius: 1,
      uSunViewDir: [0, 0, 1],
      uIntensity: clamp(this.props.intensity, 0, 1.4),
      uPhotoGrade: this.props.photoGrade ? 1 : 0,
    };
    const model = new Model(device, {
      id: `${this.props.id}-model`,
      vs: VS,
      fs: FS,
      topology: "triangle-strip" as any,
      vertexCount: 4,
      geometry: createFullscreenGeometry(),
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
    this.setState({ model, uniforms, timeMs: this.props.timeMs });
  }

  override updateState(params: UpdateParameters<Layer<AtmosphereLayerProps>>): void {
    const state = this.state as unknown as AtmosphereState | undefined;
    if (!state?.uniforms) return;
    if (params.props.photoGrade !== params.oldProps.photoGrade) {
      state.uniforms.uPhotoGrade = params.props.photoGrade ? 1 : 0;
    }
    if (params.props.intensity !== params.oldProps.intensity) {
      state.uniforms.uIntensity = clamp(params.props.intensity, 0, 1.4);
    }
    if (
      params.props.timeMs !== params.oldProps.timeMs
      || params.props.photoGrade !== params.oldProps.photoGrade
      || params.props.intensity !== params.oldProps.intensity
    ) {
      (this.state as unknown as AtmosphereState).timeMs = params.props.timeMs;
      this.setNeedsRedraw();
    }
  }

  override draw(opts: any): void {
    const state = this.state as unknown as AtmosphereState | undefined;
    if (!state?.model || !state.uniforms) return;
    const viewport = opts.context.viewport as {
      width: number;
      height: number;
      zoom?: number;
      longitude?: number;
      latitude?: number;
    };
    const width = Math.max(1, viewport.width);
    const height = Math.max(1, viewport.height);
    const zoom = Number.isFinite(viewport.zoom) ? viewport.zoom! : 1.5;
    const centerLon = Number.isFinite(viewport.longitude) ? viewport.longitude! : 0;
    const centerLat = Number.isFinite(viewport.latitude) ? viewport.latitude! : 0;

    state.uniforms.uAspect = width / height;
    state.uniforms.uGlobeRadius = globeRadiusPx(zoom, width, height) / (height * 0.5);
    state.uniforms.uSunViewDir = sunViewDirection(state.timeMs, centerLon, centerLat);
    state.model.draw(opts.renderPass);
  }

  setTimeMs(ms: number): void {
    const state = this.state as unknown as AtmosphereState | undefined;
    if (!state?.uniforms) return;
    state.timeMs = ms;
    this.setNeedsRedraw();
  }

  override finalizeState(): void {
    const state = this.state as unknown as AtmosphereState | undefined;
    state?.model?.destroy();
  }
}

export function createAtmosphereLayer(opts: AtmosphereLayerOptions): AtmosphereLayer {
  return new AtmosphereLayer({
    id: opts.id ?? "photoreal-atmosphere",
    timeMs: opts.timeMs,
    photoGrade: opts.photoGrade ?? true,
    intensity: clamp(opts.intensity ?? 1, 0, 1.4),
    pickable: false,
  });
}
