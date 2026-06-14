/** Satellite TLE feed: our cached CelesTrak proxy (transport: proxy).
 *
 * Unlike point feeds, the payload is a TLE *set*; the parser turns each record
 * into a propagatable `Satellite` (satrec + identity) so the orbit layer can
 * run SGP4 per frame without re-parsing. Daily cadence matches the upstream
 * refresh — TLE epochs drift slowly. */

import { API_BASE_URL } from "../api";
import { toSatellite, type Satellite, type Tle } from "../orbits/propagate";
import type { FeedDefinition } from "./feedClient";

function apiBase(): string {
  return API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
}

export function parseTleSet(body: unknown): Satellite[] {
  const records = (body as { satellites?: unknown[] })?.satellites;
  if (!Array.isArray(records)) return [];
  const out: Satellite[] = [];
  for (const raw of records as Tle[]) {
    if (!raw?.line1 || !raw?.line2) continue;
    const sat = toSatellite(raw);
    if (sat) out.push(sat);
  }
  return out;
}

/** Default group is "stations" (ISS + space stations — small, high-interest).
 * Other allow-listed groups are selectable via the group argument. */
export function orbitsFeed(group = "stations"): FeedDefinition<Satellite> {
  return {
    id: `celestrak-${group}`,
    intervalMs: 6 * 60 * 60 * 1000,
    transport: "proxy",
    url: () => `${apiBase()}/api/v1/orbits/tle?group=${encodeURIComponent(group)}`,
    parse: parseTleSet,
  };
}
