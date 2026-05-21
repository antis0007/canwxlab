import { describe, expect, it } from "vitest";

import { buildSourceContractViews } from "./planetaryCatalog";
import type { DataSource } from "../types/weather";

const ecccSource: DataSource = {
  source_id: "eccc_geomet_ogc_api",
  name: "ECCC GeoMet OGC API",
  status: "live",
  adapter: "eccc_geomet",
  last_updated: null,
  last_successful_fetch: "2026-05-20T00:00:00.000Z",
  last_attempted_fetch: null,
  retrieved_at: null,
  expires_at: null,
  attribution: "ECCC",
  description: "Official ECCC source",
  message: "OK",
  is_live: true,
  is_experimental: false,
  metadata: {},
};

describe("source contract registry", () => {
  it("merges runtime source status with static legal and cost policy", () => {
    const contracts = buildSourceContractViews([ecccSource]);
    const eccc = contracts.find((contract) => contract.id === "eccc-geomet");
    const paid = contracts.find((contract) => contract.id === "paid-weather-archive");

    expect(eccc?.runtimeStatus).toBe("live");
    expect(eccc?.cacheBeforeUse).toBe(true);
    expect(eccc?.retentionAllowed).toBe(true);
    expect(eccc?.lastSuccessfulFetch).toBe("2026-05-20T00:00:00.000Z");

    expect(paid?.requiresCostApproval).toBe(true);
    expect(paid?.retentionAllowed).toBe(false);
    expect(paid?.runtimeStatus).toBe("fallback");
  });
});
