/** Pure decoding of the GPU optical-flow field into physical cloud motion.
 *
 * The flow texture packs rg = flow in texture UV per frame interval
 * (encoded around 0.5 with scale MAX_FLOW_UV), b = confidence, a =
 * forward-backward occlusion. Texture v is flipped relative to mercator y
 * (same convention as the composite shader's mercToTexUv). Web Mercator
 * meters are scaled by cos(latitude) to ground meters.
 */

import { MAX_FLOW_UV } from "./flowPipeline";

const EARTH_RADIUS_M = 6_378_137.0;
const RAD_TO_DEG = 180 / Math.PI;

export interface MotionField {
  width: number;
  height: number;
  /** RGBA pixels of the packed flow texture. */
  data: Uint8Array;
  /** RGBA pixels of the bgMask texture (a = cloud probability), or null. */
  cloud: Uint8Array | null;
  /** bgMask dims when different from the flow texture (defaults to width/height). */
  cloudWidth?: number;
  cloudHeight?: number;
  mercBounds: [number, number, number, number];
  intervalMs: number;
}

export interface MotionSampleResult {
  speedMps: number;
  /** Meteorological convention: direction the motion comes FROM, 0° = north. */
  bearingFromDeg: number;
  confidence: number;
  occlusion: number;
  cloudProbability: number;
}

export interface MotionVectorSample extends MotionSampleResult {
  mercX: number;
  mercY: number;
  lon: number;
  lat: number;
}

function mercYToLatRad(y: number): number {
  return 2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2;
}

export function mercatorToLonLat(x: number, y: number): [number, number] {
  return [
    (x / EARTH_RADIUS_M) * RAD_TO_DEG,
    mercYToLatRad(y) * RAD_TO_DEG,
  ];
}

export function decodeMotionSample(
  field: MotionField,
  mercX: number,
  mercY: number,
): MotionSampleResult | null {
  const [west, south, east, north] = field.mercBounds;
  const spanX = east - west;
  const spanY = north - south;
  if (!(spanX > 0) || !(spanY > 0) || !(field.intervalMs > 0)) return null;

  const u = (mercX - west) / spanX;
  const vMerc = (mercY - south) / spanY;
  if (u < 0 || u > 1 || vMerc < 0 || vMerc > 1) return null;

  // Texture v is flipped relative to mercator y.
  const tx = Math.min(field.width - 1, Math.max(0, Math.round(u * (field.width - 1))));
  const ty = Math.min(field.height - 1, Math.max(0, Math.round((1 - vMerc) * (field.height - 1))));
  const p = (ty * field.width + tx) * 4;

  const flowU = (field.data[p] / 255 - 0.5) * (MAX_FLOW_UV * 2);
  const flowV = (field.data[p + 1] / 255 - 0.5) * (MAX_FLOW_UV * 2);
  const confidence = field.data[p + 2] / 255;
  const occlusion = field.data[p + 3] / 255;

  let cloudProbability = 1;
  if (field.cloud) {
    const cw = field.cloudWidth ?? field.width;
    const ch = field.cloudHeight ?? field.height;
    const cx = Math.min(cw - 1, Math.max(0, Math.round(u * (cw - 1))));
    const cy = Math.min(ch - 1, Math.max(0, Math.round((1 - vMerc) * (ch - 1))));
    cloudProbability = field.cloud[(cy * cw + cx) * 4 + 3] / 255;
  }

  // Flow is prev→next displacement in texture UV; +v in texture space is
  // southward on the ground.
  const dxMerc = flowU * spanX;
  const dyMerc = -flowV * spanY;

  const cosLat = Math.cos(mercYToLatRad(mercY));
  const dxGround = dxMerc * cosLat;
  const dyGround = dyMerc * cosLat;

  const dt = field.intervalMs / 1000;
  const speedMps = Math.hypot(dxGround, dyGround) / dt;
  if (!Number.isFinite(speedMps)) return null;

  // Compass bearing of motion direction (toward), then "from" convention.
  const bearingToDeg = (Math.atan2(dxGround, dyGround) * RAD_TO_DEG + 360) % 360;
  const bearingFromDeg = (bearingToDeg + 180) % 360;

  return { speedMps, bearingFromDeg, confidence, occlusion, cloudProbability };
}

export interface MotionGridOptions {
  viewMercBounds: [number, number, number, number];
  cols: number;
  rows: number;
  maxCount: number;
  minConfidence?: number;
  maxOcclusion?: number;
  minCloudProbability?: number;
}

export function sampleMotionGrid(field: MotionField, opts: MotionGridOptions): MotionVectorSample[] {
  const minConfidence = opts.minConfidence ?? 0.15;
  const maxOcclusion = opts.maxOcclusion ?? 0.5;
  const minCloud = opts.minCloudProbability ?? 0.15;
  const [west, south, east, north] = opts.viewMercBounds;
  const out: MotionVectorSample[] = [];

  for (let row = 0; row < opts.rows; row += 1) {
    for (let col = 0; col < opts.cols; col += 1) {
      if (out.length >= opts.maxCount) return out;
      const mercX = west + ((col + 0.5) / opts.cols) * (east - west);
      const mercY = south + ((row + 0.5) / opts.rows) * (north - south);
      const sample = decodeMotionSample(field, mercX, mercY);
      if (!sample) continue;
      if (sample.confidence < minConfidence) continue;
      if (sample.occlusion > maxOcclusion) continue;
      if (sample.cloudProbability < minCloud) continue;
      const [lon, lat] = mercatorToLonLat(mercX, mercY);
      out.push({ ...sample, mercX, mercY, lon, lat });
    }
  }
  return out;
}

const CARDINALS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

export function bearingToCardinal(bearingDeg: number): string {
  const normalized = ((bearingDeg % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 22.5) % 16];
}

/** One-line inspector formatting: `42 km/h from WSW (247°) · conf 78% · cloud 91%`. */
export function formatMotionProbe(probe: {
  speedKmh: number;
  bearingDeg: number;
  bearingCardinal: string;
  confidence: number;
  cloudProbability: number;
}): string {
  return `${Math.round(probe.speedKmh)} km/h from ${probe.bearingCardinal} (${Math.round(probe.bearingDeg)}°)`
    + ` · conf ${Math.round(probe.confidence * 100)}%`
    + ` · cloud ${Math.round(probe.cloudProbability * 100)}%`;
}
