// Solar band classification + timeline strip sampling.
//
// A "solar band" is the five-step palette used by the bottom-timeline day/night strip
// to communicate roughly when the operator's selected location is in daylight, twilight,
// or night. The bands are pinned to the standard solar-altitude definitions:
//
//   day          | altitude >=  0°
//   civil        | altitude in [-6°, 0°)
//   nautical     | altitude in [-12°, -6°)
//   astronomical | altitude in [-18°, -12°)
//   night        | altitude <  -18°
//
// TIMELINE-TODO: Drive `solarBandForAltitudeDeg` from real solar geometry — observer
// lon/lat from the selected city/station/lat-lon and a NOAA SPA (or Horizons-cached)
// subsolar point. The current `solarBandForUtcHourProxy` helper is honest about being
// a proxy and exists only so the timeline strip is not blank before the real model lands.
// CELESTIAL-TODO: Once the proper solar model exists, the same source of truth should
// feed the deck.gl terminator polygon on the globe so the strip and the globe shading
// always agree.

export type SolarBand = "night" | "astronomical" | "nautical" | "civil" | "day";

export const SOLAR_BANDS_ORDERED: readonly SolarBand[] = [
  "night",
  "astronomical",
  "nautical",
  "civil",
  "day",
] as const;

/** Altitude thresholds in degrees. Standardized; do not change without coordinating with
 *  the future SPA-driven implementation and the terminator overlay. */
export const SOLAR_ALTITUDE_THRESHOLDS = {
  day: 0,
  civil: -6,
  nautical: -12,
  astronomical: -18,
} as const;

/**
 * Solar elevation in degrees for an observer at (lat, lon) at the given instant.
 *
 * NOAA-style low-precision solar position (good to <~0.5°, sufficient for day/night
 * classification, terminator overlays, and Day-Cloud-Phase / Night-Microphysics
 * mode selection). Not a SPA-grade implementation.
 *
 * References:
 *   NOAA Solar Position Calculator (formulae): https://gml.noaa.gov/grad/solcalc/calcdetails.html
 *   Astronomical Algorithms (Meeus), Ch. 25 — simplified.
 */
export function solarElevationDeg(latitudeDeg: number, longitudeDeg: number, ms: number): number {
  if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg) || !Number.isFinite(ms)) return 0;
  const date = new Date(ms);
  const jd = ms / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0; // days since J2000.0
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
  const epsilon = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  // Equation of time (minutes); approximation good to ~1 min.
  const y = Math.tan(epsilon / 2) ** 2;
  const Lrad = L * (Math.PI / 180);
  const eot = 4 * (180 / Math.PI) * (
    y * Math.sin(2 * Lrad)
    - 2 * 0.0167 * Math.sin(g)
    + 4 * 0.0167 * y * Math.sin(g) * Math.cos(2 * Lrad)
    - 0.5 * y * y * Math.sin(4 * Lrad)
    - 1.25 * 0.0167 * 0.0167 * Math.sin(2 * g)
  );
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const trueSolarTime = (utcHours * 60 + eot + 4 * longitudeDeg) % 1440;
  const hourAngleDeg = trueSolarTime / 4 - 180;
  const latRad = latitudeDeg * (Math.PI / 180);
  const haRad = hourAngleDeg * (Math.PI / 180);
  const elevation = Math.asin(
    Math.sin(latRad) * Math.sin(declination)
    + Math.cos(latRad) * Math.cos(declination) * Math.cos(haRad),
  );
  return elevation * (180 / Math.PI);
}

/** Classify a band from a real solar altitude in degrees. */
export function solarBandForAltitudeDeg(altitudeDeg: number): SolarBand {
  if (!Number.isFinite(altitudeDeg)) return "night";
  if (altitudeDeg >= SOLAR_ALTITUDE_THRESHOLDS.day) return "day";
  if (altitudeDeg >= SOLAR_ALTITUDE_THRESHOLDS.civil) return "civil";
  if (altitudeDeg >= SOLAR_ALTITUDE_THRESHOLDS.nautical) return "nautical";
  if (altitudeDeg >= SOLAR_ALTITUDE_THRESHOLDS.astronomical) return "astronomical";
  return "night";
}

/**
 * Proxy classifier used by the bottom-timeline strip until a real solar altitude
 * model is wired up.
 *
 * Inputs:
 *   utcHour — wall-clock UTC hour as a fractional float (e.g. 14.5 = 14:30 UTC).
 *
 * The breakpoints below are a hand-calibrated stand-in chosen so the bands transition
 * at the average mid-northern-latitude twilight hours. They are intentionally crude
 * because the real implementation requires an observer location.
 */
export function solarBandForUtcHourProxy(utcHour: number): SolarBand {
  if (!Number.isFinite(utcHour)) return "night";
  const h = ((utcHour % 24) + 24) % 24;
  if (h < 4.0 || h >= 22.0) return "night";
  if (h < 5.0 || h >= 21.0) return "astronomical";
  if (h < 6.0 || h >= 20.0) return "nautical";
  if (h < 7.0 || h >= 19.0) return "civil";
  return "day";
}

/** Utilitarian palette tuned for a thin strip under the main timeline track. Low chroma so
 *  the strip reads as instrumentation, not decoration; one hue step between bands. */
export const SOLAR_BAND_COLORS: Record<SolarBand, string> = {
  night:        "rgb(  8, 12, 26)",
  astronomical: "rgb( 22, 28, 56)",
  nautical:     "rgb( 44, 56, 96)",
  civil:        "rgb( 96,108,148)",
  day:          "rgb(168,196,224)",
};

export interface SolarStripOptions {
  /** Total time window the strip covers, in milliseconds. */
  totalMs: number;
  /** First time (ms-since-epoch) the strip represents. */
  startMs: number;
  /** Sampling resolution, in milliseconds. Default 15 minutes — crisp twilight edges. */
  sampleStepMs?: number;
  /** Minimum sample count regardless of total window. Default 8. */
  minSamples?: number;
  /** Classifier — overridable so a future real solar model can drop in. */
  classify?: (sample: { utcHour: number; ms: number }) => SolarBand;
}

export interface SolarStripSample {
  ms: number;
  pct: number;
  band: SolarBand;
  color: string;
}

/**
 * Sample the day/night strip at a fixed cadence across the timeline window.
 * Returns evenly-spaced samples [0..100]% with band + color. The caller composes
 * a CSS gradient (or anything else) from these stops.
 */
export function sampleSolarStrip(opts: SolarStripOptions): SolarStripSample[] {
  const sampleStepMs = opts.sampleStepMs ?? 15 * 60 * 1000;
  const minSamples = opts.minSamples ?? 8;
  if (!Number.isFinite(opts.totalMs) || opts.totalMs <= 0) return [];
  const samples = Math.max(minSamples, Math.ceil(opts.totalMs / sampleStepMs));
  const classify = opts.classify ?? defaultClassifier;
  const out: SolarStripSample[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const t = opts.startMs + (i / samples) * opts.totalMs;
    const d = new Date(t);
    const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
    const band = classify({ utcHour, ms: t });
    out.push({
      ms: t,
      pct: (i / samples) * 100,
      band,
      color: SOLAR_BAND_COLORS[band],
    });
  }
  return out;
}

function defaultClassifier(sample: { utcHour: number }): SolarBand {
  return solarBandForUtcHourProxy(sample.utcHour);
}

/** Compose a horizontal CSS gradient string from a strip sample list. */
export function solarStripGradientCss(samples: SolarStripSample[]): string {
  if (samples.length === 0) return "transparent";
  const stops = samples.map((s) => `${s.color} ${s.pct.toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
