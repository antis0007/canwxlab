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
  bounds?: [number, number, number, number] | null;
}

const DEFAULT_WMS_REQUEST_TILE_SIZE = 512;
const DEFAULT_WMS_SOURCE_TILE_SIZE = 256;

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
    maxZoom: layer.max_zoom,
    bounds: readLonLatBounds(layer.metadata?.wms_bounds_lonlat)
  };
}

function readLonLatBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((part) => Number(part));
  if (nums.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = nums;
  if (west >= east || south >= north) return null;
  return [
    Math.max(-180, Math.min(180, west)),
    Math.max(-90, Math.min(90, south)),
    Math.max(-180, Math.min(180, east)),
    Math.max(-90, Math.min(90, north)),
  ];
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
  options?: { time?: string; format?: string; requestTileSize?: number }
): string {
  const format = options?.format ?? "image/png";
  const requestTileSize = options?.requestTileSize ?? DEFAULT_WMS_REQUEST_TILE_SIZE;
  const style = definition.styles[0] ?? "";

  const query = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    BBOX: "{bbox-epsg-3857}",
    CRS: "EPSG:3857",
    WIDTH: String(requestTileSize),
    HEIGHT: String(requestTileSize),
    LAYERS: definition.wmsLayerName ?? "",
    FORMAT: format,
    TRANSPARENT: "true"
  });

  if (style.length > 0) {
    query.set("STYLES", style);
  }

  if (options?.time) {
    query.set("TIME", options.time);
  }

  const urlString = `${definition.wmsBaseUrl}?${query.toString()}`;
  // MapLibre requires literal curly braces for {bbox-epsg-3857} replacement
  return urlString.replace(/%7B/g, "{").replace(/%7D/g, "}");
}

export function buildMapLibreWmsSource(
  definition: WmsLayerDefinition,
  options?: { time?: string; requestTileSize?: number; sourceTileSize?: number }
): { type: "raster"; tiles: string[]; tileSize: number; minzoom?: number; maxzoom?: number; bounds?: [number, number, number, number] } {
  const requestTileSize = options?.requestTileSize ?? DEFAULT_WMS_REQUEST_TILE_SIZE;
  const sourceTileSize = options?.sourceTileSize ?? DEFAULT_WMS_SOURCE_TILE_SIZE;
  return {
    type: "raster",
    tiles: [buildWmsGetMapTemplate(definition, { time: options?.time, requestTileSize })],
    tileSize: sourceTileSize,
    minzoom: definition.minZoom ?? undefined,
    maxzoom: definition.maxZoom ?? undefined,
    bounds: definition.bounds ?? undefined
  };
}
