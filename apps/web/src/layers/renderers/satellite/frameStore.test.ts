import { describe, expect, it, vi } from "vitest";

import { MAX_IN_FLIGHT_PER_SATELLITE } from "./framePlan";
import { FrameStore, type FrameFetchRequest, type FrameStoreOptions } from "./frameStore";

const MIN10 = 600_000;
const T0 = Date.parse("2026-06-09T00:00:00Z");
const times = Array.from({ length: 18 }, (_, i) => T0 + i * MIN10);

function makeStore(overrides: Partial<FrameStoreOptions> = {}) {
  const fetchFrame = vi.fn(async (_req: FrameFetchRequest) => ({ width: 64, height: 64, destroy: vi.fn() }));
  const store = new FrameStore({
    satelliteId: "eccc_goes_east_natural",
    wmsUrlTemplate:
      "https://geo.weather.gc.ca/geomet?SERVICE=WMS&LAYERS=GOES-East_1km_NaturalColor&CRS=EPSG:3857&BBOX={bbox-epsg-3857}&WIDTH=512&HEIGHT=512&FORMAT=image/png&TIME=2026-06-09T00:00:00Z",
    availableTimesMs: times,
    frameIntervalMs: MIN10,
    fetchFrame,
    ...overrides,
  });
  return { store, fetchFrame };
}

const baseUpdate = {
  playheadMs: times[0],
  loopStartMs: times[0],
  loopEndMs: times[17],
  texSize: [512, 512] as [number, number],
};

/** Base-band (whole-world archive) requests are distinguished by their world
 * mercator bounds; viewport-band assertions filter them out. */
function isBaseRequest(req: FrameFetchRequest): boolean {
  return req.mercBounds[0] < -19_000_000;
}

function mainCalls(fetchFrame: { mock: { calls: Array<[FrameFetchRequest]> } }): FrameFetchRequest[] {
  return fetchFrame.mock.calls.map((c) => c[0]).filter((req) => !isBaseRequest(req));
}

describe("FrameStore", () => {
  it("fetches outward from the playhead within in-flight limits", async () => {
    const { store, fetchFrame } = makeStore();
    store.update({
      ...baseUpdate,
      viewBounds: [-9e6, 4e6, -7e6, 5.5e6],
      playheadMs: times[9],
    });
    expect(mainCalls(fetchFrame).length).toBeLessThanOrEqual(MAX_IN_FLIGHT_PER_SATELLITE);
    expect(mainCalls(fetchFrame)[0].timeMs).toBe(times[9]);
    await vi.waitFor(() => expect(store.getBufferedRanges().length).toBeGreaterThan(0));
  });

  it("fetches a whole-world base-band sequence in the background", async () => {
    const { store, fetchFrame } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await vi.waitFor(() => {
      const base = fetchFrame.mock.calls.map((c) => c[0]).filter(isBaseRequest);
      expect(base.length).toBeGreaterThan(0);
      expect(base[0].texSize).toEqual([512, 512]);
    });
  });

  it("framesAt falls back to the base band when the viewport band is empty", async () => {
    // Viewport-band fetches fail; only the world base band loads.
    const fetchFrame = vi.fn(async (req: FrameFetchRequest) => {
      if (!isBaseRequest(req)) throw new Error("viewport band unavailable");
      return { width: 512, height: 512, destroy: vi.fn() };
    });
    const { store } = makeStore({ fetchFrame });
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await vi.waitFor(() => {
      const pair = store.framesAt(times[1]);
      expect(pair).not.toBeNull();
      expect(pair!.prev.gridKey.startsWith("base|")).toBe(true);
    });
  });

  it("reports buffered ranges and resolves whenTimeBuffered", async () => {
    const { store } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[0]);
    const ranges = store.getBufferedRanges();
    expect(ranges[0].startMs).toBe(times[0]);
  });

  it("keeps fetching after completions until the half-window ahead is buffered", async () => {
    const { store, fetchFrame } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    // Playhead at times[0]: prefetch covers playhead + LOOP_BUFFER_SPAN/2 = 1.5 h
    // = frames 0..9. Frames beyond the half-window arrive as the playhead moves.
    await vi.waitFor(() => {
      const ranges = store.getBufferedRanges();
      expect(ranges.length).toBe(1);
      expect(ranges[0].endMs).toBe(times[9]);
    });
    expect(mainCalls(fetchFrame).length).toBe(10);
  });

  it("aborts in-flight fetches that fall out of the loop window (same grid, no scrub)", async () => {
    const signals = new Map<number, AbortSignal>();
    const fetchFrame = vi.fn((req: FrameFetchRequest) => {
      if (req.mercBounds[0] >= -19_000_000) signals.set(req.timeMs, req.signal); // main band only
      return new Promise<never>(() => {}); // stay in-flight so we can observe abort
    });
    const { store } = makeStore({ fetchFrame });
    const view = { ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] as [number, number, number, number] };

    // Playhead at times[9], full window → fetches around times[9] start and stay
    // pending (9,10,8,11,12,7 within the 6 in-flight budget).
    store.update({ ...view, playheadMs: times[9] });
    expect(signals.has(times[8])).toBe(true);

    // Same grid, same playhead (no scrub), but shrink the window to [9,10].
    store.update({ ...view, playheadMs: times[9], loopStartMs: times[9], loopEndMs: times[10] });

    // Out-of-window in-flight aborted; still-wanted ones kept.
    expect(signals.get(times[8])!.aborted).toBe(true);
    expect(signals.get(times[7])!.aborted).toBe(true);
    expect(signals.get(times[9])!.aborted).toBe(false);
  });

  it("framesAt returns the bracketing pair for a mid-interval time", async () => {
    const { store } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[1]);
    await vi.waitFor(() => expect(store.framesAt(times[0] + MIN10 / 2)?.next.timeMs).toBe(times[1]));
    const pair = store.framesAt(times[0] + MIN10 / 2);
    expect(pair?.prev.timeMs).toBe(times[0]);
    expect(pair?.next.timeMs).toBe(times[1]);
  });

  it("does not invalidate buffered frames for pans inside the same grid cell", async () => {
    const { store, fetchFrame } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[0]);
    const callsBefore = fetchFrame.mock.calls.length;
    store.update({ ...baseUpdate, viewBounds: [-8.9e6, 4.1e6, -6.9e6, 5.6e6] });
    expect(store.framesAt(times[0])).not.toBeNull();
    const refetched = fetchFrame.mock.calls
      .slice(callsBefore)
      .filter((c) => c[0].timeMs === times[0]);
    expect(refetched).toHaveLength(0);
  });

  it("keeps old-grid frames drawable after a zoom-band change", async () => {
    const { store } = makeStore();
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[0]);
    // Much smaller viewport → different zoom band → new grid.
    store.update({ ...baseUpdate, viewBounds: [-8.05e6, 4.5e6, -8.0e6, 4.54e6] });
    expect(store.framesAt(times[0])).not.toBeNull();
  });

  it("records failures and does not retry inside the cooldown", async () => {
    const fetchFrame = vi.fn(async (_req: FrameFetchRequest) => {
      throw new Error("boom");
    });
    const { store } = makeStore({ fetchFrame });
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    // All 10 viewport-band times in the prefetch window fail once, then cool down.
    await vi.waitFor(() => expect(mainCalls(fetchFrame).length).toBe(10));
    await new Promise((r) => setTimeout(r, 10));
    const callsAfterFailure = mainCalls(fetchFrame).length;
    expect(callsAfterFailure).toBe(10);
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await new Promise((r) => setTimeout(r, 10));
    expect(mainCalls(fetchFrame).length).toBe(callsAfterFailure);
  });

  it("destroy aborts in-flight fetches and destroys textures", async () => {
    const destroySpy = vi.fn();
    const fetchFrame = vi.fn(async () => ({ width: 64, height: 64, destroy: destroySpy }));
    const { store } = makeStore({ fetchFrame });
    store.update({ ...baseUpdate, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[0]);
    store.destroy();
    expect(destroySpy).toHaveBeenCalled();
    expect(store.getBufferedRanges()).toEqual([]);
  });
});

describe("scrub cancellation", () => {
  it("aborts in-flight fetches for times scrolled past and narrows the fetch window", async () => {
    let resolvers: Array<() => void> = [];
    const fetchFrame = vi.fn((_req: FrameFetchRequest) =>
      new Promise<{ width: number; height: number; destroy: () => void }>((resolve, reject) => {
        resolvers.push(() => resolve({ width: 64, height: 64, destroy: vi.fn() }));
        _req.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }));
    const { store } = makeStore({ fetchFrame });
    const view: [number, number, number, number] = [-9e6, 4e6, -7e6, 5.5e6];

    store.update({ ...baseUpdate, viewBounds: view, playheadMs: times[0] });
    const initialInFlight = store.inFlightCount();
    expect(initialInFlight).toBeGreaterThan(0);

    // Big playhead jump = scrubbing: in-flight fetches for the old
    // neighborhood abort, and only the immediate new neighborhood (≤2 frames)
    // is requested until the playhead settles.
    store.update({ ...baseUpdate, viewBounds: view, playheadMs: times[12] });
    await new Promise((r) => setTimeout(r, 5));
    for (const request of mainCalls(fetchFrame)) {
      if (Math.abs(request.timeMs - times[12]) > 600_000 * 1.5) {
        expect(request.signal.aborted).toBe(true);
      }
    }
    // ≤2 viewport-band fetches while scrubbing, +1 base-band background slot.
    expect(store.inFlightCount()).toBeLessThanOrEqual(3);
  });

  it("resumes full prefetch once the playhead settles", async () => {
    const fetchFrame = vi.fn(async (_req: FrameFetchRequest) => ({ width: 64, height: 64, destroy: vi.fn() }));
    const { store } = makeStore({ fetchFrame });
    const view: [number, number, number, number] = [-9e6, 4e6, -7e6, 5.5e6];

    store.update({ ...baseUpdate, viewBounds: view, playheadMs: times[0] });
    // Jump (scrub) then settle at the same playhead.
    store.update({ ...baseUpdate, viewBounds: view, playheadMs: times[12] });
    store.update({ ...baseUpdate, viewBounds: view, playheadMs: times[12] });
    await vi.waitFor(() => {
      const ranges = store.getBufferedRanges();
      expect(ranges.some((r) => r.startMs <= times[12] && r.endMs >= times[12])).toBe(true);
    });
  });
});
