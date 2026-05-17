import { describe, expect, it } from "vitest";

import { fallbackLayers } from "../lib/layerRegistry";
import { buildLayerDefinitions } from "./registry";

describe("buildLayerDefinitions decontamination", () => {
  it("omits demo layers in live mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "live",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos).toHaveLength(0);
  });

  it("omits demo layers in hybrid mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "hybrid",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos).toHaveLength(0);
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

  it("keeps documented ECCC WMS radar and cloud overlays renderable in fallback mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const radar = defs.find((d) => d.id === "eccc_radar_1km_rrai");
    const cloud = defs.find((d) => d.id === "eccc_goes_east_cloud_type");

    expect(radar?.rendererType).toBe("wms-raster");
    expect(radar?.wmsLayerName).toBe("RADAR_1KM_RRAI");
    expect(radar?.defaultVisible).toBe(true);
    expect(cloud?.rendererType).toBe("wms-raster");
    expect(cloud?.wmsLayerName).toBe("GOES-East_1km_DayCloudType-NightMicrophysics");
    expect(cloud?.defaultVisible).toBe(true);
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

  it("marks flat animated deck layers as map-only", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const flatDemoLayers = defs.filter((d) => d.rendererType === "deck-grid" || d.rendererType === "deck-particles");
    expect(flatDemoLayers.length).toBeGreaterThan(0);
    expect(flatDemoLayers.every((d) => d.capabilities.supportsGlobe === false)).toBe(true);
  });
});
