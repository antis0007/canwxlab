import { describe, expect, it } from "vitest";

import { buildLayerDefinitions } from "./registry";

describe("buildLayerDefinitions decontamination", () => {
  it("hides demo layers by default in live mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "live",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos.length).toBeGreaterThan(0);
    expect(demos.every((d) => d.defaultVisible === false)).toBe(true);
  });

  it("hides demo layers by default in hybrid mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "hybrid",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos.every((d) => d.defaultVisible === false)).toBe(true);
  });

  it("shows demo layers by default in mock mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos.some((d) => d.defaultVisible === true)).toBe(true);
  });

  it("demo layers are tagged [MOCK] in title", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos.every((d) => /^\[MOCK\]/.test(d.title))).toBe(true);
  });
});
