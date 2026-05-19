export type SourceStatus = "live" | "mock" | "stale" | "unavailable" | "fallback" | "derived";

// ── Phase A: Foundation Hardening ──────────────────────────────────────────
// Types for the event-sourced, provenance-first architecture.
// PHASE-A-TODO: Wire these into InspectorPanel, VerificationPanel, and a new
// EvidencePanel that shows the full provenance chain for any clicked cell.
// PHASE-A-TODO: Add ConfidenceLevel and TruthMode as filter toggles in the
// LeftSidebar so operators can show/hide predicted vs. observed data.

export type ConfidenceLevel =
  | "confirmed"
  | "probable"
  | "estimated"
  | "conflicting"
  | "stale"
  | "synthetic"
  | "restricted";

export type TruthMode =
  | "observed"
  | "legal"
  | "physical"
  | "operational"
  | "predicted"
  | "historical"
  | "hypothetical";

export interface SourceAdapterRef {
  adapter_id: string;
  adapter_version: string;
  raw_pointer?: string | null;
  ingest_duration_ms?: number | null;
}

export interface SpatiotemporalEvent {
  event_id: string;
  event_kind: string;
  valid_from: string;
  valid_to?: string | null;
  observed_at: string;
  ingested_at: string;
  superseded_by?: string | null;
  longitude: number;
  latitude: number;
  elevation_m?: number | null;
  h3_cell?: string | null;
  variable: string;
  value: number;
  unit: string;
  source_id: string;
  source_adapter?: SourceAdapterRef | null;
  confidence: number;
  confidence_level: ConfidenceLevel;
  truth_mode: TruthMode;
  attribution: string;
  license_url?: string | null;
  raw_properties: Record<string, unknown>;
}

export interface DerivedCellState {
  h3_cell: string;
  variable: string;
  value: number;
  unit: string;
  source_id: string;
  confidence: number;
  confidence_level: ConfidenceLevel;
  truth_mode: TruthMode;
  derived_at: string;
  derived_from_event_ids: string[];
  conflicting_event_ids: string[];
}

export interface EvidenceChain {
  object_id: string;
  current_value: number;
  unit: string;
  confidence_level: ConfidenceLevel;
  truth_mode: TruthMode;
  events: SpatiotemporalEvent[];
  conflict_count: number;
}

export interface EventIngestionResult {
  events_written: number;
  events_skipped_duplicate: number;
  events_rejected_schema: number;
  latest_event_id?: string | null;
}
// ─────────────────────────────────────────────────────────────────────────
export type LayerKind = "raster" | "vector" | "point" | "polygon" | "simulation";
export type LayerServiceType = "ogc_api" | "wms" | "wmts" | "mock" | "generated";

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
  abstract?: string | null;
  has_time_dimension: boolean;
  time_extent?: string | null;
  styles?: string[];
  bounding_boxes?: Record<string, number[]>;
  legend_url?: string | null;
  queryable?: boolean;
}

export interface WmsCapabilitiesSummaryResponse {
  source: DataSource;
  layers: WmsCapabilityLayerSummary[];
}

export interface OgcFeatureCollection extends GeoJSON.FeatureCollection {
  layer_id?: string;
  collection_id?: string;
  status?: SourceStatus;
  retrieved_at?: string | null;
  expires_at?: string | null;
  source_url?: string | null;
  message?: string;
  error_type?: string | null;
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
