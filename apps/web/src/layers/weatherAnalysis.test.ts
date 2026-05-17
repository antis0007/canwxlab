import { describe, expect, it } from "vitest";

import {
  airDensityKgM3,
  beaufortFromWindMs,
  cardinalDirection,
  dewpointFromTempRH,
  haversineKm,
  magnusSaturationVapourHpa,
  rhFromTempDewpoint,
  windDirectionFromUVDeg,
  windSpeedFromUV,
} from "./weatherAnalysis";

describe("weatherAnalysis", () => {
  it("computes saturation vapour pressure within Magnus tolerance", () => {
    // Known reference: es ≈ 12.27 hPa at 10 °C, ≈ 23.37 at 20 °C.
    expect(magnusSaturationVapourHpa(10)).toBeCloseTo(12.27, 1);
    expect(magnusSaturationVapourHpa(20)).toBeCloseTo(23.37, 1);
  });

  it("dewpoint equals air temperature at 100% RH", () => {
    const dp = dewpointFromTempRH(15, 100);
    expect(dp).not.toBeNull();
    expect(dp!).toBeCloseTo(15, 1);
  });

  it("dewpoint is significantly lower than temperature at low RH", () => {
    const dp = dewpointFromTempRH(20, 30);
    expect(dp).not.toBeNull();
    expect(dp!).toBeLessThan(5);
  });

  it("RH is 100% when dewpoint equals temperature", () => {
    const rh = rhFromTempDewpoint(15, 15);
    expect(rh).toBeCloseTo(100, 1);
  });

  it("air density of dry air at 15 °C, 1013.25 hPa ≈ 1.225 kg/m^3", () => {
    const rho = airDensityKgM3(1013.25, 15);
    expect(rho).toBeCloseTo(1.225, 2);
  });

  it("moist-air density is slightly lower than dry at same conditions", () => {
    const dry = airDensityKgM3(1013.25, 25);
    const moist = airDensityKgM3(1013.25, 25, 20);
    expect(dry).not.toBeNull();
    expect(moist).not.toBeNull();
    expect(moist!).toBeLessThan(dry!);
  });

  it("wind from due south reads as 'S' direction", () => {
    // u=0, v=+10 means wind is blowing TOWARD the north → coming FROM the south.
    const dir = windDirectionFromUVDeg(0, 10);
    expect(dir).toBeCloseTo(180, 1);
    expect(cardinalDirection(dir!)).toBe("S");
  });

  it("wind speed is the vector magnitude", () => {
    expect(windSpeedFromUV(3, 4)).toBe(5);
  });

  it("Beaufort scale: gentle breeze around 5 m/s", () => {
    const level = beaufortFromWindMs(5);
    expect(level?.force).toBe(3);
    expect(level?.label).toBe("Gentle breeze");
  });

  it("Beaufort scale: hurricane force above 32 m/s", () => {
    expect(beaufortFromWindMs(35)?.force).toBe(12);
  });

  it("haversine roughly matches the Edmonton-Calgary great-circle distance", () => {
    // CYEG (53.31, -113.58) to CYYC (51.12, -114.01) ≈ 246 km.
    const km = haversineKm(-113.58, 53.31, -114.01, 51.12);
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(260);
  });
});
