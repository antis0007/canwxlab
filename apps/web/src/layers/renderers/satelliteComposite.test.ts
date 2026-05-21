import { describe, expect, it } from "vitest";

import {
  isVisibleSatelliteMotionSource,
  stableVisibleMotionTrustFromSolarElevation,
} from "./satelliteComposite";

describe("satellite motion quality gates", () => {
  it("classifies visible products separately from IR/cloud products", () => {
    expect(isVisibleSatelliteMotionSource("eccc_goes_east_natural")).toBe(true);
    expect(isVisibleSatelliteMotionSource("eccc_goes_west_visible")).toBe(true);
    expect(isVisibleSatelliteMotionSource("eccc_goes_east_ir")).toBe(false);
    expect(isVisibleSatelliteMotionSource("eccc_goes_west_cloud_type")).toBe(false);
  });

  it("rejects visible-derived motion until solar elevation is stable daylight", () => {
    const horizon = stableVisibleMotionTrustFromSolarElevation(0);
    const lowSun = stableVisibleMotionTrustFromSolarElevation(Math.sin(12 * Math.PI / 180));
    const stableSun = stableVisibleMotionTrustFromSolarElevation(Math.sin(25 * Math.PI / 180));

    expect(horizon).toBe(0);
    expect(lowSun).toBeGreaterThan(horizon);
    expect(lowSun).toBeLessThan(1);
    expect(stableSun).toBe(1);
  });
});
