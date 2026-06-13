import { describe, expect, it } from "vitest";

import type { AircraftState } from "../lib/liveFeeds/aircraft";
import type { QuakeEvent } from "../lib/liveFeeds/quakes";
import {
  aircraftEmergenciesToPins,
  frameForEventTime,
  placeEventPins,
  quakesToPins,
} from "./eventPins";

const MIN5 = 5 * 60 * 1000;

function quake(over: Partial<QuakeEvent>): QuakeEvent {
  return { id: "q1", lon: 0, lat: 0, depthKm: 10, magnitude: 5, timeMs: 1000, place: "Nowhere", ...over };
}

function aircraft(over: Partial<AircraftState>): AircraftState {
  return {
    id: "a1", callsign: "TEST1", lon: 0, lat: 0, altitudeM: 10000,
    velocityMps: 200, headingDeg: 90, onGround: false, timeMs: 1000, squawk: null, ...over,
  };
}

describe("quakesToPins", () => {
  it("keeps quakes at or above the magnitude floor, flagging M6+ critical", () => {
    const pins = quakesToPins([
      quake({ id: "small", magnitude: 3.2 }),
      quake({ id: "mid", magnitude: 5.1, place: "Off Coast" }),
      quake({ id: "big", magnitude: 6.4 }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(["quake:mid", "quake:big"]);
    expect(pins[0]).toMatchObject({ severity: "warning", kind: "quake" });
    expect(pins[0].label).toBe("M5.1 Off Coast");
    expect(pins[1].severity).toBe("critical");
  });
});

describe("aircraftEmergenciesToPins", () => {
  it("pins only emergency squawks with a human reason", () => {
    const pins = aircraftEmergenciesToPins([
      aircraft({ id: "normal", squawk: "2200" }),
      aircraft({ id: "hijack", callsign: "ACA1", squawk: "7500" }),
      aircraft({ id: "nosquawk", squawk: null }),
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ kind: "aircraft-emergency", severity: "critical" });
    expect(pins[0].label).toContain("squawk 7500 (hijack)");
  });
});

describe("placeEventPins", () => {
  const windowStart = 0;
  const frameCount = 289; // 24 h of 5-min frames

  it("positions pins by time and drops events outside the window", () => {
    const placed = placeEventPins(
      [
        { id: "a", timeMs: 72 * MIN5, label: "x", kind: "quake", severity: "warning" },
        { id: "b", timeMs: -MIN5, label: "before", kind: "quake", severity: "info" },
        { id: "c", timeMs: 99_999 * MIN5, label: "after", kind: "quake", severity: "info" },
      ],
      windowStart, frameCount, MIN5,
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].id).toBe("a");
    expect(placed[0].leftPct).toBeCloseTo(25, 4);
  });

  it("deduplicates by id, keeping the latest, sorted by time", () => {
    const placed = placeEventPins(
      [
        { id: "dup", timeMs: 10 * MIN5, label: "first", kind: "quake", severity: "info" },
        { id: "dup", timeMs: 20 * MIN5, label: "second", kind: "quake", severity: "info" },
        { id: "early", timeMs: 5 * MIN5, label: "early", kind: "quake", severity: "info" },
      ],
      windowStart, frameCount, MIN5,
    );
    expect(placed.map((p) => p.id)).toEqual(["early", "dup"]);
    expect(placed.find((p) => p.id === "dup")?.label).toBe("second");
  });
});

describe("frameForEventTime", () => {
  it("returns the nearest frame, clamped to the window", () => {
    expect(frameForEventTime(72 * MIN5, 0, 289, MIN5)).toBe(72);
    expect(frameForEventTime(-100, 0, 289, MIN5)).toBe(0);
    expect(frameForEventTime(99_999 * MIN5, 0, 289, MIN5)).toBe(288);
  });
});
