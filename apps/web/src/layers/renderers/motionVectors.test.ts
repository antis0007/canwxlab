import { describe, expect, it } from "vitest";

import { arrowLengthDeg, buildArrowSegments, colorForSpeed } from "./motionVectors";
import type { MotionVectorSample } from "./satellite/motionField";

function vector(overrides: Partial<MotionVectorSample> = {}): MotionVectorSample {
  return {
    speedMps: 20,
    bearingFromDeg: 270, // from west → moving east
    confidence: 0.8,
    occlusion: 0,
    cloudProbability: 0.9,
    mercX: 0,
    mercY: 0,
    lon: -75,
    lat: 45,
    ...overrides,
  };
}

describe("colorForSpeed", () => {
  it("ramps from blue to red with speed", () => {
    expect(colorForSpeed(2)[2]).toBe(255);    // slow → blue-ish
    expect(colorForSpeed(40)[0]).toBe(255);   // 144 km/h → red-ish
  });
});

describe("arrowLengthDeg", () => {
  it("clamps speed at 120 km/h and scales with view span", () => {
    const span = 20;
    const slow = arrowLengthDeg(1, span);
    const fast = arrowLengthDeg(60, span);   // 216 km/h → clamped
    const faster = arrowLengthDeg(100, span);
    expect(fast).toBeGreaterThan(slow);
    expect(faster).toBeCloseTo(fast, 6);
    expect(fast).toBeLessThanOrEqual(span * 0.045);
  });
});

describe("buildArrowSegments", () => {
  it("emits shaft + two head strokes per vector, pointing along motion", () => {
    const segments = buildArrowSegments([vector()], 20);
    expect(segments).toHaveLength(3);
    const shaft = segments[0];
    // Moving east: tip east of tail.
    expect(shaft.target[0]).toBeGreaterThan(shaft.source[0]);
    expect(Math.abs(shaft.target[1] - shaft.source[1])).toBeLessThan(1e-9);
    // Heads start at the tip.
    expect(segments[1].source).toEqual(shaft.target);
    expect(segments[2].source).toEqual(shaft.target);
  });

  it("northward motion points the shaft north", () => {
    const segments = buildArrowSegments([vector({ bearingFromDeg: 180 })], 20);
    expect(segments[0].target[1]).toBeGreaterThan(segments[0].source[1]);
  });
});
