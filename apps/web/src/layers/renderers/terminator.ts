import { PolygonLayer } from "@deck.gl/layers";

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

/** A deck.gl PolygonLayer shading the night side of the Earth. */
export function createTerminatorLayer(opts: TerminatorLayerOptions): PolygonLayer {
  const date = new Date(opts.timeMs);
  const ring = nightHemisphereRing(date, 240);
  const alpha = Math.round(Math.max(0, Math.min(1, opts.intensity ?? 0.45)) * 255);
  return new PolygonLayer({
    id: opts.id ?? "terminator-night",
    data: [{ polygon: ring }],
    getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
    getFillColor: [4, 8, 20, alpha],
    getLineColor: [120, 160, 220, Math.round(alpha * 0.6)],
    lineWidthMinPixels: 1,
    stroked: true,
    filled: true,
    pickable: false,
  });
}
