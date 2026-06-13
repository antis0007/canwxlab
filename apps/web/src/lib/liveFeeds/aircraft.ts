/** Live aircraft state vectors via our own cached aircraft endpoint
 * (transport: proxy). OpenSky forbids direct browser fetches (CORS) and its
 * anonymous quota is tight, so the server adapter owns the upstream fetch,
 * caching, and rate-limit handling; the browser just polls our GeoJSON.
 *
 * Cadence is 30 s and the kernel only polls while the layer is enabled.
 * Positions between polls are dead-reckoned by the layer builder. */

import { API_BASE_URL } from "../api";
import type { FeedDefinition, LonLatBounds } from "./feedClient";

export interface AircraftState {
  id: string;
  callsign: string;
  lon: number;
  lat: number;
  /** Barometric altitude, meters; null on ground or unknown. */
  altitudeM: number | null;
  /** Ground speed, m/s. */
  velocityMps: number;
  /** True track, degrees clockwise from north. */
  headingDeg: number;
  onGround: boolean;
  /** Position report age anchor for dead reckoning. */
  timeMs: number;
  /** Transponder squawk; 7500/7600/7700 are emergencies. */
  squawk: string | null;
}

interface AircraftFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    icao24?: string;
    callsign?: string;
    baro_altitude_m?: number | null;
    velocity_ms?: number | null;
    heading_deg?: number | null;
    on_ground?: boolean;
    squawk?: string | null;
    observed_at?: string | null;
  };
}

export function parseAircraft(body: unknown): AircraftState[] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];

  const out: AircraftState[] = [];
  for (const feature of features as AircraftFeature[]) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = feature.properties ?? {};
    const observedMs = p.observed_at ? Date.parse(p.observed_at) : Number.NaN;
    out.push({
      id: String(p.icao24 || `${lon},${lat}`),
      callsign: String(p.callsign ?? "").trim(),
      lon,
      lat,
      altitudeM: typeof p.baro_altitude_m === "number" ? p.baro_altitude_m : null,
      velocityMps: typeof p.velocity_ms === "number" ? p.velocity_ms : 0,
      headingDeg: typeof p.heading_deg === "number" ? p.heading_deg : 0,
      onGround: Boolean(p.on_ground),
      timeMs: Number.isFinite(observedMs) ? observedMs : Date.now(),
      squawk: p.squawk ? String(p.squawk) : null,
    });
  }
  return out;
}

function bboxQuery(bbox: LonLatBounds): string {
  const west = Math.max(-180, bbox[0]);
  const south = Math.max(-85, bbox[1]);
  const east = Math.min(180, bbox[2]);
  const north = Math.min(85, bbox[3]);
  // The aircraft endpoint takes minLon,minLat,maxLon,maxLat (EPSG:4326).
  return `bbox=${west.toFixed(3)},${south.toFixed(3)},${east.toFixed(3)},${north.toFixed(3)}`;
}

function apiBase(): string {
  return API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
}

export const aircraftFeed: FeedDefinition<AircraftState> = {
  id: "opensky-aircraft",
  intervalMs: 30 * 1000,
  transport: "proxy",
  url: (bbox) => (bbox
    ? `${apiBase()}/api/v1/aircraft/positions?${bboxQuery(bbox)}`
    : `${apiBase()}/api/v1/aircraft/positions`),
  parse: parseAircraft,
};
