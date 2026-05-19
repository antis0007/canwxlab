import { describe, expect, it } from "vitest";

import {
  buildGibsWmtsTileUrl,
  buildMapLibreWmsSource,
  buildWmsGetMapTemplate,
  type WmsLayerDefinition,
} from "./wms";

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

  it("requests bounded raster tiles by default", () => {
    const template = buildWmsGetMapTemplate(baseDefinition);
    expect(template).toContain("WIDTH=384");
    expect(template).toContain("HEIGHT=384");

    const source = buildMapLibreWmsSource(baseDefinition);
    expect(source.tileSize).toBe(256);
  });

  it("routes GeoMet MapLibre WMS tiles through the API cache", () => {
    const source = buildMapLibreWmsSource(baseDefinition, {
      time: "2026-05-18T12:00:00Z",
      requestTileSize: 384,
    });

    expect(source.tiles[0]).toContain("/api/eccc/wms/image");
    expect(source.tiles[0]).toContain("layer_name=RADAR_1KM_RRAI");
    expect(source.tiles[0]).toContain("bbox={bbox-epsg-3857}");
    expect(source.tiles[0]).toContain("time=2026-05-18T12%3A00%3A00Z");
  });

  it("uses a valid GIBS GoogleMapsCompatible tile matrix set by default", () => {
    const template = buildGibsWmtsTileUrl({
      baseUrl: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best",
      product: "MODIS_Terra_CorrectedReflectance_TrueColor",
      date: "2026-05-18",
    });

    expect(template).toContain("GoogleMapsCompatible_Level9");
    expect(template).not.toContain("/250m/");
    expect(template).toContain(".jpg");
  });
});
