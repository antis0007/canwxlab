/** OpenSky Network live aircraft state vectors — anonymous access, bbox
 * gated. Feed definition for the liveFeeds kernel; parsing only.
 *
 * Anonymous quota is tight (~400 requests/day), so the cadence is 30 s and
 * the kernel only polls while the layer is enabled. Positions between polls
 * are dead-reckoned by the layer builder. */

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

// OpenSky /states/all row layout (positional array per aircraft).
const ICAO24 = 0;
const CALLSIGN = 1;
const TIME_POSITION = 3;
const LONGITUDE = 5;
const LATITUDE = 6;
const BARO_ALTITUDE = 7;
const ON_GROUND = 8;
const VELOCITY = 9;
const TRUE_TRACK = 10;
const SQUAWK = 14;

export function parseAircraft(body: unknown): AircraftState[] {
  const states = (body as { states?: unknown[] })?.states;
  if (!Array.isArray(states)) return [];

  const out: AircraftState[] = [];
  for (const raw of states) {
    if (!Array.isArray(raw)) continue;
    // Explicit null check: Number(null) is 0, which would teleport
    // position-less aircraft to the gulf of Guinea.
    if (raw[LONGITUDE] == null || raw[LATITUDE] == null) continue;
    const lon = Number(raw[LONGITUDE]);
    const lat = Number(raw[LATITUDE]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const positionTime = Number(raw[TIME_POSITION]);
    out.push({
      id: String(raw[ICAO24] ?? `${lon},${lat}`),
      callsign: String(raw[CALLSIGN] ?? "").trim(),
      lon,
      lat,
      altitudeM: Number.isFinite(Number(raw[BARO_ALTITUDE])) ? Number(raw[BARO_ALTITUDE]) : null,
      velocityMps: Number(raw[VELOCITY]) || 0,
      headingDeg: Number(raw[TRUE_TRACK]) || 0,
      onGround: Boolean(raw[ON_GROUND]),
      timeMs: Number.isFinite(positionTime) ? positionTime * 1000 : Date.now(),
      squawk: raw[SQUAWK] ? String(raw[SQUAWK]) : null,
    });
  }
  return out;
}

function clampedBboxQuery(bbox: LonLatBounds): string {
  const west = Math.max(-180, bbox[0]);
  const south = Math.max(-85, bbox[1]);
  const east = Math.min(180, bbox[2]);
  const north = Math.min(85, bbox[3]);
  return `lamin=${south.toFixed(3)}&lomin=${west.toFixed(3)}&lamax=${north.toFixed(3)}&lomax=${east.toFixed(3)}`;
}

export const aircraftFeed: FeedDefinition<AircraftState> = {
  id: "opensky-aircraft",
  intervalMs: 30 * 1000,
  url: (bbox) => (bbox
    ? `https://opensky-network.org/api/states/all?${clampedBboxQuery(bbox)}`
    : "https://opensky-network.org/api/states/all"),
  parse: parseAircraft,
};
