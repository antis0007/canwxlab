import { describe, expect, it } from "vitest";

import { __internal, filterEntries, loadStarCatalog, normalizeEntry } from "./starCatalogLoader";
import type { StarCatalogAsset, StarCatalogEntry } from "./starCatalogTypes";

const sampleAsset: StarCatalogAsset = {
  name: "test-asset",
  version: "0.1.0",
  epoch: "J2000.0",
  frame: "icrs",
  generatedAt: "2026-01-01T00:00:00Z",
  dataClass: "seed",
  source: "canwxlab-curated",
  license: "Test only.",
  stars: [
    {
      id: "test.sirius",
      properName: "Sirius",
      raDeg: 101.287,
      decDeg: -16.716,
      apparentMag: -1.46,
      distanceLy: 8.6,
      source: "canwxlab-curated",
      dataClass: "seed",
    },
    {
      id: "test.deneb",
      properName: "Deneb",
      raDeg: 310.358,
      decDeg: 45.28,
      apparentMag: 1.25,
      distanceLy: 2615,
      source: "canwxlab-curated",
      dataClass: "seed",
    },
    {
      id: "test.dim",
      properName: "Dim",
      raDeg: 10,
      decDeg: 10,
      apparentMag: 6.5,
      distanceLy: 100,
      source: "canwxlab-curated",
      dataClass: "seed",
    },
  ],
};

describe("normalizeEntry", () => {
  it("accepts a well-formed entry and keeps source/dataClass", () => {
    const entry = normalizeEntry(sampleAsset.stars[0]);
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe("test.sirius");
    expect(entry!.dataClass).toBe("seed");
  });

  it("rejects entries missing required astrometric fields", () => {
    expect(normalizeEntry({ id: "x", raDeg: 0 })).toBeNull();
    expect(normalizeEntry({ id: "x", raDeg: 0, decDeg: 0 })).toBeNull();
    expect(normalizeEntry({ raDeg: 0, decDeg: 0, apparentMag: 1 })).toBeNull();
  });

  it("rejects out-of-range coordinates", () => {
    expect(normalizeEntry({ id: "x", raDeg: -10, decDeg: 0, apparentMag: 1 })).toBeNull();
    expect(normalizeEntry({ id: "x", raDeg: 0, decDeg: 95, apparentMag: 1 })).toBeNull();
  });

  it("defaults source and dataClass when absent", () => {
    const entry = normalizeEntry({ id: "x", raDeg: 0, decDeg: 0, apparentMag: 0 });
    expect(entry?.source).toBe("asset");
    expect(entry?.dataClass).toBe("catalog");
  });
});

describe("filterEntries", () => {
  const stars: StarCatalogEntry[] = sampleAsset.stars.map((s) => normalizeEntry(s)!).filter(Boolean);

  it("drops stars beyond the distance cap", () => {
    const out = filterEntries(stars, { maxDistanceLy: 100 });
    expect(out.map((s) => s.id)).toEqual(["test.sirius", "test.dim"]);
  });

  it("drops stars dimmer than the magnitude cap", () => {
    const out = filterEntries(stars, { apparentMagMax: 2 });
    expect(out.find((s) => s.id === "test.dim")).toBeUndefined();
  });

  it("sorts by brightness and respects the limit", () => {
    const out = filterEntries(stars, { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0].apparentMag).toBeLessThanOrEqual(out[1].apparentMag);
  });
});

describe("loadStarCatalog", () => {
  it("returns asset rows and meta on success", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => sampleAsset,
    });

    const result = await loadStarCatalog({
      assetUrl: "/test.json",
      fetchImpl,
    });

    expect(result.source).toBe("asset");
    expect(result.meta.name).toBe("test-asset");
    expect(result.stars.length).toBe(3);
    expect(result.warning).toBeUndefined();
  });

  it("falls back to embedded seed when the asset is unreachable", async () => {
    const fetchImpl = async () => {
      throw new Error("network down");
    };

    const result = await loadStarCatalog({
      assetUrl: "/missing.json",
      fetchImpl,
    });

    expect(result.source).toBe("embedded");
    expect(result.stars.length).toBeGreaterThan(0);
    expect(result.warning).toMatch(/embedded/i);
  });

  it("falls back when payload is malformed", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ wrong: true }),
    });

    const result = await loadStarCatalog({
      assetUrl: "/bad.json",
      fetchImpl,
    });

    expect(result.source).toBe("embedded");
    expect(result.warning).toMatch(/embedded/i);
  });

  it("applies filters during load", async () => {
    const fetchImpl = async () => ({
      ok: true,
      json: async () => sampleAsset,
    });

    const result = await loadStarCatalog({
      assetUrl: "/test.json",
      fetchImpl,
      apparentMagMax: 1.5,
    });

    expect(result.stars.every((s) => s.apparentMag <= 1.5)).toBe(true);
  });

  it("exposes embedded fallback through internal export", () => {
    expect(__internal.EMBEDDED_FALLBACK.length).toBeGreaterThan(0);
    expect(__internal.EMBEDDED_META.name).toContain("embedded");
  });
});
