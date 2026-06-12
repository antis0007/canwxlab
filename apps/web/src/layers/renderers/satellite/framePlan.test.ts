import { describe, expect, it } from "vitest";

import { LOOP_BUFFER_SPAN_MS, planEviction, planPrefetch } from "./framePlan";

const MIN10 = 600_000;
const times = (n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i * MIN10);

describe("planPrefetch", () => {
  it("orders wanted times outward from the playhead, ahead-biased 2:1", () => {
    const avail = times(36);
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [],
      playheadMs: avail[18],
      loopStartMs: avail[0],
      loopEndMs: avail[35],
    });
    expect(plan[0]).toBe(avail[18]);
    expect(plan[1]).toBe(avail[19]);
    expect(plan[2]).toBe(avail[17]);
    expect(plan[3]).toBe(avail[20]);
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
    expect(plan.length).toBeGreaterThan(0);
    expect(Math.max(...plan)).toBeLessThanOrEqual(avail[10]);
  });

  it("falls back to nearest published frames when live is hours after the source", () => {
    const avail = times(12);
    const playheadMs = avail[avail.length - 1] + LOOP_BUFFER_SPAN_MS + 2 * MIN10;
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [],
      playheadMs,
      loopStartMs: playheadMs - LOOP_BUFFER_SPAN_MS / 2,
      loopEndMs: playheadMs + LOOP_BUFFER_SPAN_MS / 2,
    });

    expect(plan[0]).toBe(avail[avail.length - 1]);
    expect(plan[1]).toBe(avail[avail.length - 2]);
    expect(plan.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to nearest published frames when the selected day precedes the source window", () => {
    const avail = times(12, 24 * 60 * 60 * 1000);
    const playheadMs = avail[0] - LOOP_BUFFER_SPAN_MS - 2 * MIN10;
    const plan = planPrefetch({
      availableTimesMs: avail,
      bufferedTimesMs: [],
      playheadMs,
      loopStartMs: playheadMs - LOOP_BUFFER_SPAN_MS / 2,
      loopEndMs: playheadMs + LOOP_BUFFER_SPAN_MS / 2,
    });

    expect(plan[0]).toBe(avail[0]);
    expect(plan[1]).toBe(avail[1]);
    expect(plan.length).toBeGreaterThanOrEqual(2);
  });
});

describe("planEviction", () => {
  it("evicts frames over budget, farthest from playhead first", () => {
    const all = times(50);
    const frames = all.map((timeMs) => ({ timeMs, protected: false }));
    const evict = planEviction(frames, all[25], 40);
    expect(evict.length).toBe(10);
    expect(evict).toContain(0);
    expect(evict).not.toContain(all[25]);
  });

  it("never evicts protected frames", () => {
    const all = times(50);
    const frames = all.map((timeMs, i) => ({ timeMs, protected: i === 0 }));
    const evict = planEviction(frames, all[49], 40);
    expect(evict).not.toContain(0);
  });

  it("returns empty when under budget", () => {
    const frames = times(5).map((timeMs) => ({ timeMs, protected: false }));
    expect(planEviction(frames, 0, 40)).toEqual([]);
  });
});
