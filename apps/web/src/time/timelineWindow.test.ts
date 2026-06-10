import { describe, expect, it } from "vitest";

import {
  clampTimelineFrame,
  frameFromTimelinePct,
  maxPlayableFrame,
  timelineFrameCountForDays,
  timelinePctFromFrame,
} from "./timelineWindow";

describe("timeline window math", () => {
  it("keeps selectable day windows on 5 minute frame boundaries", () => {
    expect(timelineFrameCountForDays(1)).toBe(289);
    expect(timelineFrameCountForDays(2)).toBe(577);
    expect(timelineFrameCountForDays(3)).toBe(865);
  });

  it("maps between visual percent and frame space using the displayed span", () => {
    expect(frameFromTimelinePct(100, 865)).toBe(864);
    expect(timelinePctFromFrame(288, 865)).toBeCloseTo(33.3333, 4);
  });

  it("separates visual span from forecast-locked playable span", () => {
    expect(maxPlayableFrame(false, 288, 864)).toBe(288);
    expect(maxPlayableFrame(true, 288, 864)).toBe(864);
    expect(clampTimelineFrame(864, false, 288, 864)).toBe(288);
  });
});
