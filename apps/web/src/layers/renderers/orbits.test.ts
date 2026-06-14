import { describe, expect, it } from "vitest";

import { toSatellite } from "../../lib/orbits/propagate";
import { altitudeColor, buildOrbitData } from "./orbits";

const ISS = toSatellite({
  name: "ISS (ZARYA)",
  line1: "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
  line2: "2 25544  51.6400 208.0000 0006703 130.0000 325.0000 15.50000000123456",
  norad_id: "25544",
})!;

describe("altitudeColor", () => {
  it("maps altitude regimes to distinct colors", () => {
    expect(altitudeColor(400)).not.toEqual(altitudeColor(20000));
    expect(altitudeColor(20000)).not.toEqual(altitudeColor(35786));
  });
});

describe("buildOrbitData", () => {
  it("produces a subpoint and ground track for a live satellite", () => {
    const { subPoints, tracks } = buildOrbitData([ISS], Date.UTC(2024, 0, 1, 12, 0, 0));
    expect(subPoints).toHaveLength(1);
    expect(subPoints[0].noradId).toBe("25544");
    expect(tracks.length).toBeGreaterThanOrEqual(1);
  });

  it("respects maxTracks while still placing every subpoint", () => {
    const { subPoints, tracks } = buildOrbitData([ISS, ISS], Date.UTC(2024, 0, 1, 12, 0, 0), 1);
    expect(subPoints).toHaveLength(2);
    // Only the first satellite contributes track segments.
    expect(tracks.length).toBeGreaterThanOrEqual(1);
  });
});
