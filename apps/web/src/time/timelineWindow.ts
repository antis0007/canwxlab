export type TimelineViewDays = 1 | 2 | 3;

export const FRAME_INTERVAL_MS = 5 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TIMELINE_VIEW_DAY_OPTIONS = [1, 2, 3] as const satisfies readonly TimelineViewDays[];
export const DEFAULT_TIMELINE_VIEW_DAYS: TimelineViewDays = 1;

// Legacy public constants retained for callers/tests that still reason in
// "1 day replay + 2 days forecast" terms.
export const REPLAY_WINDOW_MS = DAY_MS;
export const FORECAST_WINDOW_MS = 2 * DAY_MS;
export const LIVE_FRAME = REPLAY_WINDOW_MS / FRAME_INTERVAL_MS;
export const FORECAST_FRAME = (REPLAY_WINDOW_MS + FORECAST_WINDOW_MS) / FRAME_INTERVAL_MS;

export function coerceTimelineViewDays(value: number): TimelineViewDays {
  if (value === 2) return 2;
  if (value === 3) return 3;
  return 1;
}

export function timelineDurationMsForDays(days: TimelineViewDays): number {
  return coerceTimelineViewDays(days) * DAY_MS;
}

export function timelineFrameCountForDays(days: TimelineViewDays): number {
  return timelineDurationMsForDays(days) / FRAME_INTERVAL_MS + 1;
}

export function maxPlayableFrame(
  forecastEnabled: boolean,
  liveFrame = LIVE_FRAME,
  displayEndFrame = FORECAST_FRAME,
): number {
  const endFrame = Number.isFinite(displayEndFrame) ? Math.max(0, displayEndFrame) : LIVE_FRAME;
  if (forecastEnabled) return endFrame;
  const liveLimit = Number.isFinite(liveFrame) ? Math.floor(liveFrame) : LIVE_FRAME;
  return Math.max(0, Math.min(endFrame, liveLimit));
}

export function clampTimelineFrame(
  frame: number,
  forecastEnabled: boolean,
  liveFrame = LIVE_FRAME,
  displayEndFrame = FORECAST_FRAME,
): number {
  const maxFrame = maxPlayableFrame(forecastEnabled, liveFrame, displayEndFrame);
  if (!Number.isFinite(frame)) return maxFrame;
  return Math.max(0, Math.min(maxFrame, frame));
}

export function frameFromTimelinePct(pct: number, frameCount: number): number {
  const maxFrame = Math.max(0, frameCount - 1);
  if (!Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(maxFrame, (pct / 100) * maxFrame));
}

export function timelinePctFromFrame(frame: number, frameCount: number): number {
  const maxFrame = Math.max(1, frameCount - 1);
  if (!Number.isFinite(frame)) return 0;
  return (Math.max(0, Math.min(maxFrame, frame)) / maxFrame) * 100;
}
