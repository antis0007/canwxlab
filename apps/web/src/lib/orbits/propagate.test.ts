import { describe, expect, it } from "vitest";

import {
  groundTrackSegments,
  rdp,
  splitAtAntimeridian,
  subPoint,
  toSatellite,
} from "./propagate";

// ISS TLE (epoch 2024-001); SGP4 is deterministic from the elements.
const ISS = {
  name: "ISS (ZARYA)",
  line1: "1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005",
  line2: "2 25544  51.6400 208.0000 0006703 130.0000 325.0000 15.50000000123456",
  norad_id: "25544",
};

describe("toSatellite / subPoint", () => {
  it("propagates the ISS to a plausible sub-point near its altitude", () => {
    const sat = toSatellite(ISS);
    expect(sat).not.toBeNull();
    const sp = subPoint(sat!.satrec, new Date(Date.UTC(2024, 0, 1, 12, 0, 0)));
    expect(sp).not.toBeNull();
    // ISS orbits ~400–420 km; allow SGP4 spread.
    expect(sp!.altKm).toBeGreaterThan(380);
    expect(sp!.altKm).toBeLessThan(440);
    // Latitude can never exceed the orbital inclination (51.64°) + margin.
    expect(Math.abs(sp!.lat)).toBeLessThan(53);
    expect(sp!.lon).toBeGreaterThanOrEqual(-180);
    expect(sp!.lon).toBeLessThanOrEqual(180);
  });

  it("rejects a malformed TLE", () => {
    expect(toSatellite({ name: "X", line1: "garbage", line2: "junk" })).toBeNull();
  });
});

describe("groundTrackSegments", () => {
  it("returns one or more polylines covering the window", () => {
    const sat = toSatellite(ISS)!;
    const segs = groundTrackSegments(sat.satrec, new Date(Date.UTC(2024, 0, 1, 12, 0, 0)), 45, 30);
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const total = segs.reduce((n, s) => n + s.length, 0);
    expect(total).toBeGreaterThan(5);
    // No segment may straddle the antimeridian internally.
    for (const seg of segs) {
      for (let i = 1; i < seg.length; i++) {
        expect(Math.abs(seg[i][0] - seg[i - 1][0])).toBeLessThanOrEqual(180);
      }
    }
  });
});

describe("splitAtAntimeridian", () => {
  it("splits a wrapping path into two segments", () => {
    const segs = splitAtAntimeridian([
      [170, 0],
      [179, 1],
      [-179, 2],
      [-170, 3],
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(2);
  });
});

describe("rdp", () => {
  it("drops near-collinear points but keeps endpoints", () => {
    const line: [number, number][] = [
      [0, 0],
      [1, 0.001],
      [2, 0],
      [3, 0],
    ];
    const out = rdp(line, 0.05);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([3, 0]);
    expect(out.length).toBeLessThan(line.length);
  });
});
