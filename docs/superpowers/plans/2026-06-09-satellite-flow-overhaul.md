# Satellite Flow Overhaul + Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seamless, freeze-free satellite cloud animation with honest motion (no hallucinated flow, no land smear) and working GIF/WebM/MP4 export of a selected area over a selected time range.

**Architecture:** Split the 3 096-line `satelliteComposite.ts` into a time-indexed frame store, a pyramid flow pipeline with cloud/background separation, and a thin deck.gl layer. Playback uses a video-player buffering model (playhead clamped to buffered span). Export captures inside MapLibre's render callback behind a pluggable `FrameSink` encoder interface.

**Tech Stack:** TypeScript, React 18, deck.gl/luma.gl (WebGL2), MapLibre GL, vitest, gifenc, WebCodecs + mp4-muxer + webm-muxer.

**Spec:** `docs/superpowers/specs/2026-06-09-satellite-flow-overhaul-design.md`

**Conventions:** Web app lives in `apps/web`. Run tests with `npx vitest run <file>` from `apps/web`. All new code follows existing style: no default exports, explicit types, `logManager` for logging. Commit after every green test cycle.

---

## Phase 1 — Frame store (fixes freeze)

### Task 1: Grid snapping + buffered-range math (pure functions)

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/frameGrid.ts`
- Test: `apps/web/src/layers/renderers/satellite/frameGrid.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/layers/renderers/satellite/frameGrid.test.ts
import { describe, expect, it } from "vitest";
import {
  snapFetchBounds,
  zoomBandForViewport,
  mergeBufferedRanges,
  clampPlayheadToBuffered,
} from "./frameGrid";

describe("zoomBandForViewport", () => {
  it("quantizes mercator width into discrete bands", () => {
    // Band = floor(log2(worldWidth / viewWidth)). World width ≈ 40075016 m.
    expect(zoomBandForViewport(40_075_016)).toBe(0);
    expect(zoomBandForViewport(10_018_754)).toBe(2);
    expect(zoomBandForViewport(10_018_754 * 0.99)).toBe(2); // hysteresis-free floor
  });
});

describe("snapFetchBounds", () => {
  it("returns identical bounds for any viewport inside the same grid cell", () => {
    const a = snapFetchBounds([-9_000_000, 4_000_000, -7_000_000, 5_500_000]);
    const b = snapFetchBounds([-8_900_000, 4_100_000, -6_900_000, 5_600_000]);
    expect(a).toEqual(b);
  });

  it("covers the viewport with padding", () => {
    const view: [number, number, number, number] = [-9_000_000, 4_000_000, -7_000_000, 5_500_000];
    const snapped = snapFetchBounds(view);
    expect(snapped[0]).toBeLessThanOrEqual(view[0]);
    expect(snapped[1]).toBeLessThanOrEqual(view[1]);
    expect(snapped[2]).toBeGreaterThanOrEqual(view[2]);
    expect(snapped[3]).toBeGreaterThanOrEqual(view[3]);
  });

  it("changes cell when the viewport moves more than one cell width", () => {
    const a = snapFetchBounds([-9_000_000, 4_000_000, -7_000_000, 5_500_000]);
    const b = snapFetchBounds([-1_000_000, 4_000_000, 1_000_000, 5_500_000]);
    expect(a).not.toEqual(b);
  });
});

describe("mergeBufferedRanges", () => {
  it("merges overlapping and adjacent frame times into ranges", () => {
    const interval = 600_000;
    expect(mergeBufferedRanges([0, 600_000, 1_200_000, 3_000_000], interval)).toEqual([
      { startMs: 0, endMs: 1_200_000 },
      { startMs: 3_000_000, endMs: 3_000_000 },
    ]);
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

  it("returns the input when no ranges exist (degenerate: don't lock UI)", () => {
    expect(clampPlayheadToBuffered(42, [])).toBe(42);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run from `apps/web`: `npx vitest run src/layers/renderers/satellite/frameGrid.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/layers/renderers/satellite/frameGrid.ts
/** Pure math for snapped fetch grids and buffered-range bookkeeping.
 *
 * Fetch bounds are quantized to a power-of-two mercator grid so that panning
 * within a grid cell never invalidates buffered imagery or flow history.
 */

export interface BufferedRange {
  startMs: number;
  endMs: number;
}

const WORLD_MERC_WIDTH = 40_075_016.685578488;
/** Snapped quad spans 2 grid cells per axis so the viewport plus padding
 * always fits while pans up to half a cell stay inside the same quad. */
const CELLS_PER_QUAD = 2;

export function zoomBandForViewport(viewMercWidth: number): number {
  const safe = Math.max(1, Math.abs(viewMercWidth));
  return Math.max(0, Math.floor(Math.log2(WORLD_MERC_WIDTH / safe)));
}

export function snapFetchBounds(
  viewBounds: [number, number, number, number],
): [number, number, number, number] {
  const width = Math.abs(viewBounds[2] - viewBounds[0]);
  const band = zoomBandForViewport(width);
  const cell = WORLD_MERC_WIDTH / Math.pow(2, band + 1);
  const cx = (viewBounds[0] + viewBounds[2]) / 2;
  const cy = (viewBounds[1] + viewBounds[3]) / 2;
  const snapX = Math.floor(cx / cell) * cell;
  const snapY = Math.floor(cy / cell) * cell;
  const half = (cell * CELLS_PER_QUAD) / 2;
  const centerX = snapX + cell / 2;
  const centerY = snapY + cell / 2;
  return [centerX - half, centerY - half, centerX + half, centerY + half];
}

export function mergeBufferedRanges(frameTimesMs: number[], frameIntervalMs: number): BufferedRange[] {
  const sorted = [...frameTimesMs].sort((a, b) => a - b);
  const out: BufferedRange[] = [];
  for (const t of sorted) {
    const last = out[out.length - 1];
    if (last && t - last.endMs <= frameIntervalMs) {
      last.endMs = t;
    } else {
      out.push({ startMs: t, endMs: t });
    }
  }
  return out;
}

export function clampPlayheadToBuffered(timeMs: number, ranges: BufferedRange[]): number {
  if (ranges.length === 0) return timeMs;
  for (const range of ranges) {
    if (timeMs >= range.startMs && timeMs <= range.endMs) return timeMs;
  }
  // Snap to the nearest range boundary at or before timeMs, else first start.
  let best: number | null = null;
  for (const range of ranges) {
    if (range.endMs <= timeMs && (best === null || range.endMs > best)) best = range.endMs;
  }
  if (best !== null) return best;
  return ranges[0].startMs;
}
```

- [ ] **Step 4: Run to verify pass** — same command, expected PASS. Adjust the `snapFetchBounds` cell-coverage logic if the padding assertion fails (grow `CELLS_PER_QUAD` or center on the containing cell), keeping the "same cell ⇒ same bounds" invariant.

- [ ] **Step 5: Commit** — `git add apps/web/src/layers/renderers/satellite && git commit -m "feat(web): add snapped fetch grid and buffered-range math for satellite frames"`

### Task 2: Prefetch ordering + eviction policy (pure functions)

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/framePlan.ts`
- Test: `apps/web/src/layers/renderers/satellite/framePlan.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/src/layers/renderers/satellite/framePlan.test.ts
import { describe, expect, it } from "vitest";
import { planPrefetch, planEviction, LOOP_BUFFER_SPAN_MS } from "./framePlan";

const MIN10 = 600_000;
const times = (n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i * MIN10);

describe("planPrefetch", () => {
  it("orders wanted times outward from the playhead, ahead-biased 2:1", () => {
    const avail = times(36); // 6 h of 10-min frames
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [],
      playheadMs: avail[18],
      loopStartMs: avail[0],
      loopEndMs: avail[35],
    });
    expect(plan[0]).toBe(avail[18]);          // current first
    expect(plan[1]).toBe(avail[19]);          // then ahead
    expect(plan[2]).toBe(avail[20]);          // two ahead per one behind
    expect(plan[3]).toBe(avail[17]);          // then behind
    expect(plan.length).toBeLessThanOrEqual(Math.ceil(LOOP_BUFFER_SPAN_MS / MIN10) + 1);
  });

  it("skips already-buffered times", () => {
    const avail = times(6);
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [avail[0], avail[1]],
      playheadMs: avail[0],
      loopStartMs: avail[0],
      loopEndMs: avail[5],
    });
    expect(plan).not.toContain(avail[0]);
    expect(plan).not.toContain(avail[1]);
  });

  it("clamps the wanted window to the loop range", () => {
    const avail = times(100);
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [],
      playheadMs: avail[2],
      loopStartMs: avail[0],
      loopEndMs: avail[10],
    });
    expect(Math.max(...plan)).toBeLessThanOrEqual(avail[10]);
  });
});

describe("planEviction", () => {
  it("evicts frames outside the buffer window, farthest from playhead first", () => {
    const frames = times(50).map((timeMs) => ({ timeMs, protected: false }));
    const evict = planEviction(frames, times(50)[25], 40);
    expect(evict.length).toBe(10);
    expect(evict).toContain(0);          // farthest behind goes
    expect(evict).not.toContain(times(50)[25]);
  });

  it("never evicts protected frames", () => {
    const frames = times(50).map((timeMs, i) => ({ timeMs, protected: i === 0 }));
    const evict = planEviction(frames, times(50)[49], 40);
    expect(evict).not.toContain(0);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/layers/renderers/satellite/framePlan.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/layers/renderers/satellite/framePlan.ts
/** Prefetch ordering and eviction for the satellite frame ring buffer. */

export const LOOP_BUFFER_SPAN_MS = 3 * 60 * 60 * 1000; // 3 h seamless window
export const MAX_RETAINED_FRAMES = 40;
export const MAX_IN_FLIGHT_PER_SATELLITE = 4;
export const MAX_IN_FLIGHT_TOTAL = 8;

export interface PrefetchInput {
  availableTimesMs: number[];
  bufferedTimesMs: number[];
  playheadMs: number;
  loopStartMs: number;
  loopEndMs: number;
}

/** Wanted fetch times ordered outward from the playhead, biased 2 ahead : 1
 * behind, clamped to the loop window and the 3 h buffer span. */
export function planPrefetch(input: PrefetchInput): number[] {
  const buffered = new Set(input.bufferedTimesMs);
  const half = LOOP_BUFFER_SPAN_MS / 2;
  const windowStart = Math.max(input.loopStartMs, input.playheadMs - half);
  const windowEnd = Math.min(input.loopEndMs, input.playheadMs + half);
  const candidates = input.availableTimesMs
    .filter((t) => t >= windowStart && t <= windowEnd && !buffered.has(t))
    .sort((a, b) => a - b);

  const ahead = candidates.filter((t) => t >= input.playheadMs);
  const behind = candidates.filter((t) => t < input.playheadMs).reverse();
  const out: number[] = [];
  let ai = 0;
  let bi = 0;
  while (ai < ahead.length || bi < behind.length) {
    for (let k = 0; k < 2 && ai < ahead.length; k += 1) out.push(ahead[ai++]);
    if (bi < behind.length) out.push(behind[bi++]);
  }
  return out;
}

/** Frame times to evict when over budget. Protected frames are never evicted. */
export function planEviction(
  frames: Array<{ timeMs: number; protected: boolean }>,
  playheadMs: number,
  budget: number = MAX_RETAINED_FRAMES,
): number[] {
  const overflow = frames.length - budget;
  if (overflow <= 0) return [];
  return frames
    .filter((f) => !f.protected)
    .sort((a, b) => Math.abs(b.timeMs - playheadMs) - Math.abs(a.timeMs - playheadMs))
    .slice(0, overflow)
    .map((f) => f.timeMs);
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(web): add prefetch ordering and eviction policy for satellite buffer"`

### Task 3: FrameStore class (fetching, ring buffer, ranges, whenTimeBuffered)

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/frameStore.ts`
- Test: `apps/web/src/layers/renderers/satellite/frameStore.test.ts`
- Reference (move logic from): `apps/web/src/layers/renderers/satelliteComposite.ts` — `buildProxiedWmsUrl`, `loadImageWithRetry`, `templateTimeMs`, `replaceTemplateTime`, `parseWmsTimeDimension` usage, `createSatelliteTexture`, retry/cooldown constants (lines ~1080–1465, 2455–2700)

- [ ] **Step 1: Write failing tests** (inject fetch + texture factory so no GPU/network needed)

```ts
// apps/web/src/layers/renderers/satellite/frameStore.test.ts
import { describe, expect, it, vi } from "vitest";
import { FrameStore } from "./frameStore";

const MIN10 = 600_000;
const T0 = Date.parse("2026-06-09T00:00:00Z");
const times = Array.from({ length: 18 }, (_, i) => T0 + i * MIN10);

function makeStore(overrides: Partial<ConstructorParameters<typeof FrameStore>[0]> = {}) {
  const fetchFrame = vi.fn(async () => ({ width: 64, height: 64, destroy: vi.fn() }));
  const store = new FrameStore({
    satelliteId: "eccc_goes_east_natural",
    wmsUrlTemplate: "https://x/wms?TIME=2026-06-09T00:00:00Z&LAYERS=L&{bbox-epsg-3857}",
    availableTimesMs: times,
    frameIntervalMs: MIN10,
    fetchFrame,
    ...overrides,
  });
  return { store, fetchFrame };
}

describe("FrameStore", () => {
  it("fetches outward from the playhead within in-flight limits", async () => {
    const { store, fetchFrame } = makeStore();
    store.update({
      viewBounds: [-9e6, 4e6, -7e6, 5.5e6],
      playheadMs: times[9],
      loopStartMs: times[0],
      loopEndMs: times[17],
      texSize: [512, 512],
    });
    expect(fetchFrame.mock.calls.length).toBeLessThanOrEqual(4);
    expect(fetchFrame.mock.calls[0][0].timeMs).toBe(times[9]);
    await vi.waitFor(() => expect(store.getBufferedRanges().length).toBeGreaterThan(0));
  });

  it("reports buffered ranges and resolves whenTimeBuffered", async () => {
    const { store } = makeStore();
    store.update({
      viewBounds: [-9e6, 4e6, -7e6, 5.5e6],
      playheadMs: times[0],
      loopStartMs: times[0],
      loopEndMs: times[17],
      texSize: [512, 512],
    });
    await store.whenTimeBuffered(times[0]);
    const ranges = store.getBufferedRanges();
    expect(ranges[0].startMs).toBe(times[0]);
  });

  it("framesAt returns the bracketing pair for a mid-interval time", async () => {
    const { store } = makeStore();
    store.update({
      viewBounds: [-9e6, 4e6, -7e6, 5.5e6],
      playheadMs: times[0],
      loopStartMs: times[0],
      loopEndMs: times[17],
      texSize: [512, 512],
    });
    await store.whenTimeBuffered(times[1]);
    const pair = store.framesAt(times[0] + MIN10 / 2);
    expect(pair?.prev.timeMs).toBe(times[0]);
    expect(pair?.next.timeMs).toBe(times[1]);
  });

  it("does not invalidate buffered frames for pans inside the same grid cell", async () => {
    const { store, fetchFrame } = makeStore();
    const base = {
      playheadMs: times[0], loopStartMs: times[0], loopEndMs: times[17],
      texSize: [512, 512] as [number, number],
    };
    store.update({ ...base, viewBounds: [-9e6, 4e6, -7e6, 5.5e6] });
    await store.whenTimeBuffered(times[0]);
    const callsBefore = fetchFrame.mock.calls.length;
    store.update({ ...base, viewBounds: [-8.9e6, 4.1e6, -6.9e6, 5.6e6] }); // small pan
    expect(store.framesAt(times[0])).not.toBeNull();
    // No refetch of already-buffered times for the same cell:
    const refetched = fetchFrame.mock.calls.slice(callsBefore).filter((c) => c[0].timeMs === times[0]);
    expect(refetched).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement `FrameStore`.** Key structure (complete the marked sections by moving existing logic — exact sources listed):

```ts
// apps/web/src/layers/renderers/satellite/frameStore.ts
/** Time-indexed satellite frame ring buffer with snapped-grid fetching.
 *
 * Replaces the viewport-anchored preload queue in satelliteComposite.ts.
 * Frames are keyed by (snapped grid cell, timeMs). Pans inside a grid cell
 * reuse the buffer; zoom-band changes start a new sequence while the old one
 * remains drawable until the new one has a usable pair.
 */
import { mergeBufferedRanges, snapFetchBounds, type BufferedRange } from "./frameGrid";
import {
  planPrefetch, planEviction,
  MAX_IN_FLIGHT_PER_SATELLITE, MAX_RETAINED_FRAMES,
} from "./framePlan";

export interface StoredFrame {
  timeMs: number;
  gridKey: string;
  mercBounds: [number, number, number, number];
  texture: { width: number; height: number; destroy: () => void };
  width: number;
  height: number;
}

export interface FrameFetchRequest {
  timeMs: number;
  url: string;
  mercBounds: [number, number, number, number];
  signal: AbortSignal;
}

export interface FrameStoreOptions {
  satelliteId: string;
  wmsUrlTemplate: string;
  availableTimesMs: number[];
  frameIntervalMs: number;
  /** Injected fetch → decoded GPU texture. Production impl wraps
   *  buildProxiedWmsUrl + loadImageWithRetry + createSatelliteTexture
   *  (moved from satelliteComposite.ts). Tests inject a stub. */
  fetchFrame: (req: FrameFetchRequest) => Promise<StoredFrame["texture"]>;
  onChange?: () => void;
}

export class FrameStore { /* fields: frames Map<string, StoredFrame>,
  inFlight Map<string, AbortController>, failedTimes Map<number, number>,
  waiters Map<number, Array<() => void>>, currentGridKey, options */

  update(input: {
    viewBounds: [number, number, number, number];
    playheadMs: number;
    loopStartMs: number;
    loopEndMs: number;
    texSize: [number, number];
  }): void { /* snapFetchBounds → gridKey; if gridKey changed, keep old frames
    (drawable fallback) but abort stale in-flight; planPrefetch over
    availableTimesMs minus buffered-for-current-grid; start fetches up to
    MAX_IN_FLIGHT_PER_SATELLITE honoring failedTimes cooldown (5 min, moved
    constant FAILED_URL_COOLDOWN_MS); planEviction with protected = frames of
    currentGridKey inside buffer window; destroy evicted textures; notify
    waiters whose time becomes buffered; call onChange. */ }

  getBufferedRanges(): BufferedRange[] {
    /* mergeBufferedRanges over frames of currentGridKey */
  }

  whenTimeBuffered(timeMs: number): Promise<void> { /* resolve immediately if
    nearest available time ≤ frameIntervalMs away is buffered; else queue
    waiter resolved in update()/fetch completion. */ }

  framesAt(timelineMs: number): { prev: StoredFrame; next: StoredFrame } | null {
    /* binary search sorted frames of currentGridKey; return bracketing pair;
       clamp to first/last pair when outside; null when empty. Falls back to
       previous gridKey's frames when current grid has < 2 frames. */
  }

  setTemplate(template: string, availableTimesMs: number[]): void { /* swap
    template + times; do NOT clear frames (times overlap across refreshes). */ }

  destroy(): void { /* abort all, destroy textures */ }
}
```

  Implementation notes (do these, not placeholders — the bodies are short):
  - `gridKey` = `snapFetchBounds(viewBounds).join(",") + "|" + texSize.join("x")`.
  - URL construction: move `buildProxiedWmsUrl`, `templateTimeMs`, `replaceTemplateTime`, `formatWmsUtcSecond` calls from `satelliteComposite.ts` lines 1081–1207 into a small `wmsRequest.ts` next to `frameStore.ts` and import from both (keep old file importing it too — re-export to avoid breaking tests).
  - Retry: move `loadImageWithRetry` + `RETRY_DELAYS_MS` into `wmsRequest.ts`.
  - The production `fetchFrame` lives in `frameStoreFactory.ts` (Task 8) where the GPU device is available.

- [ ] **Step 4: Run to verify pass.** All 4 tests green.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): time-indexed satellite FrameStore with snapped-grid fetching"`

## Phase 2 — Playback sync

### Task 4: Playhead clamp + isBuffering in useAnimationTimeline

**Files:**
- Modify: `apps/web/src/layers/animation.ts` (rAF tick at lines 218–276)
- Modify: `apps/web/src/time/timelineWindow.ts` (re-export clamp helper)
- Test: `apps/web/src/layers/animation.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

```ts
// append to apps/web/src/layers/animation.test.ts
import { advancePlayheadForTesting } from "./animation";

describe("advancePlayheadForTesting (buffered clamp)", () => {
  const MIN5 = 5 * 60 * 1000;
  const windowStartMs = 0;
  const ranges = [{ startMs: 0, endMs: 60 * MIN5 }]; // frames 0..60 buffered

  it("advances normally inside the buffered span", () => {
    const r = advancePlayheadForTesting({
      current: 10, deltaFrames: 0.5, loopStart: 0, loopEnd: 100,
      maxPlayableFrame: 100, windowStartMs, frameIntervalMs: MIN5, bufferedRanges: ranges,
    });
    expect(r.next).toBeCloseTo(10.5);
    expect(r.isBuffering).toBe(false);
  });

  it("clamps at the buffer edge and reports buffering", () => {
    const r = advancePlayheadForTesting({
      current: 59.9, deltaFrames: 1.0, loopStart: 0, loopEnd: 100,
      maxPlayableFrame: 100, windowStartMs, frameIntervalMs: MIN5, bufferedRanges: ranges,
    });
    expect(r.next).toBe(60);
    expect(r.isBuffering).toBe(true);
  });

  it("loops within the buffered span when loopEnd is buffered", () => {
    const r = advancePlayheadForTesting({
      current: 59.5, deltaFrames: 1.0, loopStart: 0, loopEnd: 60,
      maxPlayableFrame: 60, windowStartMs, frameIntervalMs: MIN5, bufferedRanges: ranges,
    });
    expect(r.next).toBeLessThan(60);
    expect(r.isBuffering).toBe(false);
  });

  it("ignores clamp when no ranges provided (no satellite layers active)", () => {
    const r = advancePlayheadForTesting({
      current: 80, deltaFrames: 1, loopStart: 0, loopEnd: 100,
      maxPlayableFrame: 100, windowStartMs, frameIntervalMs: MIN5, bufferedRanges: [],
    });
    expect(r.next).toBeCloseTo(81);
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/layers/animation.test.ts`.

- [ ] **Step 3: Implement.** Extract the tick's advance math (animation.ts lines 237–244) into an exported pure function and add the clamp:

```ts
// animation.ts (new export, used by the rAF tick)
import { clampPlayheadToBuffered, type BufferedRange } from "../layers/renderers/satellite/frameGrid";

export function advancePlayheadForTesting(input: {
  current: number; deltaFrames: number; loopStart: number; loopEnd: number;
  maxPlayableFrame: number; windowStartMs: number; frameIntervalMs: number;
  bufferedRanges: BufferedRange[];
}): { next: number; isBuffering: boolean } {
  const legalLoopEnd = Math.min(input.loopEnd, input.maxPlayableFrame);
  const legalLoopStart = Math.max(0, Math.min(input.loopStart, legalLoopEnd));
  const span = Math.max(1, legalLoopEnd - legalLoopStart);
  const rawNext = input.current + input.deltaFrames;
  let next = rawNext > legalLoopEnd
    ? legalLoopStart + ((rawNext - legalLoopEnd) % span)
    : Math.max(legalLoopStart, Math.min(legalLoopEnd, rawNext));

  if (input.bufferedRanges.length === 0) return { next, isBuffering: false };

  const nextMs = input.windowStartMs + next * input.frameIntervalMs;
  const clampedMs = clampPlayheadToBuffered(nextMs, input.bufferedRanges);
  if (clampedMs === nextMs) return { next, isBuffering: false };
  const clampedFrame = (clampedMs - input.windowStartMs) / input.frameIntervalMs;
  // Buffering only when we were moving forward and got held back.
  return { next: clampedFrame, isBuffering: input.deltaFrames > 0 && clampedFrame <= input.current + 1e-6 };
}
```

  Wire into the hook: `useAnimationTimeline` gains an option `getBufferedRanges?: () => BufferedRange[]` (ref-based like `onProgress`); the tick calls `advancePlayheadForTesting` with `bufferedRanges: getBufferedRangesRef.current?.() ?? []`; add `const [isBuffering, setIsBuffering] = useState(false)` committed on change only (not per tick); expose `isBuffering` in `playbackState` (add the field to `AnimationPlaybackState` in `apps/web/src/layers/types.ts`).

- [ ] **Step 4: Run to verify pass** — full `npx vitest run src/layers/animation.test.ts`.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): clamp playhead to buffered satellite ranges (video-player model)"`

### Task 5: Buffered-region timeline UI + buffering indicator

**Files:**
- Modify: `apps/web/src/components/workbench/BottomTimeline.tsx`
- Modify: `apps/web/src/workbench.css`
- Modify: `apps/web/src/App.tsx` (plumb `bufferedRanges` from MapView → timeline; plumb `getBufferedRanges` into `useAnimationTimeline`)
- Modify: `apps/web/src/components/MapView.tsx` (expose ranges from satellite layer via callback prop `onSatelliteBufferedRanges`)
- Test: `apps/web/src/components/workbench/workbenchPanels.test.tsx` (extend)

- [ ] **Step 1: Write failing test** — render `BottomTimeline` with `bufferedRanges=[{startMs, endMs}]` covering 25–50 % of the window; assert an element with `data-testid="timeline-buffered-band"` exists with `style.left === "25%"` and `style.width === "25%"`. Render with `isBuffering=true`; assert play button has class `is-buffering`.
- [ ] **Step 2: Run to verify fail** — `npx vitest run src/components/workbench/workbenchPanels.test.tsx`.
- [ ] **Step 3: Implement.** `BottomTimeline` props gain `bufferedRanges?: BufferedRange[]` and `isBuffering?: boolean`. Render inside the existing track element:

```tsx
{bufferedRanges?.map((r) => {
  const left = ((r.startMs - windowStartMs) / windowDurationMs) * 100;
  const width = ((r.endMs - r.startMs) / windowDurationMs) * 100;
  if (!Number.isFinite(left) || width <= 0) return null;
  return (
    <div key={r.startMs} data-testid="timeline-buffered-band" className="timeline-buffered-band"
      style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100 - Math.max(0, left), width)}%` }} />
  );
})}
```

  CSS: `.timeline-buffered-band { position:absolute; top:0; bottom:0; background:rgba(120,180,255,.18); pointer-events:none; }` and `.is-buffering` spinner reuse of existing loading spinner class. MapView: in `onLoadingStateChange` flow, also call new prop `onSatelliteBufferedRanges(layer.getBufferedRanges())` (layer method added Task 8; until then prop is optional and unused — keep test at component level so it passes now).
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(web): show buffered satellite ranges and buffering state on timeline"`

## Phase 3 — Flow pipeline

### Task 6: Pyramid scheduling + native-resolution cap (pure math)

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/flowPlan.ts`
- Test: `apps/web/src/layers/renderers/satellite/flowPlan.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import { pyramidLevelsFor, NATIVE_GSD_M } from "./flowPlan";

describe("pyramidLevelsFor", () => {
  it("returns full pyramid when imagery is at/below native resolution", () => {
    // 2000 km wide view at 1024 px → 1953 m/px ≈ native → all levels
    expect(pyramidLevelsFor({ mercWidthM: 2_000_000, texWidthPx: 1024 })).toEqual([64, 128, 256, 512]);
  });

  it("caps the finest level when zoomed past native resolution", () => {
    // 100 km wide view at 1024 px → 97 m/px, 20× oversampled vs 2 km native.
    // Native detail spans 1024 / 20 ≈ 50 native px → cap near 64.
    expect(pyramidLevelsFor({ mercWidthM: 100_000, texWidthPx: 1024 })).toEqual([64]);
  });

  it("intermediate zoom keeps intermediate levels", () => {
    const levels = pyramidLevelsFor({ mercWidthM: 500_000, texWidthPx: 1024 });
    expect(levels[levels.length - 1]).toBe(256);
  });
});
```

  (Adjust expected values once: compute `nativePx = mercWidthM / NATIVE_GSD_M`, levels = standard `[64,128,256,512]` filtered to `level <= max(64, pow2floor(nativePx))`. Verify the three cases against that formula and pin them.)

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement**

```ts
// apps/web/src/layers/renderers/satellite/flowPlan.ts
/** Pyramid level selection capped by native satellite resolution so dense
 * flow never "discovers" motion finer than the data supports. */
export const NATIVE_GSD_M = 2_000; // GOES ABI ~2 km effective
export const FLOW_PYRAMID = [64, 128, 256, 512] as const;

function pow2Floor(v: number): number {
  return Math.pow(2, Math.floor(Math.log2(Math.max(1, v))));
}

export function pyramidLevelsFor(input: { mercWidthM: number; texWidthPx: number }): number[] {
  const nativePx = Math.max(1, input.mercWidthM / NATIVE_GSD_M);
  const cap = Math.max(FLOW_PYRAMID[0], pow2Floor(nativePx));
  const levels = FLOW_PYRAMID.filter((l) => l <= cap);
  return levels.length > 0 ? [...levels] : [FLOW_PYRAMID[0]];
}
```

- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(web): pyramid level plan with native-resolution cap"`

### Task 7: FlowPipeline module — pyramid LK + smoothing + FB consistency + background/cloud mask (GPU)

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/flowPipeline.ts`
- Test: `apps/web/src/layers/renderers/satellite/flowPipeline.test.ts` (shader-source + scheduling tests; GPU passes not unit-testable in vitest)
- Reference: existing `FLOW_FS`/`FLOW_VS` shaders and `_runFlowPass`/`_computeFlowTextureForPair` in `satelliteComposite.ts` lines 531–699, 2960–3061

This task is GPU-heavy; structure it as a class owning all flow GLSL and FBOs, with an idle-queue scheduler. Sub-steps:

- [ ] **Step 1: Scaffold class + move existing flow shader.** Create `FlowPipeline` with constructor `(device, { getQuality })`, owning: `flowModel` (move `FLOW_FS`/`FLOW_VS` and `_ensureFlowBuffers`/`_ensureCoarseBuffers`/`_runFlowPass` bodies verbatim from `satelliteComposite.ts`), per-pair record `{ key, levelTextures, finalFlowTexture, backwardFlowTexture, occlusionTexture, status }`. Export `interface FlowResult { flowTexture: Texture; occlusionTexture: Texture | null; confidence: number; }`.
- [ ] **Step 2: Pyramid loop.** Replace the fixed coarse+refine with: for each level in `pyramidLevelsFor(...)` ascending, run LK pass seeded by upsampled previous level (`uInitialFlowTex` already supports this — bind previous level's texture). Texel size per level. Keep `MAX_FLOW_UV` encode.
- [ ] **Step 3: Smoothing pass.** New fragment shader `SMOOTH_FS` (3×3 confidence-weighted vector median approximation: average of taps whose confidence > 0.15, weighted by confidence; output keeps `.b` confidence as max of taps × 0.95). Run once after each level into the scratch FBO, swap.

```glsl
// SMOOTH_FS core
vec2 sum = vec2(0.0); float wsum = 0.0; float cmax = 0.0;
for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
  vec4 t = texture(uFlowTex, vUv + vec2(float(x), float(y)) * uTexelSize);
  float c = t.b; if (c < 0.15) continue;
  vec2 f = (t.rg - 0.5) * (uFlowEncodeScale * 2.0);
  sum += f * c; wsum += c; cmax = max(cmax, c);
}
vec2 smoothed = wsum > 1e-4 ? sum / wsum : vec2(0.0);
fragColor = vec4(smoothed / (uFlowEncodeScale * 2.0) + 0.5, cmax * 0.95, 1.0);
```

- [ ] **Step 4: Forward-backward consistency.** At the finest level only, also compute backward flow (swap prev/next bindings). New `CONSISTENCY_FS`: sample forward flow `f` at uv, backward flow `b` at `uv + f`; occlusion = `length(f + b) > max(0.01, 0.3 * length(f))` → write mask texture (r = occlusion 0/1 smoothstepped, g = min confidence).
- [ ] **Step 5: Background composite + cloud mask.** New `BACKGROUND_FS` accumulation: running per-pixel composite over buffered frames — visible products: `min(background, frame)` with slow decay toward current (`mix(bg, min(bg, frame), 0.7)` per new frame); IR products: exponential-decay median approximation (`bg += sign(frame - bg) * min(abs(frame - bg), uStep)`). `CLOUDMASK_FS`: `cloudAlpha = smoothstep(uLo, uHi, luma(frame) - luma(bg))` with hysteresis via previous mask tap (`max(raw, prevMask * 0.6)`). Product type passed as uniform (`uBackgroundMode: 0 visible / 1 ir`), chosen by `isVisibleSatelliteMotionSource(layerId)`.
- [ ] **Step 6: Idle scheduler.** `schedule(pairs: PairRequest[], playheadMs)`: sort by `timeMs >= playheadMs` first then distance; process **one pyramid level per call**; public `pump()` invoked from layer's `draw()` (cheap when queue empty) and from `requestIdleCallback` fallback `setTimeout(0)`. Status per pair: `pending → level-N → consistency → ready | failed`. `isReady(pairKey)`, `get(pairKey): FlowResult | null`, `prune(keepKeys: Set<string>)`.
- [ ] **Step 7: Unit tests** (no GPU): shader sources compile-sanity (string contains `#version 300 es`, no `smoothstep(` with reversed constant edges — regex check mirroring existing test style in `satelliteComposite.test.ts`); scheduler ordering test with a fake device (inject `runPass` spy): pairs ahead of playhead processed first, one level per pump.
- [ ] **Step 8: Run tests, verify pass.**
- [ ] **Step 9: Commit** — `git commit -am "feat(web): pyramid flow pipeline with smoothing, FB consistency, cloud/background separation"`

### Task 8: Rewire SatelliteCompositeLayer onto FrameStore + FlowPipeline

**Files:**
- Create: `apps/web/src/layers/renderers/satellite/frameStoreFactory.ts` (production `fetchFrame` using device + `wmsRequest.ts`)
- Modify: `apps/web/src/layers/renderers/satelliteComposite.ts` (major surgery)
- Modify: `apps/web/src/components/MapView.tsx` (wire `onSatelliteBufferedRanges`)
- Modify: `apps/web/src/App.tsx` (pass `getBufferedRanges` to `useAnimationTimeline`)
- Test: `apps/web/src/layers/renderers/satelliteComposite.test.ts` (update), existing tests must stay green or be updated to new APIs

- [ ] **Step 1: Replace `SatEntry` internals.** Each entry holds `frameStore: FrameStore` + satellite config. Delete: `_maintainPreloadQueue`, `_fetchFrame`, `_cleanupEntryBuffers`, `inFlight`, `failedUrls`, `bufferFetchMercBounds`, `PRELOAD_*`, `MAX_RETAINED_FRAMES`, `MAX_IN_FLIGHT_FRAMES_PER_SATELLITE` constants (now in framePlan.ts).
- [ ] **Step 2: Pure time-indexed pair selection.** `draw()` calls `entry.frameStore.update({viewBounds, playheadMs: timelineMs, loopStartMs, loopEndMs, texSize})` then `framesAt(timelineMs)`. Delete `selectDrawPair`, `selectBestPairFromGroups`, `selectPairFromSequence`, `activeDrawPair`, `_selectStableDrawPair`, `shouldSwitchSatelliteDrawPair`, `activePairKey` machinery, and their dedicated tests; keep `groupFramesBySpatialSequence` only if `framesAt` grid-fallback needs it (it should not — delete).
- [ ] **Step 3: Zoom-band crossfade.** Layer keeps `previousGridPair` when `framesAt` switches gridKey; uniform `uSequenceFade` ramps 0→1 over 150 ms (`performance.now()` based); shader mixes old/new composite color. Add uniforms `uFadePrevTex*` reusing existing slot pattern only for the transition window (acceptable: render previous pair's prev texture statically during fade).
- [ ] **Step 4: Flow wiring.** Pairs for the buffered window: `selectFlowPairCandidates` over `frameStore` frames (function kept, input adapted) → `flowPipeline.schedule(pairs, timelineMs)`; bind `flowPipeline.get(pairKey)` results: flow texture, occlusion texture, background texture, cloud-mask texture. Extend `FS` morph shader: sample cloud mask + background; final per-satellite texel = `mix(backgroundTexel, morphedCloudTexel, cloudAlpha)`; occluded pixels (`occlusion > 0.5`) use the existing smoothstep crossfade branch.
- [ ] **Step 5: Worker motion sampling.** Move `createMotionSample` + `estimateGlobalFlow` invocation into `apps/web/src/layers/renderers/satellite/motionSample.worker.ts` (Vite `new Worker(new URL(...), { type: "module" })`); `frameStoreFactory.fetchFrame` posts the decoded `ImageBitmap` (transfer) and stores the resolved global flow on the frame record asynchronously; flow pipeline uses it as seed when present, zero-seed otherwise (never blocks).
- [ ] **Step 6: Public API.** Layer gains `getBufferedRanges(): BufferedRange[]` (intersection-merge across entries: a time is buffered iff buffered in every active entry — implement as range intersection, unit-test it in `satelliteComposite.test.ts`), `whenTimeBuffered(ms)` (Promise.all over entries). MapView calls `onSatelliteBufferedRanges` after each loading-state change; App stores in ref, passes `getBufferedRanges` to `useAnimationTimeline`, passes ranges + `isBuffering` to `BottomTimeline`.
- [ ] **Step 7: Update tests.** Rewrite `satelliteComposite.test.ts` cases that exercised deleted selectors to target `framesAt` + range intersection; keep shader-source tests; run full suite: `npx vitest run`. All green.
- [ ] **Step 8: Manual smoke via dev server** (use `verify`/playwright): load app, enable GOES layer, play 2× for 60 s — no freeze; pan during playback — no blank; zoom in past native — motion present but no fine-scale shimmer; lakes stationary.
- [ ] **Step 9: Commit** — `git commit -am "feat(web): rewire satellite compositor onto FrameStore + FlowPipeline, delete pair-switch deadlock"`

## Phase 4 — Export

### Task 9: Render-callback capture + readiness (fix broken GIF)

**Files:**
- Create: `apps/web/src/lib/export/captureController.ts`
- Modify: `apps/web/src/lib/gifExport.ts` (use controller; delete blind sleep)
- Modify: `apps/web/src/App.tsx` (`handleGifExport`: await readiness, drive `setTimelineSample`)
- Test: `apps/web/src/lib/export/captureController.test.ts`

- [ ] **Step 1: Write failing tests** for the controller's sequencing (fake map object):

```ts
import { describe, expect, it, vi } from "vitest";
import { CaptureController } from "./captureController";

function fakeMap() {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    once: (ev: string, cb: () => void) => { (handlers[ev] ??= []).push(cb); },
    triggerRepaint: vi.fn(),
    fire: (ev: string) => { (handlers[ev] ?? []).splice(0).forEach((cb) => cb()); },
    getCanvas: () => ({ width: 8, height: 8 }),
  };
}

describe("CaptureController", () => {
  it("resolves capture only after render fires post-readiness", async () => {
    const map = fakeMap();
    const readPixels = vi.fn(() => new ImageData(8, 8));
    const ctrl = new CaptureController({ map: map as never, readPixels });
    const whenReady = vi.fn(async () => {});
    const p = ctrl.captureFrame({ timelineMs: 0, whenReady });
    await Promise.resolve();
    expect(whenReady).toHaveBeenCalled();
    map.fire("render");
    const frame = await p;
    expect(readPixels).toHaveBeenCalledTimes(1);
    expect(frame.width).toBe(8);
  });

  it("rejects on per-frame timeout", async () => {
    const map = fakeMap();
    const ctrl = new CaptureController({
      map: map as never, readPixels: () => new ImageData(8, 8), frameTimeoutMs: 10,
    });
    await expect(ctrl.captureFrame({ timelineMs: 0, whenReady: () => new Promise(() => {}) }))
      .rejects.toThrow(/timeout/i);
  });
});
```

- [ ] **Step 2: Run to verify fail.**
- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/export/captureController.ts
/** Captures pixel-correct frames by reading the WebGL canvases inside
 * MapLibre's render event, after the requested timeline state is buffered. */
export interface CaptureRequest {
  timelineMs: number;
  /** Resolves when all layers report the requested time fully renderable
   * (frameStore.whenTimeBuffered + any layer-specific readiness). */
  whenReady: () => Promise<void>;
}

export class CaptureController {
  constructor(private opts: {
    map: { once(ev: "render", cb: () => void): void; triggerRepaint(): void };
    readPixels: () => ImageData;       // composite read, injected (Task 10 supplies real impl)
    frameTimeoutMs?: number;           // default 15_000
  }) {}

  async captureFrame(req: CaptureRequest): Promise<ImageData> {
    const timeout = this.opts.frameTimeoutMs ?? 15_000;
    return await Promise.race([
      (async () => {
        await req.whenReady();
        return await new Promise<ImageData>((resolve) => {
          this.opts.map.once("render", () => resolve(this.opts.readPixels()));
          this.opts.map.triggerRepaint();
        });
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Frame capture timeout after ${timeout} ms`)), timeout)),
    ]);
  }
}
```

  Real `readPixels` (in App wiring): existing `captureComposite` from gifExport.ts reused — called synchronously inside the render callback, which is the fix (WebGL back buffer still valid). `whenReady` per frame = `satelliteLayer.whenTimeBuffered(ms)` + `map.once("idle")` race-with-already-idle. `handleGifExport`'s `onRequestFrame` becomes: `satelliteProgressRef.current(subProgress, timelineMs)` + `setFrame(...)`, then controller captures. Delete `renderDelayMs` machinery.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Manual check:** export 10-frame GIF with satellite layer on — frames non-blank, clouds morph between satellite keyframes.
- [ ] **Step 6: Commit** — `git commit -am "fix(web): capture export frames in render callback with real readiness signal"`

### Task 10: FrameSink interface + GIF quality (dither, global palette, 15 fps)

**Files:**
- Create: `apps/web/src/lib/export/frameSink.ts`
- Create: `apps/web/src/lib/export/gifSink.ts`
- Modify: `apps/web/src/lib/gifExport.ts` → thin orchestrator `apps/web/src/lib/export/exportAnimation.ts` (move; keep `gifExport.ts` re-exporting for compat)
- Test: `apps/web/src/lib/export/gifSink.test.ts`

- [ ] **Step 1: Define interface**

```ts
// apps/web/src/lib/export/frameSink.ts
export interface FrameSinkInit {
  width: number; height: number; fps: number;
}
export interface FrameSink {
  init(opts: FrameSinkInit): Promise<void>;
  addFrame(frame: ImageData, timestampMs: number): Promise<void>;
  finish(): Promise<{ blob: Blob; extension: string }>;
  cancel(): void;
}
```

- [ ] **Step 2: Write failing tests** for `GifSink`: encodes 3 solid-color 8×8 frames at fps 10 → blob type `image/gif`, non-zero size; global-palette mode produces identical first bytes for identical palettes across frames (encode twice, compare frame palette chunk presence — assert option plumbed by spying on `quantize` call count: global mode quantizes once, per-frame mode 3×).
- [ ] **Step 3: Implement `GifSink`**: options `{ dither: boolean; palette: "global" | "per-frame" }`. Global mode: buffer all frames in `init`-declared dimensions, on `finish()` sample up to 8 frames evenly, build one palette via `quantize(concatSamples, 256)`, then `applyPalette` each frame; dither via gifenc's `applyPalette(data, palette, "FloydSteinberg")` format arg (check `gifenc.d.ts`, extend the declaration file if the signature lacks the dither/format parameter — actual gifenc supports `applyPalette(data, palette, format)`; for dithering use `nearestColorIndexWithDistance` fallback: implement simple FS dither over RGB in a helper before `applyPalette` if gifenc lacks it — write the helper, ~25 lines, error-diffuse to next row buffer). Delay per frame = `Math.round(100 / fps)` centiseconds.
- [ ] **Step 4: Move loop from `exportGif` into `exportAnimation({ sink, frames: AsyncIterable<ImageData>, ... })`** — orchestrator awaits `captureController.captureFrame` per output timestamp (`startMs → endMs` step `1000/fps` scaled by chosen time compression — UI supplies `timelapseSpeed`), feeds sink, reports progress, supports `AbortSignal` cancel.
- [ ] **Step 5: Run tests, verify pass.**
- [ ] **Step 6: Commit** — `git commit -am "feat(web): FrameSink abstraction + dithered/global-palette GIF encoder"`

### Task 11: WebM/MP4 sinks via WebCodecs

**Files:**
- Create: `apps/web/src/lib/export/videoSink.ts`
- Test: `apps/web/src/lib/export/videoSink.test.ts`
- Modify: `apps/web/package.json` (add deps)

- [ ] **Step 1: Install** — from `apps/web`: `npm i mp4-muxer webm-muxer`.
- [ ] **Step 2: Write failing tests** (mock `VideoEncoder` global): `VideoSink` with format "webm" configures codec `vp09.00.10.08`; "mp4" configures `avc1.42001f`; addFrame creates `VideoFrame` from ImageData with microsecond timestamp `ts*1000`; finish flushes encoder then finalizes muxer; `isWebCodecsSupported()` false when global missing.
- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/export/videoSink.ts — core shape
import { Muxer as Mp4Muxer, ArrayBufferTarget as Mp4Target } from "mp4-muxer";
import { Muxer as WebmMuxer, ArrayBufferTarget as WebmTarget } from "webm-muxer";
import type { FrameSink, FrameSinkInit } from "./frameSink";

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export class VideoSink implements FrameSink {
  constructor(private format: "webm" | "mp4", private bitrate = 8_000_000) {}
  // init: create muxer (codec "V_VP9" / "avc"), VideoEncoder with
  //   output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
  //   config { codec, width, height, bitrate, framerate: fps }.
  //   Even dimensions required for H.264: round width/height down to even.
  // addFrame: new VideoFrame(await createImageBitmap(imageData), { timestamp: tsMs * 1000 });
  //   encoder.encode(frame, { keyFrame: frameIndex % 30 === 0 }); frame.close();
  //   await backpressure: if (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r));
  // finish: await encoder.flush(); muxer.finalize();
  //   return { blob: new Blob([target.buffer], { type: this.format === "mp4" ? "video/mp4" : "video/webm" }), extension: this.format };
  // cancel: encoder.close().
}
```

  Write the full bodies per the comments (they are exact). `MediaRecorder` fallback explicitly **not** implemented as a sink — when `!isWebCodecsSupported()`, UI disables video formats with a tooltip (simpler + honest; MediaRecorder can't do frame-accurate timestamps). This amends the spec's fallback line — note it in the commit message.
- [ ] **Step 4: Run tests, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "feat(web): WebM/VP9 and MP4/H.264 export sinks via WebCodecs"`

### Task 12: ExportPanel UI (area select, formats, presets, size estimate, cancel)

**Files:**
- Rename/rework: `apps/web/src/components/workbench/GifExportPanel.tsx` → `apps/web/src/components/workbench/ExportPanel.tsx`
- Modify: `apps/web/src/App.tsx` (export flow → exportAnimation + sink choice + area crop)
- Modify: `apps/web/src/components/MapView.tsx` (area-select overlay mode emitting crop rect in canvas px)
- Modify: `apps/web/src/workbench.css`
- Test: `apps/web/src/components/workbench/workbenchPanels.test.tsx`

- [ ] **Step 1: Write failing tests:** ExportPanel renders format radio (GIF/WebM/MP4), fps select (5/10/15/30 — 30 disabled for GIF), resolution select (480p/720p/full), shows estimated size text (assert recompute when fps changes), Cancel button visible while `progress` prop non-null and fires `onCancel`.
- [ ] **Step 2: Implement panel.** Controlled props: `{ value: ExportConfig, onChange, onStart, onCancel, progress, areaSelected }`. Size estimate: `width*height*fps*durationSec*bytesPerPx` with `bytesPerPx` 0.35 GIF / 0.08 WebM / 0.10 MP4 → human string. "Select area" button toggles MapView's area-select mode (semi-transparent overlay div, pointer drag → rect, Escape cancels; emit `{x,y,width,height}` in canvas device pixels via `getBoundingClientRect` scaling — reuse pattern from existing crop support in `gifExport.ts` `crop` option).
- [ ] **Step 3: App wiring.** `handleExport(config)`: build sink (`GifSink` | `VideoSink`), `exportAnimation` with `AbortController` stored in ref for cancel; on finish `downloadGif`-style anchor (rename helper `downloadBlob(blob, filename, extension)` in `exportAnimation.ts`); filename `canwxlab-<area?>-<start>-<end>.<ext>`.
- [ ] **Step 4: Run component tests + full suite** — `npx vitest run`. All green.
- [ ] **Step 5: Manual verify (playwright):** select area, export 5 s WebM @10 fps — file downloads, plays, clouds morph smoothly, only selected area present.
- [ ] **Step 6: Commit** — `git commit -am "feat(web): export panel with area selection, GIF/WebM/MP4, presets, size estimate, cancel"`

## Final

- [ ] Run `npx vitest run` (all), `npx tsc --noEmit`, lint if configured.
- [ ] Manual end-to-end: 2× playback 5 min no freeze; pan/zoom during playback; export each format.
- [ ] Update `docs/superpowers/specs/2026-06-09-satellite-flow-overhaul-design.md` status → Implemented (note MediaRecorder-fallback amendment).
- [ ] Commit any doc updates; consider `superpowers:finishing-a-development-branch`.
