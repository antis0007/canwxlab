import { describe, expect, it } from "vitest";

import {
  clampTimelineFrame,
  FORECAST_FRAME,
  LIVE_FRAME,
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
});
