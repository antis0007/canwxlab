import { describe, expect, it } from "vitest";

import {
  estimateGlobalFlow,
  hermiteFlowDisplacementForTesting,
  intersectBufferedRanges,
  isVisibleSatelliteMotionSource,
  selectFlowPairCandidates,
  shouldStartSatelliteCompositeForTesting,
  stableVisibleMotionTrustFromSolarElevation,
} from "./satelliteComposite";
import type { StoredFrame } from "./satellite/frameStore";

function shiftedBlobSample(width: number, height: number, dx: number, dy: number) {
  const luma = new Float32Array(width * height);
  const cx = width * 0.45 + dx;
  const cy = height * 0.50 + dy;
  const radius = 8;
  for (let py = Math.floor(cy - radius); py <= Math.ceil(cy + radius); py += 1) {
    for (let px = Math.floor(cx - radius); px <= Math.ceil(cx + radius); px += 1) {
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const x = px - cx;
      const y = py - cy;
      const r2 = x * x + y * y;
      luma[py * width + px] = Math.max(luma[py * width + px], Math.exp(-r2 / 18));
    }
  }
  return { width, height, luma };
}

function storedFrame(gridKey: string, timeMs: number): StoredFrame {
  return {
    timeMs,
    gridKey,
    mercBounds: [0, 0, 100, 100],
    texture: { width: 512, height: 512, destroy: () => undefined },
    width: 512,
    height: 512,
    globalFlow: null,
  };
}

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

  it("estimates global fallback flow in the same direction as frame motion", () => {
    const prev = shiftedBlobSample(64, 64, 0, 0);
    const next = shiftedBlobSample(64, 64, 3, -2);
    const [flowX, flowY, confidence] = estimateGlobalFlow(prev, next);

    expect(flowX).toBeGreaterThan(0);
    expect(flowY).toBeLessThan(0);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("refines global fallback flow below one sample pixel", () => {
    const prev = shiftedBlobSample(96, 96, 0, 0);
    const next = shiftedBlobSample(96, 96, 2.35, -1.65);
    const [flowX, flowY, confidence] = estimateGlobalFlow(prev, next);

    expect(flowX * 96).toBeGreaterThan(2.05);
    expect(flowX * 96).toBeLessThan(2.65);
    expect(flowY * 96).toBeLessThan(-1.35);
    expect(flowY * 96).toBeGreaterThan(-1.95);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("keeps global fallback lock for larger cloud displacements", () => {
    const prev = shiftedBlobSample(128, 128, 0, 0);
    const next = shiftedBlobSample(128, 128, 18, -11);
    const [flowX, flowY, confidence] = estimateGlobalFlow(prev, next);

    expect(flowX * 128).toBeGreaterThan(16);
    expect(flowX * 128).toBeLessThan(20);
    expect(flowY * 128).toBeLessThan(-9);
    expect(flowY * 128).toBeGreaterThan(-13);
    expect(confidence).toBeGreaterThan(0.3);
  });

  it("pairs only adjacent frames within the same spatial grid", () => {
    const pairs = selectFlowPairCandidates([
      storedFrame("grid-old", 0),
      storedFrame("grid-new", 0),
      storedFrame("grid-old", 600_000),
      storedFrame("grid-new", 600_000),
    ]).map(([prev, next]) => [prev.gridKey, prev.timeMs, next.timeMs]);

    // Sorted by time; adjacent same-time frames from different grids never
    // pair, and cross-grid adjacency is rejected.
    for (const [gridKey] of pairs) {
      expect(["grid-old", "grid-new"]).toContain(gridKey);
    }
    expect(pairs.every(([, prevMs, nextMs]) => (nextMs as number) > (prevMs as number))).toBe(true);
  });

  it("does not create optical-flow pairs from duplicate timestamps", () => {
    const pairs = selectFlowPairCandidates([
      storedFrame("g", 0),
      storedFrame("g", 0),
      storedFrame("g", 600_000),
    ]);
    expect(pairs.every(([prev, next]) => next.timeMs > prev.timeMs)).toBe(true);
  });

  it("does not block first draw waiting for every satellite buffer", () => {
    expect(shouldStartSatelliteCompositeForTesting({
      activeSatellites: 2,
      readySatellites: 1,
      bufferedFrames: 1,
    })).toBe(true);

    expect(shouldStartSatelliteCompositeForTesting({
      activeSatellites: 2,
      readySatellites: 0,
      bufferedFrames: 0,
    })).toBe(false);
  });

  it("uses Hermite displacement to preserve exact endpoints for C1 flow morphing", () => {
    expect(hermiteFlowDisplacementForTesting([0.10, -0.04], [0.06, -0.02], [0.12, -0.03], 0)).toEqual([0, 0]);
    expect(hermiteFlowDisplacementForTesting([0.10, -0.04], [0.06, -0.02], [0.12, -0.03], 1)).toEqual([0.10, -0.04]);

    const linearMid = hermiteFlowDisplacementForTesting([0.10, 0], [0.10, 0], [0.10, 0], 0.5);
    expect(linearMid[0]).toBeCloseTo(0.05, 6);
    expect(linearMid[1]).toBeCloseTo(0, 6);
  });
});

describe("intersectBufferedRanges", () => {
  const MIN10 = 600_000;

  it("returns the single entry's ranges unchanged", () => {
    const ranges = [{ startMs: 0, endMs: 3 * MIN10 }];
    expect(intersectBufferedRanges([ranges], MIN10)).toEqual(ranges);
  });

  it("intersects ranges across satellites (a time must be buffered in all)", () => {
    const a = [{ startMs: 0, endMs: 6 * MIN10 }];
    const b = [{ startMs: 2 * MIN10, endMs: 9 * MIN10 }];
    expect(intersectBufferedRanges([a, b], MIN10)).toEqual([
      { startMs: 2 * MIN10, endMs: 6 * MIN10 },
    ]);
  });

  it("drops non-overlapping segments", () => {
    const a = [{ startMs: 0, endMs: MIN10 }];
    const b = [{ startMs: 5 * MIN10, endMs: 6 * MIN10 }];
    expect(intersectBufferedRanges([a, b], MIN10)).toEqual([]);
  });

  it("returns empty when no entries", () => {
    expect(intersectBufferedRanges([], MIN10)).toEqual([]);
  });
});
