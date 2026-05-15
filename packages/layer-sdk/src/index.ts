export type SourceStatus = "live" | "mock" | "stale" | "unavailable" | "fallback";
export type LayerKind = "raster" | "vector" | "point" | "polygon" | "simulation";
export type LayerServiceType = "ogc_api" | "wms" | "mock" | "generated";

export interface WeatherLayerDescriptor {
  layerId: string;
  name: string;
  kind: LayerKind;
  variable: string;
  unit: string;
  sourceId: string;
  status: SourceStatus;
  serviceType: LayerServiceType;
  defaultOpacity: number;
  colorRamps: string[];
  description: string;
  isExperimental?: boolean;
  wmsBaseUrl?: string;
  wmsLayerName?: string;
  styles?: string[];
  timeDimensionSupported?: boolean;
}

export interface WmsLayerDefinition {
  layerId: string;
  status: SourceStatus;
  wmsBaseUrl: string;
  wmsLayerName: string;
  styles?: string[];
  timeDimensionSupported?: boolean;
  minZoom?: number;
  maxZoom?: number;
}

export function buildWmsGetMapUrlTemplate(
  definition: WmsLayerDefinition,
  options?: { format?: string; tileSize?: number; time?: string }
): string {
  const tileSize = options?.tileSize ?? 256;
  const format = options?.format ?? "image/png";
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    BBOX: "{bbox-epsg-3857}",
    CRS: "EPSG:3857",
    WIDTH: String(tileSize),
    HEIGHT: String(tileSize),
    LAYERS: definition.wmsLayerName,
    STYLES: definition.styles?.[0] ?? "",
    FORMAT: format,
    TRANSPARENT: "true"
  });

  if (options?.time) {
    params.set("TIME", options.time);
  }

  return `${definition.wmsBaseUrl}?${params.toString()}`;
}

export interface MapInspectorValue {
  layerId: string;
  label: string;
  value: string;
  unit?: string;
  status: SourceStatus;
}
