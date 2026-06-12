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

/** The snapped quad spans 3 grid cells per axis, anchored to the cell that
 * contains the viewport center. Because the band guarantees the viewport is
 * no wider than 2 cells, a 3-cell quad always covers the viewport, and pans
 * that keep the center inside the same cell return identical bounds. */
const CELLS_PER_QUAD = 3;

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
  const pad = (CELLS_PER_QUAD - 1) / 2;
  return [
    snapX - pad * cell,
    snapY - pad * cell,
    snapX + (1 + pad) * cell,
    snapY + (1 + pad) * cell,
  ];
}

export function mergeBufferedRanges(
  frameTimesMs: number[],
  frameIntervalMs: number,
): BufferedRange[] {
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

/** Clamp a playhead time into buffered coverage.
 *
 * `presentationLagMs` implements a streaming jitter buffer: playback presents
 * that far behind each range's true end, so the renderer always has a
 * complete frame pair to morph through (phase sweeps 0→1) instead of sitting
 * pinned on the newest frame and stepping when the next one arrives. */
export function clampPlayheadToBuffered(
  timeMs: number,
  ranges: BufferedRange[],
  presentationLagMs = 0,
): number {
  if (ranges.length === 0) return timeMs;
  const effectiveEnd = (range: BufferedRange) =>
    Math.max(range.startMs, range.endMs - presentationLagMs);
  for (const range of ranges) {
    if (timeMs >= range.startMs && timeMs <= effectiveEnd(range)) return timeMs;
  }
  let best: number | null = null;
  for (const range of ranges) {
    const end = effectiveEnd(range);
    if (end <= timeMs && (best === null || end > best)) best = end;
  }
  if (best !== null) return best;
  return ranges[0].startMs;
}
