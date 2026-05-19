import type { AlertFeature, DataSource, Observation, WeatherLayer } from "../types/weather";

const now = new Date("2026-05-15T12:00:00Z").toISOString();

export const fallbackSources: DataSource[] = [
  {
    source_id: "eccc_geomet_ogc_api",
    name: "ECCC/MSC GeoMet OGC API",
    status: "unavailable",
    adapter: "eccc_geomet",
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    retrieved_at: null,
    expires_at: null,
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    license_url: "https://eccc-msc.github.io/open-data/readme_en/",
    homepage_url: "https://api.weather.gc.ca",
    description: "Public Canadian weather and climate OGC API endpoints.",
    message: "API unavailable in frontend fallback mode.",
    error_type: "ApiUnavailable",
    is_live: false,
    is_experimental: false,
    metadata: {}
  },
  {
    source_id: "eccc_geomet_wms",
    name: "ECCC/MSC GeoMet WMS",
    status: "unavailable",
    adapter: "eccc_geomet",
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    retrieved_at: null,
    expires_at: null,
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    license_url: "https://eccc-msc.github.io/open-data/readme_en/",
    homepage_url: "https://geo.weather.gc.ca/geomet",
    description: "GeoMet WMS capabilities for radar/satellite raster layers.",
    message: "Capabilities unavailable in frontend fallback mode.",
    error_type: "ApiUnavailable",
    is_live: false,
    is_experimental: false,
    metadata: {}
  }
];

function baseLayer(overrides: Partial<WeatherLayer> & Pick<WeatherLayer, "layer_id" | "name" | "kind" | "variable" | "unit" | "source_id" | "description">): WeatherLayer {
  return {
    title: overrides.name,
    status: "unavailable",
    adapter: "eccc_geomet",
    service_type: "ogc_api",
    last_updated: now,
    last_successful_fetch: now,
    last_attempted_fetch: now,
    retrieved_at: now,
    expires_at: now,
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    message: "Frontend fallback layer metadata.",
    error_type: null,
    default_opacity: 0.7,
    color_ramps: ["default"],
    styles: ["default"],
    wms_base_url: null,
    wms_layer_name: null,
    time_dimension_supported: false,
    legend_url: null,
    min_zoom: null,
    max_zoom: null,
    update_frequency_hint: null,
    is_live: false,
    is_experimental: false,
    metadata: {},
    ...overrides
  };
}

export const fallbackLayers: WeatherLayer[] = [
  baseLayer({
    layer_id: "eccc_weather_alerts",
    name: "ECCC Weather Alerts",
    kind: "polygon",
    variable: "alerts",
    unit: "category",
    source_id: "eccc_geomet_ogc_api",
    status: "unavailable",
    adapter: "eccc_geomet",
    service_type: "ogc_api",
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    message: "Live source unavailable in frontend fallback mode.",
    default_opacity: 0.58,
    color_ramps: ["alert_severity"],
    description: "Official ECCC alert polygons via GeoMet OGC API.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null
  }),
  baseLayer({
    layer_id: "eccc_climate_stations",
    name: "ECCC Climate Stations",
    kind: "point",
    variable: "surface_observations",
    unit: "mixed",
    source_id: "eccc_geomet_ogc_api",
    status: "unavailable",
    adapter: "eccc_geomet",
    service_type: "ogc_api",
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    message: "Live source unavailable in frontend fallback mode.",
    default_opacity: 1,
    color_ramps: ["thermal"],
    description: "ECCC climate station point features.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null
  }),
  baseLayer({
    layer_id: "eccc_radar_1km_rrai",
    name: "ECCC Radar - Rain Rate (1 km)",
    kind: "raster",
    variable: "radar",
    unit: "mm/h",
    source_id: "eccc_geomet_wms",
    status: "stale",
    adapter: "eccc_geomet",
    service_type: "wms",
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    message: "Direct GeoMet WMS fallback using documented layer id; API verification unavailable.",
    default_opacity: 0.82,
    color_ramps: [],
    styles: ["RADARURPPRECIPR14-LINEAR"],
    wms_base_url: "https://geo.weather.gc.ca/geomet",
    wms_layer_name: "RADAR_1KM_RRAI",
    time_dimension_supported: true,
    description: "ECCC North American radar precipitation rate for rain via MSC GeoMet WMS.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    metadata: {
      curated: true,
      verified_runtime: false,
      intended_product_type: "radar",
      candidate_layer_names: ["RADAR_1KM_RRAI"],
      keywords: ["radar"],
    }
  }),
  baseLayer({
    layer_id: "eccc_gdps_p_msl",
    name: "ECCC GDPS - Mean Sea Level Pressure",
    kind: "raster",
    variable: "pressure_msl",
    unit: "hPa",
    source_id: "eccc_geomet_wms",
    status: "unavailable",
    adapter: "eccc_geomet",
    service_type: "wms",
    attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
    message: "GDPS.DIAG_PN not present in current GeoMet WMS GetCapabilities.",
    default_opacity: 0.62,
    color_ramps: ["pressure"],
    styles: [],
    wms_base_url: "https://geo.weather.gc.ca/geomet",
    wms_layer_name: null,
    time_dimension_supported: false,
    description: "Global Deterministic Prediction System mean sea level pressure via MSC GeoMet WMS.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    metadata: {
      curated: true,
      verified_runtime: false,
      intended_product_type: "model",
      candidate_layer_names: ["GDPS.DIAG_PN"],
      keywords: ["pressure", "mslp", "model"],
    }
  }),
  baseLayer({
    layer_id: "eccc_goes_east_natural",
    name: "ECCC GOES-East - Natural Colour",
    kind: "raster",
    variable: "satellite",
    unit: "reflectance",
    source_id: "eccc_geomet_wms",
    status: "stale",
    adapter: "eccc_geomet",
    service_type: "wms",
    attribution: "Environment and Climate Change Canada / NOAA.",
    message: "Direct GeoMet WMS fallback using documented layer id; API verification unavailable.",
    default_opacity: 0.78,
    color_ramps: [],
    styles: [],
    wms_base_url: "https://geo.weather.gc.ca/geomet",
    wms_layer_name: "GOES-East_1km_NaturalColor",
    time_dimension_supported: true,
    description: "GOES-East natural colour satellite imagery via MSC GeoMet WMS.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    metadata: {
      curated: true,
      verified_runtime: false,
      intended_product_type: "satellite",
      candidate_layer_names: ["GOES-East_1km_NaturalColor"],
      keywords: ["satellite", "cloud"],
    }
  }),
  baseLayer({
    layer_id: "eccc_goes_east_cloud_type",
    name: "ECCC GOES-East - Day Cloud Type / Night Microphysics",
    kind: "raster",
    variable: "cloud",
    unit: "classification",
    source_id: "eccc_geomet_wms",
    status: "stale",
    adapter: "eccc_geomet",
    service_type: "wms",
    attribution: "Environment and Climate Change Canada / NOAA.",
    message: "Direct GeoMet WMS fallback using documented layer id; API verification unavailable.",
    default_opacity: 0.72,
    color_ramps: [],
    styles: [],
    wms_base_url: "https://geo.weather.gc.ca/geomet",
    wms_layer_name: "GOES-East_1km_DayCloudType-NightMicrophysics",
    time_dimension_supported: true,
    description: "GOES-East cloud type / night microphysics satellite product via MSC GeoMet WMS.",
    retrieved_at: null,
    expires_at: null,
    last_updated: null,
    last_successful_fetch: null,
    last_attempted_fetch: null,
    metadata: {
      curated: true,
      verified_runtime: false,
      intended_product_type: "cloud",
      candidate_layer_names: ["GOES-East_1km_DayCloudType-NightMicrophysics"],
      keywords: ["satellite", "cloud"],
    }
  })
];

export const fallbackObservations: Observation[] = [];

export const fallbackAlerts: AlertFeature[] = [];

export interface LayerControlState {
  visible: boolean;
  opacity: number;
  colorRamp: string;
}

export function createInitialLayerState(layers: WeatherLayer[]): Record<string, LayerControlState> {
  const defaultVisibleIds = new Set([
    "eccc_weather_alerts",
    "eccc_climate_stations",
    "eccc_radar_1km_rrai",
    "eccc_goes_east_cloud_type",
  ]);
  return Object.fromEntries(
    layers.map((layer) => {
      const visible = defaultVisibleIds.has(layer.layer_id) && layer.status !== "unavailable";

      return [
        layer.layer_id,
        {
          visible,
          opacity: layer.default_opacity,
          colorRamp: layer.color_ramps[0] ?? "default"
        }
      ];
    })
  );
}
