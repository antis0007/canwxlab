import { describe, expect, it } from "vitest";

import { statusMessage } from "./App";
import type { SourceStatusResponse } from "./types/weather";

const sourceReportDisabled: SourceStatusResponse = {
  data_mode: "hybrid",
  live_eccc_enabled: false,
  sources: [],
};

const sourceReportEnabled: SourceStatusResponse = {
  data_mode: "live",
  live_eccc_enabled: true,
  sources: [{ source_id: "eccc_geomet_ogc_api", status: "fallback" } as any],
};

describe("app status messaging", () => {
  it("does not surface a disabled-live notice (handled elsewhere now)", () => {
    // The live_eccc_enabled flag is reflected in the source badge / WMS
    // diagnostics rather than as a banner notice.
    const notices = statusMessage(sourceReportDisabled, false, false);
    expect(notices).not.toContain("Live ECCC data disabled");
  });

  it("shows fallback notice when source is unavailable", () => {
    const notices = statusMessage(sourceReportEnabled, false, true);
    expect(notices).toContain("Live source unavailable - showing fallback sources only");
  });

  it("shows globe notice when globe is checked but not supported", () => {
    const notices = statusMessage(sourceReportDisabled, true, false);
    expect(notices).toContain("Globe projection not supported by this MapLibre build");
  });

  it("returns empty when all systems nominal", () => {
    const nominalReport: SourceStatusResponse = {
      data_mode: "live",
      live_eccc_enabled: true,
      sources: [{ source_id: "eccc_geomet_ogc_api", status: "live" } as any],
    };
    const notices = statusMessage(nominalReport, true, true);
    expect(notices).toHaveLength(0);
  });
});
