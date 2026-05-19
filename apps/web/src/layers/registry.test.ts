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

  it("omits demo layers in mock mode", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const demos = defs.filter((d) => d.id.startsWith("demo_"));
    expect(demos).toHaveLength(0);
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

  it("filters backend layers marked as mock", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [
        {
          ...fallbackLayers[0],
          layer_id: "mock_backend_layer",
          status: "mock",
        },
        {
          ...fallbackLayers[2],
          layer_id: "eccc_radar_live",
          status: "live",
        },
      ],
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    expect(defs.some((d) => d.id === "mock_backend_layer")).toBe(false);
    expect(defs.some((d) => d.id === "eccc_radar_live")).toBe(true);
  });

  it("marks flat animated deck layers as map-only", () => {
    const defs = buildLayerDefinitions({
      backendLayers: [
        {
          ...fallbackLayers[2],
          layer_id: "eccc_point_field",
          service_type: "ogc_api",
          variable: "temperature_2m",
          status: "live",
        },
      ],
      plugins: [],
      pluginEnabled: {},
      dataMode: "live",
    });
    const flatLayers = defs.filter((d) => d.rendererType === "deck-grid" || d.rendererType === "deck-particles");
    expect(flatLayers.length).toBeGreaterThan(0);
    expect(flatLayers.every((d) => d.capabilities.supportsGlobe === false)).toBe(true);
  });
});
