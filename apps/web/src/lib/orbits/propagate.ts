/** Pure SGP4 propagation helpers over satellite.js.
 *
 * Spec law 2: no fetching, no React, no GPU — given a parsed TLE and a time,
 * these return plain geodetic data that the orbit layer builders turn into
 * deck layers. Fully unit-testable from a TLE string.
 *
 * Coordinates: longitude/latitude in degrees, altitude in km. Ground tracks
 * are returned as *segments* split at the antimeridian so a PathLayer never
 * draws a spurious line across the whole map.
 */

import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
  type SatRec,
} from "satellite.js";

export interface Tle {
  name: string;
  line1: string;
  line2: string;
  norad_id?: string;
}

export interface SubPoint {
  lon: number;
  lat: number;
  altKm: number;
}

export interface Satellite {
  name: string;
  noradId: string;
  satrec: SatRec;
}

/** Parse a TLE record into a propagatable satellite, or null if invalid. */
export function toSatellite(tle: Tle): Satellite | null {
  // Guard the format before handing to SGP4: twoline2satrec is lenient and
  // will return a (useless) satrec for non-TLE input rather than throwing.
  if (!/^1 /.test(tle.line1) || !/^2 /.test(tle.line2)) return null;
  try {
    const satrec = twoline2satrec(tle.line1, tle.line2);
    // satellite.js sets a nonzero `error` on malformed/decayed elements.
    if (!satrec || (satrec as { error?: number }).error) return null;
    return { name: tle.name, noradId: tle.norad_id ?? "", satrec };
  } catch {
    return null;
  }
}

/** Sub-satellite point (lon/lat/alt) at `date`, or null if propagation fails
 * (decayed orbit, numerical blow-up — satellite.js flags these). */
export function subPoint(satrec: SatRec, date: Date): SubPoint | null {
  const pv = propagate(satrec, date);
  const position = pv?.position;
  if (!position || typeof position === "boolean") return null;
  const gmst = gstime(date);
  const geo = eciToGeodetic(position, gmst);
  const lon = degreesLong(geo.longitude);
  const lat = degreesLat(geo.latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat, altKm: geo.height };
}

/** Ground-track segments spanning ±`windowMin` around `center`, sampled every
 * `stepSec`, split where the path crosses the antimeridian. Each segment is a
 * polyline of [lon, lat] decimated with Ramer–Douglas–Peucker (ε degrees). */
export function groundTrackSegments(
  satrec: SatRec,
  center: Date,
  windowMin = 45,
  stepSec = 30,
  epsilonDeg = 0.05,
): [number, number][][] {
  const points: [number, number][] = [];
  const startMs = center.getTime() - windowMin * 60_000;
  const endMs = center.getTime() + windowMin * 60_000;
  for (let t = startMs; t <= endMs; t += stepSec * 1000) {
    const sp = subPoint(satrec, new Date(t));
    if (sp) points.push([sp.lon, sp.lat]);
  }
  const segments = splitAtAntimeridian(points);
  return segments.map((seg) => (seg.length > 2 ? rdp(seg, epsilonDeg) : seg));
}

/** Break a lon/lat polyline wherever consecutive longitudes jump > 180°
 * (a wrap across ±180), so each piece stays on one side of the map. */
export function splitAtAntimeridian(points: [number, number][]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && Math.abs(points[i][0] - points[i - 1][0]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(points[i]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

/** Ramer–Douglas–Peucker polyline simplification (iterative, O(n log n)
 * typical). Keeps endpoints; drops points within `epsilon` of the chord. */
export function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length <= 2) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxDist = 0;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistance(points[i], points[lo], points[hi]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > epsilon && idx !== -1) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpDistance(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  // |cross product| / |chord|.
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
}
