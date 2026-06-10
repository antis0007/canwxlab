import { describe, expect, it } from "vitest";

import {
  estimateGlobalFlow,
  flowRefinementPassesForQuality,
  hermiteFlowDisplacementForTesting,
  isVisibleSatelliteMotionSource,
  preloadTemplatesForTesting,
  selectFlowPairCandidates,
  selectSatelliteFramePairForTesting,
  shouldStartSatelliteCompositeForTesting,
  shouldSwitchSatelliteDrawPair,
  stableVisibleMotionTrustFromSolarElevation,
  templateIsUnavailableFutureForTesting,
} from "./satelliteComposite";

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

function flowFrame(
  key: string,
  timeMs: number | null,
  mercBounds: [number, number, number, number],
  loadedAtMs = timeMs ?? 0,
) {
  return { key, timeMs, mercBounds, loadedAtMs, width: 512, height: 512 };
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

  it("keeps flow scheduling in separate spatial buffers after camera refetch", () => {
    const oldBounds: [number, number, number, number] = [0, 0, 100, 100];
    const newBounds: [number, number, number, number] = [10, 0, 110, 100];

    const pairs = selectFlowPairCandidates([
      flowFrame("old-t0", 0, oldBounds),
      flowFrame("new-t0", 0, newBounds),
      flowFrame("old-t1", 600_000, oldBounds),
      flowFrame("new-t1", 600_000, newBounds),
    ]).map(([prev, next]) => [prev.key, next.key]);

    expect(pairs).toEqual([
      ["new-t0", "new-t1"],
      ["old-t0", "old-t1"],
    ]);
  });

  it("does not create optical-flow pairs from duplicate timestamps", () => {
    const bounds: [number, number, number, number] = [0, 0, 100, 100];

    const pairs = selectFlowPairCandidates([
      flowFrame("first-t0", 0, bounds, 1),
      flowFrame("newer-t0", 0, bounds, 2),
      flowFrame("t1", 600_000, bounds, 3),
    ]).map(([prev, next]) => [prev.key, next.key]);

    expect(pairs).toEqual([["newer-t0", "t1"]]);
  });

  it("adapts dense-flow refinement pass count by render quality", () => {
    expect(flowRefinementPassesForQuality("performance")).toBe(1);
    expect(flowRefinementPassesForQuality("balanced")).toBe(2);
    expect(flowRefinementPassesForQuality("quality")).toBe(3);
  });

  it("preloads advertised WMS times instead of synthetic hard-coded offsets", () => {
    const base = "https://example.test/wms?LAYERS=SAT&TIME=2026-05-18T12:08:00Z&BBOX={bbox-epsg-3857}";
    const extent = [
      "2026-05-18T12:03:00Z",
      "2026-05-18T12:08:00Z",
      "2026-05-18T12:13:00Z",
      "2026-05-18T12:18:00Z",
    ].join(",");

    const times = preloadTemplatesForTesting(base, true, extent)
      .map((template) => new URL(template).searchParams.get("TIME"));

    expect(times).toEqual([
      "2026-05-18T12:08:00Z",
      "2026-05-18T12:13:00Z",
      "2026-05-18T12:18:00Z",
      "2026-05-18T12:03:00Z",
    ]);
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

  it("rejects synthetic future observed WMS frames when no time extent is advertised", () => {
    const now = Date.parse("2026-05-18T12:00:00Z");
    const future = "https://example.test/wms?LAYERS=SAT&TIME=2026-05-18T12:05:00Z";
    const advertised = "2026-05-18T12:00:00Z,2026-05-18T12:05:00Z";

    expect(templateIsUnavailableFutureForTesting(future, null, now)).toBe(true);
    expect(templateIsUnavailableFutureForTesting(future, advertised, now)).toBe(false);
  });

  it("selects coherent draw pairs instead of mixing retained spatial buffers", () => {
    const oldBounds: [number, number, number, number] = [0, 0, 100, 100];
    const newBounds: [number, number, number, number] = [10, 0, 110, 100];
    const t0 = Date.parse("2026-05-18T12:00:00Z");
    const t1 = t0 + 600_000;
    const template0 = `https://example.test/wms?LAYERS=SAT&TIME=${new Date(t0).toISOString()}`;
    const template1 = `https://example.test/wms?LAYERS=SAT&TIME=${new Date(t1).toISOString()}`;

    const pair = selectSatelliteFramePairForTesting([
      { key: "old-t0", template: template0, timeMs: t0, mercBounds: oldBounds, width: 512, height: 512, loadedAtMs: 1 },
      { key: "new-t0", template: template0, timeMs: t0, mercBounds: newBounds, width: 512, height: 512, loadedAtMs: 2 },
      { key: "old-t1", template: template1, timeMs: t1, mercBounds: oldBounds, width: 512, height: 512, loadedAtMs: 3 },
      { key: "new-t1", template: template1, timeMs: t1, mercBounds: newBounds, width: 512, height: 512, loadedAtMs: 4 },
    ], t0 + 120_000, template0);

    expect(pair).toEqual(["new-t0", "new-t1"]);
  });

  it("can draw a single retained satellite frame without manufacturing a flow pair", () => {
    const t0 = Date.parse("2026-05-18T12:00:00Z");
    const template0 = `https://example.test/wms?LAYERS=SAT&TIME=${new Date(t0).toISOString()}`;

    const pair = selectSatelliteFramePairForTesting([
      { key: "only-frame", template: template0, timeMs: t0, mercBounds: [0, 0, 100, 100], width: 512, height: 512 },
    ], t0, template0);

    expect(pair).toEqual(["only-frame", "only-frame"]);
  });

  it("keeps the active spatial buffer during unsafe mid-interval swaps", () => {
    expect(shouldSwitchSatelliteDrawPair({
      activePairKey: "old-t0=>old-t1",
      candidatePairKey: "new-t0=>new-t1",
      activeCoversView: true,
      candidateCoversView: true,
      candidateMotionReady: true,
      phase: 0.50,
    })).toBe(false);

    expect(shouldSwitchSatelliteDrawPair({
      activePairKey: "old-t0=>old-t1",
      candidatePairKey: "new-t0=>new-t1",
      activeCoversView: true,
      candidateCoversView: true,
      candidateMotionReady: true,
      phase: 0.99,
    })).toBe(true);
  });

  it("does not switch to a newly fetched pair until motion or fallback state is ready", () => {
    expect(shouldSwitchSatelliteDrawPair({
      activePairKey: "old-t0=>old-t1",
      candidatePairKey: "new-t0=>new-t1",
      activeCoversView: true,
      candidateCoversView: true,
      candidateMotionReady: false,
      phase: 0.99,
    })).toBe(false);

    expect(shouldSwitchSatelliteDrawPair({
      activePairKey: "old-t0=>old-t1",
      candidatePairKey: "new-t0=>new-t1",
      activeCoversView: false,
      candidateCoversView: true,
      candidateMotionReady: false,
      phase: 0.50,
    })).toBe(true);
  });

  it("uses Hermite displacement to preserve exact endpoints for C1 flow morphing", () => {
    expect(hermiteFlowDisplacementForTesting([0.10, -0.04], [0.06, -0.02], [0.12, -0.03], 0)).toEqual([0, 0]);
    expect(hermiteFlowDisplacementForTesting([0.10, -0.04], [0.06, -0.02], [0.12, -0.03], 1)).toEqual([0.10, -0.04]);

    const linearMid = hermiteFlowDisplacementForTesting([0.10, 0], [0.10, 0], [0.10, 0], 0.5);
    expect(linearMid[0]).toBeCloseTo(0.05, 6);
    expect(linearMid[1]).toBeCloseTo(0, 6);
  });

});
