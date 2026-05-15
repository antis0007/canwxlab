export type SourceStatus = "live" | "mock" | "stale" | "unavailable" | "fallback";
export type LayerKind = "raster" | "vector" | "point" | "polygon" | "simulation";
export type LayerServiceType = "ogc_api" | "wms" | "mock" | "generated";

export interface DataSource {
  source_id: string;
  name: string;
  status: SourceStatus;
  adapter: string;
  last_updated: string | null;
  last_successful_fetch: string | null;
  last_attempted_fetch: string | null;
  retrieved_at: string | null;
  expires_at: string | null;
  attribution: string;
  license_url?: string | null;
  homepage_url?: string | null;
  description: string;
  message: string;
  error_type?: string | null;
  is_live: boolean;
  is_experimental: boolean;
  metadata: Record<string, unknown>;
}

export interface SourceStatusResponse {
  data_mode: "mock" | "live" | "hybrid";
  live_eccc_enabled: boolean;
  sources: DataSource[];
}

export interface WeatherLayer {
  layer_id: string;
  name: string;
  title?: string | null;
  kind: LayerKind;
  variable: string;
  unit: string;
  source_id: string;
  status: SourceStatus;
  adapter: string;
  service_type: LayerServiceType;
  last_updated: string | null;
  last_successful_fetch: string | null;
  last_attempted_fetch: string | null;
  retrieved_at: string | null;
  expires_at: string | null;
  attribution: string;
  license_url?: string | null;
  homepage_url?: string | null;
  message: string;
  error_type?: string | null;
  default_opacity: number;
  color_ramps: string[];
  styles: string[];
  wms_base_url?: string | null;
  wms_layer_name?: string | null;
  time_dimension_supported: boolean;
  legend_url?: string | null;
  min_zoom?: number | null;
  max_zoom?: number | null;
  update_frequency_hint?: string | null;
  description: string;
  is_live: boolean;
  is_experimental: boolean;
  metadata: Record<string, unknown>;
}

export interface Observation {
  observation_id: string;
  station_id: string;
  station_name: string;
  latitude: number;
  longitude: number;
  elevation_m: number | null;
  observed_at: string;
  values: Record<string, number>;
  units: Record<string, string>;
  source_id: string;
  source_status: SourceStatus;
  adapter: string;
  quality_flags: string[];
  retrieved_at: string | null;
  expires_at: string | null;
  raw_properties: Record<string, unknown>;
}

export interface AlertFeature {
  alert_id: string;
  source_id: string;
  source_status: SourceStatus;
  adapter: string;
  event: string;
  severity: "minor" | "moderate" | "severe" | "extreme" | "unknown";
  status: "actual" | "exercise" | "system" | "test" | "draft";
  headline: string;
  description: string;
  issued_at: string;
  expires_at: string | null;
  geometry: GeoJSON.Geometry;
  attribution: string;
  retrieved_at: string | null;
  raw_properties: Record<string, unknown>;
}

export interface WmsCapabilityLayerSummary {
  layer_name: string;
  title?: string | null;
  has_time_dimension: boolean;
  time_extent?: string | null;
}

export interface WmsCapabilitiesSummaryResponse {
  source: DataSource;
  layers: WmsCapabilityLayerSummary[];
}

export type PluginType = "source" | "layer" | "physics" | "diagnostic" | "forecast";
export type SafetyLevel = "core" | "safe_wasm" | "research_native" | "unsafe";
export type PluginInstallStatus = "installed" | "disabled" | "incompatible" | "error";

export interface PluginCatalogItem {
  id: string;
  name: string;
  version: string;
  author: string;
  api_version: string;
  plugin_type: PluginType;
  safety_level: SafetyLevel;
  required_variables: string[];
  produced_variables: string[];
  config_schema: Record<string, unknown>;
  description: string;
  enabled_default: boolean;
  source_path: string;
  status: PluginInstallStatus;
  is_builtin: boolean;
  contributes_layers: boolean;
  contributes_diagnostics: boolean;
  manifest_errors: string[];
}

export interface PluginDiscoveryError {
  source_path: string;
  error: string;
}

export interface PluginCatalogResponse {
  plugins: PluginCatalogItem[];
  errors: PluginDiscoveryError[];
}

export interface SimulationConfig {
  domain_id?: string;
  duration_hours?: number;
  timestep_seconds?: number;
  output_interval_minutes?: number;
  dynamics_core?: string;
  physics_modules?: string[];
  random_seed?: number;
}

export interface SimulationRun {
  run_id: string;
  status: "queued" | "running" | "completed" | "failed";
  fields_url: string | null;
  diagnostics: {
    steps_completed: number;
    min_pressure_height: number;
    max_pressure_height: number;
    min_temperature: number;
    max_temperature: number;
    min_moisture: number;
    max_moisture: number;
    max_wind_speed: number;
    water_budget_error: number;
    stability_warnings: string[];
  } | null;
  provenance: Record<string, unknown>;
}

export interface VerificationMetric {
  metric_id: string;
  source_id: string;
  model_name: string;
  variable: string;
  region: string;
  lead_time_hours: number;
  mae: number;
  rmse: number;
  bias: number;
  sample_count: number;
  status: SourceStatus;
}

export interface InspectorState {
  longitude: number;
  latitude: number;
  values: Array<{ label: string; value: string; unit?: string; status: SourceStatus }>;
}
