import { describe, expect, it } from "vitest";

import { formatInZone, isValidTimeZone, utcOffsetLabel } from "./timezone";

describe("timezone helpers", () => {
  it("validates real IANA zones and rejects garbage", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("America/Toronto")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("formats a fixed instant differently in two zones", () => {
    const ms = Date.parse("2026-05-17T12:00:00Z");
    const utc = formatInZone(ms, { timeZone: "UTC", withSeconds: true });
    const tokyo = formatInZone(ms, { timeZone: "Asia/Tokyo", withSeconds: true });
    expect(utc).toBe("12:00:00");
    // Tokyo is UTC+9 year-round, so 12:00Z is 21:00 JST.
    expect(tokyo).toBe("21:00:00");
  });

  it("returns a non-empty UTC offset label for a real zone", () => {
    const label = utcOffsetLabel("Asia/Kolkata", Date.parse("2026-05-17T00:00:00Z"));
    expect(label).toContain("GMT");
    expect(label).toMatch(/\+?5/);
  });

  it("formats non-finite ms as a sentinel", () => {
    expect(formatInZone(Number.NaN, { timeZone: "UTC" })).toBe("--:--:--");
  });
});
