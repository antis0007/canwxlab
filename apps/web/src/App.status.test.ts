import { describe, expect, it } from "vitest";

import { statusMessage } from "./App";
import type { SourceStatusResponse } from "./types/weather";

const sourceReport: SourceStatusResponse = {
  data_mode: "hybrid",
  live_eccc_enabled: false,
  sources: []
};

describe("app status messaging", () => {
  it("renders empty-state notices for disabled live data and empty map results", () => {
    const notices = statusMessage(sourceReport, [], [], true, false);
    expect(notices).toContain("Live ECCC data disabled");
    expect(notices).toContain("No alerts returned for this view");
    expect(notices).toContain("No station observations returned for this view");
    expect(notices).toContain("Globe mode requires a MapLibre version with globe projection support.");
  });
});
