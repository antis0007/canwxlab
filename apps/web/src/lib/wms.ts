import type { WeatherLayer } from "../types/weather";

export interface WmsLayerDefinition {
  layerId: string;
  title: string;
  status: WeatherLayer["status"];
  wmsBaseUrl: string;
  wmsLayerName: string | null;
  styles: string[];
  timeDimensionSupported: boolean;
  minZoom?: number | null;
  maxZoom?: number | null;
}

export function toWmsLayerDefinition(layer: WeatherLayer): WmsLayerDefinition | null {
  if (layer.service_type !== "wms" || !layer.wms_base_url) {
    return null;
  }

  return {
    layerId: layer.layer_id,
    title: layer.title ?? layer.name,
    status: layer.status,
    wmsBaseUrl: layer.wms_base_url,
    wmsLayerName: layer.wms_layer_name ?? null,
    styles: layer.styles,
    timeDimensionSupported: layer.time_dimension_supported,
    minZoom: layer.min_zoom,
    maxZoom: layer.max_zoom
  };
}

export function canRenderWmsLayer(definition: WmsLayerDefinition): boolean {
  return (
    (definition.status === "live" || definition.status === "stale") &&
    typeof definition.wmsLayerName === "string" &&
    definition.wmsLayerName.length > 0
  );
}

export function buildWmsGetMapTemplate(
  definition: WmsLayerDefinition,
  options?: { time?: string; format?: string; tileSize?: number }
): string {
  const format = options?.format ?? "image/png";
  const tileSize = options?.tileSize ?? 256;
  const style = definition.styles[0] ?? "";

  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    BBOX: "{bbox-epsg-3857}",
    CRS: "EPSG:3857",
    WIDTH: String(tileSize),
    HEIGHT: String(tileSize),
    LAYERS: definition.wmsLayerName ?? "",
    STYLES: style,
    FORMAT: format,
    TRANSPARENT: "true"
  });

  if (options?.time) {
    query.set("TIME", options.time);
  }

  const urlString = `${definition.wmsBaseUrl}?${query.toString()}`;
  // MapLibre requires literal curly braces for {bbox-epsg-3857} replacement
  return urlString.replace(/%7B/g, "{").replace(/%7D/g, "}");
}

export function buildMapLibreWmsSource(
  definition: WmsLayerDefinition,
  options?: { time?: string; tileSize?: number }
): { type: "raster"; tiles: string[]; tileSize: number; minzoom?: number; maxzoom?: number } {
  const tileSize = options?.tileSize ?? 256;
  return {
    type: "raster",
    tiles: [buildWmsGetMapTemplate(definition, { time: options?.time, tileSize })],
    tileSize,
    minzoom: definition.minZoom ?? undefined,
    maxzoom: definition.maxZoom ?? undefined
  };
}
