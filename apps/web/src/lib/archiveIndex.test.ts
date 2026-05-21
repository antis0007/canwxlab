import { describe, expect, it } from "vitest";

import {
  buildArchiveAssetRecord,
  retentionForUrl,
  shouldCacheUrl,
  summarizeArchiveRecords,
} from "./archiveIndex";

describe("archive metadata index", () => {
  it("builds metadata records for successful cached responses", () => {
    const response = new Response("{}", {
      headers: {
        "content-length": "2",
        "content-type": "application/json",
      },
    });
    const record = buildArchiveAssetRecord({
      cacheName: "canwxlab-api-v1",
      url: "https://api.weather.gc.ca/example",
      response,
      expiresAt: 123,
    });

    expect(record.assetKey).toMatch(/^asset-/);
    expect(record.contentType).toBe("application/json");
    expect(record.byteLength).toBe(2);
    expect(record.retention).toBe("allowed");
  });

  it("summarizes archive records and blocks known restricted retention", () => {
    const restrictedUrl = "https://example.test/paid-weather-archive/hour";
    expect(retentionForUrl(restrictedUrl)).toBe("restricted");
    expect(shouldCacheUrl(restrictedUrl)).toBe(false);

    const summary = summarizeArchiveRecords([
      {
        assetKey: "a",
        url: "https://api.weather.gc.ca/a",
        cacheName: "api",
        contentType: "application/json",
        byteLength: 10,
        fetchedAt: "2026-05-20T00:00:00.000Z",
        expiresAt: 1,
        retention: "allowed",
      },
      {
        assetKey: "b",
        url: "https://unknown.example/b",
        cacheName: "api",
        contentType: null,
        byteLength: null,
        fetchedAt: "2026-05-20T00:01:00.000Z",
        expiresAt: 1,
        retention: "unknown",
      },
    ]);

    expect(summary.assetCount).toBe(2);
    expect(summary.allowedCount).toBe(1);
    expect(summary.unknownCount).toBe(1);
    expect(summary.lastArchivedAt).toBe("2026-05-20T00:01:00.000Z");
  });
});
