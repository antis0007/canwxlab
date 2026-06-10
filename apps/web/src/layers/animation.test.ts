import { describe, expect, it } from "vitest";

import {
  advancePlayheadForTesting,
  clampTimelineFrame,
  FORECAST_FRAME,
  LIVE_FRAME,
  maxPlayableFrame,
  shouldCommitPlaybackStateForTesting,
  timelineFrameCountForDays,
  timelineModeFor,
} from "./animation";

describe("planetary timeline semantics", () => {
  it("classifies live, replay, and forecast timeline states", () => {
    expect(timelineModeFor({
      isTrackingLive: true,
      forecastEnabled: false,
      selectedTimeMs: 1000,
      liveTimeMs: 1000,
    })).toBe("live");

    expect(timelineModeFor({
      isTrackingLive: false,
      forecastEnabled: false,
      selectedTimeMs: 500,
      liveTimeMs: 1000,
    })).toBe("replay");

    expect(timelineModeFor({
      isTrackingLive: false,
      forecastEnabled: true,
      selectedTimeMs: 10 * 60 * 1000,
      liveTimeMs: 1000,
    })).toBe("forecast");
  });

  it("clamps future frames unless forecast is enabled", () => {
    expect(clampTimelineFrame(FORECAST_FRAME, false)).toBe(LIVE_FRAME);
    expect(clampTimelineFrame(FORECAST_FRAME, true)).toBe(FORECAST_FRAME);
  });

  it("builds selectable 1, 2, and 3 day timeline frame counts", () => {
    expect(timelineFrameCountForDays(1)).toBe(289);
    expect(timelineFrameCountForDays(2)).toBe(577);
    expect(timelineFrameCountForDays(3)).toBe(865);
  });

  it("limits locked playback to live when live is inside the visible window", () => {
    expect(maxPlayableFrame(false, 288, 864)).toBe(288);
    expect(maxPlayableFrame(false, 900, 864)).toBe(864);
    expect(maxPlayableFrame(false, -12, 864)).toBe(0);
    expect(maxPlayableFrame(true, -12, 864)).toBe(864);
  });

  it("throttles React playback commits while preserving frame-boundary updates", () => {
    expect(shouldCommitPlaybackStateForTesting({
      timestampMs: 1040,
      lastCommitMs: 1000,
      nextFrame: 12.20,
      lastCommittedFrame: 12.10,
      minIntervalMs: 100,
    })).toBe(false);

    expect(shouldCommitPlaybackStateForTesting({
      timestampMs: 1040,
      lastCommitMs: 1000,
      nextFrame: 13.02,
      lastCommittedFrame: 12.95,
      minIntervalMs: 100,
    })).toBe(true);

    expect(shouldCommitPlaybackStateForTesting({
      timestampMs: 1101,
      lastCommitMs: 1000,
      nextFrame: 12.40,
      lastCommittedFrame: 12.10,
      minIntervalMs: 100,
    })).toBe(true);
  });
});

describe("advancePlayheadForTesting (buffered clamp)", () => {
  const MIN5 = 5 * 60 * 1000;
  const windowStartMs = 0;
  const ranges = [{ startMs: 0, endMs: 60 * MIN5 }];

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

  it("ignores the clamp when no ranges are provided", () => {
    const r = advancePlayheadForTesting({
      current: 80, deltaFrames: 1, loopStart: 0, loopEnd: 100,
      maxPlayableFrame: 100, windowStartMs, frameIntervalMs: MIN5, bufferedRanges: [],
    });
    expect(r.next).toBeCloseTo(81);
    expect(r.isBuffering).toBe(false);
  });
});
