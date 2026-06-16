import { describe, expect, it } from "vitest";

import { interpManifestUrl, parseInterpManifest, resolveFrameUrl } from "./interpFrames";

describe("interpManifestUrl", () => {
  it("builds a manifest URL with bbox, ISO times, size and depth", () => {
    const url = interpManifestUrl({
      layerId: "eccc_goes_east_cloud_type",
      mercBounds: [-1, -2, 3, 4],
      t0Ms: Date.UTC(2026, 5, 14, 0, 0, 0),
      t1Ms: Date.UTC(2026, 5, 14, 0, 10, 0),
      size: 512,
      depth: 4,
    });
    expect(url).toContain("/api/v1/interp/manifest?");
    expect(url).toContain("layer=eccc_goes_east_cloud_type");
    expect(url).toContain("bbox=-1.0%2C-2.0%2C3.0%2C4.0");
    expect(url).toContain("t0=2026-06-14T00%3A00%3A00Z");
    expect(url).toContain("depth=4");
  });
});

describe("parseInterpManifest", () => {
  it("returns unavailable for available:false or malformed bodies", () => {
    expect(parseInterpManifest({ available: false, reason: "x" })).toEqual({ available: false, frames: [] });
    expect(parseInterpManifest(null)).toEqual({ available: false, frames: [] });
    expect(parseInterpManifest({ available: true })).toEqual({ available: false, frames: [] });
  });

  it("parses, resolves URLs, drops invalid rows, and sorts by time", () => {
    const m = parseInterpManifest({
      available: true,
      frames: [
        { frac: 0.5, tMs: 200, url: "/api/v1/interp/frame?frac=0.5" },
        { frac: 0.25, tMs: 100, url: "/api/v1/interp/frame?frac=0.25" },
        { frac: 0.75, tMs: "bad", url: "/x" }, // dropped: non-finite tMs
      ],
    });
    expect(m.available).toBe(true);
    expect(m.frames.map((f) => f.tMs)).toEqual([100, 200]);
    expect(m.frames[0].url).toMatch(/\/api\/v1\/interp\/frame\?frac=0\.25$/);
  });
});

describe("resolveFrameUrl", () => {
  it("passes absolute URLs through and prefixes relative ones", () => {
    expect(resolveFrameUrl("https://x/y")).toBe("https://x/y");
    expect(resolveFrameUrl("/api/v1/interp/frame?frac=0.5")).toMatch(/\/api\/v1\/interp\/frame\?frac=0\.5$/);
  });
});
