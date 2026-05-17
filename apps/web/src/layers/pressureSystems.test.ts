import { describe, expect, it } from "vitest";

import { detectPressureSystems } from "./pressureSystems";
import type { Observation } from "../types/weather";

function obs(id: string, lon: number, lat: number, mslp: number): Observation {
  return {
    observation_id: id,
    station_id: id.toUpperCase(),
    station_name: `Station ${id}`,
    longitude: lon,
    latitude: lat,
    elevation_m: 100,
    observed_at: "2026-05-17T12:00:00Z",
    values: { pressure_msl: mslp },
    units: { pressure_msl: "hPa" },
    source_id: "test",
    source_status: "live",
    adapter: "test",
    quality_flags: [],
    retrieved_at: null,
    expires_at: null,
    raw_properties: {},
  };
}

describe("detectPressureSystems", () => {
  it("flags a central low surrounded by higher-pressure neighbours", () => {
    const observations: Observation[] = [
      obs("centre", 0,    50, 994.0),
      obs("n",      0,    52, 1010.0),
      obs("s",      0,    48, 1009.0),
      obs("e",      2,    50, 1011.0),
      obs("w",     -2,    50, 1008.5),
    ];
    const systems = detectPressureSystems(observations, { radiusKm: 500 });
    const low = systems.find((entry) => entry.kind === "L");
    expect(low?.stationId).toBe("CENTRE");
    expect(low?.contrastHpa).toBeGreaterThan(10);
  });

  it("flags a central high surrounded by lower-pressure neighbours", () => {
    const observations: Observation[] = [
      obs("centre", 0,    50, 1028.0),
      obs("n",      0,    52, 1015.0),
      obs("s",      0,    48, 1014.0),
      obs("e",      2,    50, 1013.5),
      obs("w",     -2,    50, 1014.5),
    ];
    const systems = detectPressureSystems(observations, { radiusKm: 500 });
    const high = systems.find((entry) => entry.kind === "H");
    expect(high?.stationId).toBe("CENTRE");
    expect(high?.contrastHpa).toBeGreaterThan(10);
  });

  it("ignores flat-pressure ridges below the contrast threshold", () => {
    const observations: Observation[] = [
      obs("centre", 0, 50, 1014.8),
      obs("n",      0, 52, 1015.0),
      obs("s",      0, 48, 1015.0),
      obs("e",      2, 50, 1015.0),
    ];
    expect(detectPressureSystems(observations, { radiusKm: 500, minContrastHpa: 2 })).toEqual([]);
  });

  it("rejects MSLP outliers that are not physically plausible", () => {
    const observations: Observation[] = [
      obs("crazy",  0, 50, 1500),
      obs("n",      0, 52, 1015),
      obs("s",      0, 48, 1015),
    ];
    expect(detectPressureSystems(observations, { radiusKm: 500 })).toEqual([]);
  });
});
