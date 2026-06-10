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

/** Wanted fetch times ordered outward from the playhead, biased two ahead per
 * one behind, clamped to the loop window and the 3 h buffer span. */
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
