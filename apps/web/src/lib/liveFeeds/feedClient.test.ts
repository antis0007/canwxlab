import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FeedClient,
  bboxMovedBeyond,
  nextBackoffMs,
  type FeedDefinition,
  type FeedStatus,
  type LonLatBounds,
} from "./feedClient";

const definition: FeedDefinition<number> = {
  id: "test",
  intervalMs: 1000,
  url: (bbox) => (bbox ? `https://x/feed?bbox=${bbox.join(",")}` : "https://x/feed"),
  parse: (body) => body as number[],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FeedClient", () => {
  it("polls at the base cadence while healthy and reports live status", async () => {
    const fetchJson = vi.fn(async () => [1, 2, 3]);
    const statuses: FeedStatus[] = [];
    const client = new FeedClient(definition, (_e, s) => statuses.push(s), fetchJson);

    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getEvents()).toEqual([1, 2, 3]);
    expect(statuses[0].state).toBe("live");

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    client.stop();
  });

  it("backs off with jitter on failure and recovers to live", async () => {
    let fail = true;
    const fetchJson = vi.fn(async () => {
      if (fail) throw new Error("boom");
      return [7];
    });
    const statuses: FeedStatus[] = [];
    const client = new FeedClient(definition, (_e, s) => statuses.push(s), fetchJson);

    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses[0].state).toBe("degraded");

    // Three consecutive failures → down.
    await vi.advanceTimersByTimeAsync(BACKOFF_DRAIN_MS);
    await vi.advanceTimersByTimeAsync(BACKOFF_DRAIN_MS);
    expect(statuses.some((s) => s.state === "down")).toBe(true);

    fail = false;
    await vi.advanceTimersByTimeAsync(BACKOFF_DRAIN_MS);
    expect(statuses[statuses.length - 1].state).toBe("live");
    expect(client.getEvents()).toEqual([7]);
    client.stop();
  });

  it("re-fetches immediately when the bbox moves beyond the threshold", async () => {
    const fetchJson = vi.fn(async (_url: string, _signal: AbortSignal): Promise<unknown> => []);
    const client = new FeedClient(definition, () => undefined, fetchJson);
    client.setBbox([-10, -10, 10, 10]);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // Small pan: no extra fetch.
    client.setBbox([-9, -10, 11, 10]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJson).toHaveBeenCalledTimes(1);

    // Big jump: immediate fetch with the new bbox.
    client.setBbox([50, 30, 70, 50]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(String(fetchJson.mock.calls[1][0])).toContain("50,30,70,50");
    client.stop();
  });

  it("stop aborts in-flight work and prevents further polls", async () => {
    let aborted = false;
    const fetchJson = vi.fn((_url: string, signal: AbortSignal) =>
      new Promise<unknown>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      }));
    const client = new FeedClient(definition, () => undefined, fetchJson);
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });
});

// Worst-case drain: cap is 5 min; advancing past it always fires the timer.
const BACKOFF_DRAIN_MS = 5 * 60 * 1000 + 1;

describe("nextBackoffMs", () => {
  it("stays within [base, cap] and grows from the previous delay", () => {
    const base = 1000;
    let prev = base;
    for (let i = 0; i < 10; i += 1) {
      const next = nextBackoffMs(base, prev, () => 1);
      expect(next).toBeGreaterThanOrEqual(base);
      expect(next).toBeLessThanOrEqual(5 * 60 * 1000);
      prev = next;
    }
    expect(prev).toBe(5 * 60 * 1000);
  });
});

describe("bboxMovedBeyond", () => {
  const start: LonLatBounds = [-10, -10, 10, 10];
  it("ignores small pans, catches big jumps and zoom changes", () => {
    expect(bboxMovedBeyond(start, [-9, -9, 11, 11], 1 / 3)).toBe(false);
    expect(bboxMovedBeyond(start, [40, -10, 60, 10], 1 / 3)).toBe(true);
    expect(bboxMovedBeyond(start, [-40, -40, 40, 40], 1 / 3)).toBe(true); // zoom out
  });
});
