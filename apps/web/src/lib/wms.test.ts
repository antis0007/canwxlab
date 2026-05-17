import { describe, expect, it } from "vitest";

import { buildMapLibreWmsSource, buildWmsGetMapTemplate, type WmsLayerDefinition } from "./wms";

const baseDefinition: WmsLayerDefinition = {
  layerId: "radar",
  title: "Radar",
  status: "live",
  wmsBaseUrl: "https://geo.weather.gc.ca/geomet",
  wmsLayerName: "RADAR_1KM_RRAI",
  styles: [],
  timeDimensionSupported: true,
};

describe("buildWmsGetMapTemplate", () => {
  it("omits STYLES when no capability style is provided", () => {
    const template = buildWmsGetMapTemplate(baseDefinition);
    expect(template).not.toContain("STYLES=");
    expect(template).toContain("LAYERS=RADAR_1KM_RRAI");
    expect(template).toContain("BBOX={bbox-epsg-3857}");
  });

  it("uses the advertised GeoMet style when available", () => {
    const template = buildWmsGetMapTemplate({
      ...baseDefinition,
      styles: ["RADARURPPRECIPR14-LINEAR"],
    });
    expect(template).toContain("STYLES=RADARURPPRECIPR14-LINEAR");
  });

  it("requests high-density raster tiles by default", () => {
    const template = buildWmsGetMapTemplate(baseDefinition);
    expect(template).toContain("WIDTH=512");
    expect(template).toContain("HEIGHT=512");

    const source = buildMapLibreWmsSource(baseDefinition);
    expect(source.tileSize).toBe(256);
  });
});
