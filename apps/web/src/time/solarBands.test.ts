import { describe, expect, it } from "vitest";

import {
  SOLAR_ALTITUDE_THRESHOLDS,
  SOLAR_BAND_COLORS,
  SOLAR_BANDS_ORDERED,
  sampleSolarStrip,
  solarBandForAltitudeDeg,
  solarBandForUtcHourProxy,
  solarElevationDeg,
  solarStripGradientCss,
} from "./solarBands";

describe("solarBandForAltitudeDeg", () => {
  it("classifies sun above horizon as day", () => {
    expect(solarBandForAltitudeDeg(45)).toBe("day");
    expect(solarBandForAltitudeDeg(0)).toBe("day");
  });

  it("classifies twilight bands at the correct breakpoints", () => {
    expect(solarBandForAltitudeDeg(-0.5)).toBe("civil");
    expect(solarBandForAltitudeDeg(SOLAR_ALTITUDE_THRESHOLDS.civil)).toBe("civil");
    expect(solarBandForAltitudeDeg(SOLAR_ALTITUDE_THRESHOLDS.civil - 0.1)).toBe("nautical");
    expect(solarBandForAltitudeDeg(SOLAR_ALTITUDE_THRESHOLDS.nautical - 0.1)).toBe("astronomical");
    expect(solarBandForAltitudeDeg(SOLAR_ALTITUDE_THRESHOLDS.astronomical - 0.1)).toBe("night");
  });

  it("treats non-finite altitudes as night", () => {
    expect(solarBandForAltitudeDeg(Number.NaN)).toBe("night");
    expect(solarBandForAltitudeDeg(Number.NEGATIVE_INFINITY)).toBe("night");
  });
});

describe("solarElevationDeg", () => {
  it("is positive at solar noon at the equator on the equinox", () => {
    const equinoxNoon = Date.parse("2026-03-20T12:00:00Z");
    const elev = solarElevationDeg(0, 0, equinoxNoon);
    expect(elev).toBeGreaterThan(85);
    expect(elev).toBeLessThanOrEqual(90);
  });

  it("is negative on the opposite side of the planet from the subsolar point", () => {
    const equinoxNoon = Date.parse("2026-03-20T12:00:00Z");
    const elev = solarElevationDeg(0, 180, equinoxNoon);
    expect(elev).toBeLessThan(-85);
  });

  it("returns positive elevation during local daytime and negative at local midnight", () => {
    const noonUtc = Date.parse("2026-06-21T12:00:00Z");
    const dayLon = 0; // London-ish, midday UTC = midday local
    const nightLon = 180;
    expect(solarElevationDeg(45, dayLon, noonUtc)).toBeGreaterThan(0);
    expect(solarElevationDeg(45, nightLon, noonUtc)).toBeLessThan(0);
  });

  it("returns 0 for non-finite inputs", () => {
    expect(solarElevationDeg(Number.NaN, 0, 0)).toBe(0);
  });
});

describe("solarBandForUtcHourProxy", () => {
  it("maps midday to day and midnight to night", () => {
    expect(solarBandForUtcHourProxy(12)).toBe("day");
    expect(solarBandForUtcHourProxy(0)).toBe("night");
  });

  it("walks through twilight bands at the expected hours", () => {
    expect(solarBandForUtcHourProxy(4.5)).toBe("astronomical");
    expect(solarBandForUtcHourProxy(5.5)).toBe("nautical");
    expect(solarBandForUtcHourProxy(6.5)).toBe("civil");
    expect(solarBandForUtcHourProxy(19.5)).toBe("civil");
    expect(solarBandForUtcHourProxy(20.5)).toBe("nautical");
    expect(solarBandForUtcHourProxy(21.5)).toBe("astronomical");
  });

  it("wraps hours outside 0..24", () => {
    expect(solarBandForUtcHourProxy(36)).toBe("day");
    expect(solarBandForUtcHourProxy(-1)).toBe("night");
  });
});

describe("sampleSolarStrip", () => {
  const startMs = new Date("2026-05-15T00:00:00Z").getTime();

  it("samples at the requested cadence with at least minSamples points", () => {
    const oneDay = 24 * 60 * 60 * 1000;
    const samples = sampleSolarStrip({
      startMs,
      totalMs: oneDay,
      sampleStepMs: 60 * 60 * 1000, // hourly
    });
    // (samples) endpoints inclusive — minSamples is 8, so we expect at least 24+1.
    expect(samples.length).toBeGreaterThanOrEqual(25);
    expect(samples[0].pct).toBe(0);
    expect(samples[samples.length - 1].pct).toBeCloseTo(100, 2);
  });

  it("emits at least minSamples even on a short window", () => {
    const samples = sampleSolarStrip({
      startMs,
      totalMs: 5 * 60 * 1000, // 5 minutes
      sampleStepMs: 15 * 60 * 1000,
      minSamples: 8,
    });
    expect(samples.length).toBeGreaterThanOrEqual(9);
  });

  it("returns empty for zero/invalid total", () => {
    expect(sampleSolarStrip({ startMs, totalMs: 0 })).toEqual([]);
    expect(sampleSolarStrip({ startMs, totalMs: Number.NaN })).toEqual([]);
  });

  it("uses the injected classifier when supplied", () => {
    const samples = sampleSolarStrip({
      startMs,
      totalMs: 60 * 60 * 1000,
      sampleStepMs: 15 * 60 * 1000,
      classify: () => "day",
    });
    expect(samples.every((s) => s.band === "day")).toBe(true);
    expect(samples[0].color).toBe(SOLAR_BAND_COLORS.day);
  });
});

describe("solarStripGradientCss", () => {
  it("produces a transparent gradient when there are no samples", () => {
    expect(solarStripGradientCss([])).toBe("transparent");
  });

  it("emits a stop for every sample", () => {
    const css = solarStripGradientCss([
      { ms: 0, pct: 0, band: "day", color: SOLAR_BAND_COLORS.day },
      { ms: 1, pct: 100, band: "night", color: SOLAR_BAND_COLORS.night },
    ]);
    expect(css.startsWith("linear-gradient(90deg,")).toBe(true);
    expect(css).toContain(SOLAR_BAND_COLORS.day);
    expect(css).toContain(SOLAR_BAND_COLORS.night);
  });

  it("exposes all five band keys", () => {
    expect(SOLAR_BANDS_ORDERED).toContain("day");
    expect(SOLAR_BANDS_ORDERED).toContain("night");
    expect(Object.keys(SOLAR_BAND_COLORS).sort()).toEqual([...SOLAR_BANDS_ORDERED].sort());
  });
});
