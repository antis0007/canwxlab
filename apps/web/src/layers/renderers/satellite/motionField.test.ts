import { describe, expect, it } from "vitest";

import {
  bearingToCardinal,
  decodeMotionSample,
  sampleMotionGrid,
  type MotionField,
} from "./motionField";

const MAX_FLOW_UV = 0.25;
const MIN10 = 600_000;

/** Encode a flow vector the way the pipeline shader does. */
function encode(u: number, v: number, conf = 1, occl = 0): [number, number, number, number] {
  return [
    Math.round((u / (MAX_FLOW_UV * 2) + 0.5) * 255),
    Math.round((v / (MAX_FLOW_UV * 2) + 0.5) * 255),
    Math.round(conf * 255),
    Math.round(occl * 255),
  ];
}

function uniformField(
  u: number,
  v: number,
  conf = 1,
  occl = 0,
  cloudProb = 1,
): MotionField {
  const width = 4;
  const height = 4;
  const data = new Uint8Array(width * height * 4);
  const cloud = new Uint8Array(width * height * 4);
  const texel = encode(u, v, conf, occl);
  for (let i = 0; i < width * height; i += 1) {
    data.set(texel, i * 4);
    cloud[i * 4 + 3] = Math.round(cloudProb * 255);
  }
  return {
    width,
    height,
    data,
    cloud,
    // 1000 km × 1000 km mercator quad centered on the equator.
    mercBounds: [-500_000, -500_000, 500_000, 500_000],
    intervalMs: MIN10,
  };
}

describe("decodeMotionSample", () => {
  it("converts pure-east texture flow into eastward motion from the west", () => {
    // +u in texture space = +x in mercator. 0.06 UV over 1000 km = 60 km
    // per 10 min = 100 m/s at the equator (cos(lat)=1).
    const field = uniformField(0.06, 0);
    const sample = decodeMotionSample(field, 0, 0);
    expect(sample).not.toBeNull();
    expect(sample!.speedMps).toBeCloseTo(100, 0);
    // 8-bit flow encoding quantizes to ~±1°.
    expect(Math.abs(sample!.bearingFromDeg - 270)).toBeLessThan(2); // FROM the west
    expect(sample!.confidence).toBeCloseTo(1, 1);
    expect(sample!.cloudProbability).toBeCloseTo(1, 1);
  });

  it("flips texture v: positive v flow means southward ground motion", () => {
    const field = uniformField(0, 0.06);
    const sample = decodeMotionSample(field, 0, 0);
    // Texture v grows downward (north → south), so +v = southward = from north.
    const wrapped = Math.min(sample!.bearingFromDeg, 360 - sample!.bearingFromDeg);
    expect(wrapped).toBeLessThan(2);
  });

  it("applies cos(lat) Web Mercator scale correction", () => {
    const field = uniformField(0.06, 0);
    field.mercBounds = [-500_000, 7_000_000, 500_000, 8_000_000]; // ~55-59°N
    const sample = decodeMotionSample(field, 0, 7_500_000);
    expect(sample!.speedMps).toBeLessThan(60); // cos(~57°) ≈ 0.54
    expect(sample!.speedMps).toBeGreaterThan(45);
  });

  it("returns null outside the field bounds or for zero interval", () => {
    const field = uniformField(0.06, 0);
    expect(decodeMotionSample(field, 2_000_000, 0)).toBeNull();
    expect(decodeMotionSample({ ...field, intervalMs: 0 }, 0, 0)).toBeNull();
  });
});

describe("sampleMotionGrid", () => {
  it("emits gated samples on an even grid", () => {
    const field = uniformField(0.06, 0, 0.9, 0);
    const vectors = sampleMotionGrid(field, {
      viewMercBounds: [-400_000, -400_000, 400_000, 400_000],
      cols: 6,
      rows: 4,
      maxCount: 512,
    });
    expect(vectors.length).toBe(24);
    expect(vectors[0].speedMps).toBeCloseTo(100, 0);
  });

  it("drops low-confidence and occluded samples", () => {
    const lowConf = uniformField(0.06, 0, 0.05, 0);
    expect(sampleMotionGrid(lowConf, {
      viewMercBounds: [-400_000, -400_000, 400_000, 400_000],
      cols: 4, rows: 4, maxCount: 512,
    })).toHaveLength(0);

    const occluded = uniformField(0.06, 0, 0.9, 0.9);
    expect(sampleMotionGrid(occluded, {
      viewMercBounds: [-400_000, -400_000, 400_000, 400_000],
      cols: 4, rows: 4, maxCount: 512,
    })).toHaveLength(0);
  });

  it("caps the vector count", () => {
    const field = uniformField(0.06, 0);
    const vectors = sampleMotionGrid(field, {
      viewMercBounds: [-400_000, -400_000, 400_000, 400_000],
      cols: 10, rows: 10, maxCount: 7,
    });
    expect(vectors).toHaveLength(7);
  });
});

describe("bearingToCardinal", () => {
  it("maps bearings to 16-point compass names", () => {
    expect(bearingToCardinal(0)).toBe("N");
    expect(bearingToCardinal(247)).toBe("WSW");
    expect(bearingToCardinal(359)).toBe("N");
    expect(bearingToCardinal(90)).toBe("E");
  });
});
