/** USGS realtime earthquakes — all events, past 24 h, no API key.
 * Feed definition for the liveFeeds kernel; parsing only, no plumbing. */

import type { FeedDefinition } from "./feedClient";

export interface QuakeEvent {
  id: string;
  lon: number;
  lat: number;
  depthKm: number;
  magnitude: number;
  timeMs: number;
  place: string;
}

const USGS_ALL_DAY_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

export function parseQuakes(body: unknown): QuakeEvent[] {
  const features = (body as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) return [];

  const out: QuakeEvent[] = [];
  for (const raw of features) {
    const feature = raw as {
      id?: unknown;
      properties?: { mag?: unknown; time?: unknown; place?: unknown };
      geometry?: { coordinates?: unknown };
    };
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const timeMs = Number(feature.properties?.time);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(timeMs)) continue;
    out.push({
      id: String(feature.id ?? `${lon},${lat},${timeMs}`),
      lon,
      lat,
      depthKm: Number(coords[2]) || 0,
      magnitude: Number(feature.properties?.mag) || 0,
      timeMs,
      place: String(feature.properties?.place ?? ""),
    });
  }
  return out;
}

/** Global feed (USGS has no bbox param on the summary endpoints); 2-minute
 * cadence matches the upstream regeneration interval. */
export const quakesFeed: FeedDefinition<QuakeEvent> = {
  id: "usgs-quakes",
  intervalMs: 2 * 60 * 1000,
  url: () => USGS_ALL_DAY_URL,
  parse: parseQuakes,
};
