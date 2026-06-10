import { describe, expect, it } from "vitest";

import { FLOW_PYRAMID, NATIVE_GSD_M, pyramidLevelsFor } from "./flowPlan";

describe("pyramidLevelsFor", () => {
  it("returns the full pyramid when imagery is at/below native resolution", () => {
    // 2000 km wide view at 1024 px → ~1953 m/px ≈ native → 1000 native px wide.
    expect(pyramidLevelsFor({ mercWidthM: 2_000_000, texWidthPx: 1024 })).toEqual([64, 128, 256, 512]);
  });

  it("caps the finest level when zoomed past native resolution", () => {
    // 100 km wide view → only 50 native satellite pixels across: flow finer
    // than 64 px would be resampling noise, not data.
    expect(pyramidLevelsFor({ mercWidthM: 100_000, texWidthPx: 1024 })).toEqual([64]);
  });

  it("keeps intermediate levels at intermediate zoom", () => {
    // 500 km → 250 native px → pow2 floor 128.
    const levels = pyramidLevelsFor({ mercWidthM: 500_000, texWidthPx: 1024 });
    expect(levels[levels.length - 1]).toBe(128);
  });

  it("never returns an empty pyramid", () => {
    expect(pyramidLevelsFor({ mercWidthM: 1, texWidthPx: 64 })).toEqual([FLOW_PYRAMID[0]]);
  });

  it("uses the documented native GSD", () => {
    expect(NATIVE_GSD_M).toBe(2_000);
  });
});
