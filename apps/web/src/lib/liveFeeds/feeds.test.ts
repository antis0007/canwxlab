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
  it("parses the aircraft GeoJSON FeatureCollection", () => {
    const events = parseAircraft({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-73.7, 45.5] },
          properties: {
            icao24: "abc123",
            callsign: "ACA101  ",
            baro_altitude_m: 10_058.4,
            velocity_ms: 231.5,
            heading_deg: 87.3,
            on_ground: false,
            squawk: "2745",
            observed_at: "2025-12-16T12:00:00Z",
          },
        },
        { type: "Feature", geometry: { coordinates: ["x"] }, properties: {} },
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
    expect(events[0].timeMs).toBe(Date.parse("2025-12-16T12:00:00Z"));
  });

  it("returns empty for malformed bodies", () => {
    expect(parseAircraft(null)).toEqual([]);
    expect(parseAircraft({ features: "nope" })).toEqual([]);
  });

  it("routes through our cached aircraft proxy endpoint with a clamped bbox", () => {
    expect(aircraftFeed.transport).toBe("proxy");
    const url = aircraftFeed.url([-200, -90, 200, 90]);
    expect(url).toContain("/api/v1/aircraft/positions");
    expect(url).toContain("bbox=-180.000,-85.000,180.000,85.000");
  });
});
