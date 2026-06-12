import { describe, expect, it } from "vitest";

import { parseAircraft, aircraftFeed } from "./aircraft";
import { parseQuakes, quakesFeed } from "./quakes";

describe("parseQuakes", () => {
  it("parses USGS GeoJSON features into typed events", () => {
    const events = parseQuakes({
      features: [
        {
          id: "us7000abcd",
          properties: { mag: 5.4, time: 1_765_900_000_000, place: "100 km W of Somewhere" },
          geometry: { coordinates: [-120.5, 38.2, 11.3] },
        },
        { id: "broken", properties: {}, geometry: { coordinates: ["x"] } },
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "us7000abcd",
      lon: -120.5,
      lat: 38.2,
      depthKm: 11.3,
      magnitude: 5.4,
      place: "100 km W of Somewhere",
    });
  });

  it("returns empty for malformed bodies", () => {
    expect(parseQuakes(null)).toEqual([]);
    expect(parseQuakes({})).toEqual([]);
  });

  it("is a global feed at the upstream regeneration cadence", () => {
    expect(quakesFeed.url(null)).toContain("all_day.geojson");
    expect(quakesFeed.intervalMs).toBe(120_000);
  });
});

describe("parseAircraft", () => {
  it("parses OpenSky positional rows", () => {
    const events = parseAircraft({
      states: [
        ["abc123", "ACA101  ", "Canada", 1_765_900_000, 1_765_900_005,
          -73.7, 45.5, 10_058.4, false, 231.5, 87.3, 0, null, 10_363.2, "2745", false, 0],
        ["nopos", "X", "Y", 1, 1, null, null],
      ],
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "abc123",
      callsign: "ACA101",
      lon: -73.7,
      lat: 45.5,
      altitudeM: 10_058.4,
      velocityMps: 231.5,
      headingDeg: 87.3,
      onGround: false,
      squawk: "2745",
    });
    expect(events[0].timeMs).toBe(1_765_900_000_000);
  });

  it("builds a clamped bbox query", () => {
    const url = aircraftFeed.url([-200, -90, 200, 90]);
    expect(url).toContain("lamin=-85.000");
    expect(url).toContain("lomax=180.000");
  });
});
