import { describe, expect, it } from "vitest";

import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import {
  aircraftColor,
  buildAircraftDarts,
  deadReckon,
  quakeColor,
  quakeOpacity,
  quakeRadiusM,
} from "./osint";

const NOW = 1_765_900_000_000;

function aircraft(overrides: Partial<AircraftState> = {}): AircraftState {
  return {
    id: "abc123",
    callsign: "TEST1",
    lon: -73.7,
    lat: 45.5,
    altitudeM: 10_000,
    velocityMps: 250,
    headingDeg: 90,
    onGround: false,
    timeMs: NOW - 30_000,
    squawk: null,
    ...overrides,
  };
}

describe("quake styling", () => {
  it("scales radius with magnitude and fades with age", () => {
    expect(quakeRadiusM(6)).toBeGreaterThan(quakeRadiusM(3) * 5);
    expect(quakeOpacity(NOW, NOW)).toBe(1);
    expect(quakeOpacity(NOW - 12 * 3_600_000, NOW)).toBeCloseTo(0.5, 1);
    expect(quakeOpacity(NOW - 48 * 3_600_000, NOW)).toBe(0.12);
  });

  it("colors by severity", () => {
    expect(quakeColor(6.5, NOW, NOW)[0]).toBe(255);
    expect(quakeColor(3, NOW, NOW)).not.toEqual(quakeColor(5, NOW, NOW));
  });
});

describe("deadReckon", () => {
  it("advances eastward for a 90° track at the reported speed", () => {
    const [lon, lat] = deadReckon(aircraft(), NOW);
    // 250 m/s × 30 s = 7.5 km east ≈ 0.096° at 45.5°N.
    expect(lon).toBeGreaterThan(-73.7 + 0.07);
    expect(lon).toBeLessThan(-73.7 + 0.13);
    expect(Math.abs(lat - 45.5)).toBeLessThan(1e-6);
  });

  it("holds position on ground and clamps extrapolation at 120 s", () => {
    expect(deadReckon(aircraft({ onGround: true }), NOW)).toEqual([-73.7, 45.5]);
    const farFuture = deadReckon(aircraft({ timeMs: NOW - 600_000 }), NOW);
    const capped = deadReckon(aircraft({ timeMs: NOW - 120_000 }), NOW);
    expect(farFuture).toEqual(capped);
  });
});

describe("aircraftColor", () => {
  it("flags emergency squawks red and grounds grey", () => {
    expect(aircraftColor(aircraft({ squawk: "7700" }))).toEqual([255, 60, 60, 255]);
    expect(aircraftColor(aircraft({ onGround: true }))[0]).toBe(150);
  });
});

describe("buildAircraftDarts", () => {
  it("emits a heading tip ahead of the dead-reckoned position", () => {
    const darts = buildAircraftDarts([aircraft()], NOW);
    expect(darts).toHaveLength(1);
    expect(darts[0].tip[0]).toBeGreaterThan(darts[0].position[0]); // east tick
  });
});
