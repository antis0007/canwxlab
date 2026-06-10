import { describe, expect, it } from "vitest";

import {
  clampPlayheadToBuffered,
  mergeBufferedRanges,
  snapFetchBounds,
  zoomBandForViewport,
} from "./frameGrid";

describe("zoomBandForViewport", () => {
  it("quantizes mercator width into discrete bands", () => {
    expect(zoomBandForViewport(40_075_016)).toBe(0);
    expect(zoomBandForViewport(10_018_754)).toBe(2);
    expect(zoomBandForViewport(10_018_754 * 0.99)).toBe(2);
  });

  it("never returns a negative band", () => {
    expect(zoomBandForViewport(80_000_000)).toBe(0);
  });
});

describe("snapFetchBounds", () => {
  it("returns identical bounds for any viewport inside the same grid cell", () => {
    const a = snapFetchBounds([-9_000_000, 4_000_000, -7_000_000, 5_500_000]);
    const b = snapFetchBounds([-8_900_000, 4_100_000, -6_900_000, 5_600_000]);
    expect(a).toEqual(b);
  });

  it("covers the viewport", () => {
    const view: [number, number, number, number] = [-9_000_000, 4_000_000, -7_000_000, 5_500_000];
    const snapped = snapFetchBounds(view);
    expect(snapped[0]).toBeLessThanOrEqual(view[0]);
    expect(snapped[1]).toBeLessThanOrEqual(view[1]);
    expect(snapped[2]).toBeGreaterThanOrEqual(view[2]);
    expect(snapped[3]).toBeGreaterThanOrEqual(view[3]);
  });

  it("changes cell when the viewport moves far", () => {
    const a = snapFetchBounds([-9_000_000, 4_000_000, -7_000_000, 5_500_000]);
    const b = snapFetchBounds([-1_000_000, 4_000_000, 1_000_000, 5_500_000]);
    expect(a).not.toEqual(b);
  });
});

describe("mergeBufferedRanges", () => {
  it("merges contiguous frame times into ranges", () => {
    const interval = 600_000;
    expect(mergeBufferedRanges([0, 600_000, 1_200_000, 3_000_000], interval)).toEqual([
      { startMs: 0, endMs: 1_200_000 },
      { startMs: 3_000_000, endMs: 3_000_000 },
    ]);
  });

  it("handles unsorted input", () => {
    expect(mergeBufferedRanges([600_000, 0], 600_000)).toEqual([{ startMs: 0, endMs: 600_000 }]);
  });

  it("returns empty for no frames", () => {
    expect(mergeBufferedRanges([], 600_000)).toEqual([]);
  });
});

describe("clampPlayheadToBuffered", () => {
  const ranges = [{ startMs: 0, endMs: 1_200_000 }];

  it("passes through times inside a buffered range", () => {
    expect(clampPlayheadToBuffered(600_000, ranges)).toBe(600_000);
  });

  it("clamps forward motion at the buffer edge", () => {
    expect(clampPlayheadToBuffered(1_500_000, ranges)).toBe(1_200_000);
  });

  it("snaps to nearest range start when before all ranges", () => {
    expect(clampPlayheadToBuffered(-5, ranges)).toBe(0);
  });

  it("returns the input when no ranges exist", () => {
    expect(clampPlayheadToBuffered(42, [])).toBe(42);
  });
});
