from datetime import UTC, datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field


class SourceStatus(StrEnum):
    live = "live"
    mock = "mock"
    stale = "stale"
    unavailable = "unavailable"
    fallback = "fallback"


class LayerKind(StrEnum):
    raster = "raster"
    vector = "vector"
    point = "point"
    polygon = "polygon"
    simulation = "simulation"


class LayerServiceType(StrEnum):
    ogc_api = "ogc_api"
    wms = "wms"
    mock = "mock"
    generated = "generated"


class PluginType(StrEnum):
    source = "source"
    layer = "layer"
    physics = "physics"
    diagnostic = "diagnostic"
    forecast = "forecast"


class SafetyLevel(StrEnum):
    core = "core"
    safe_wasm = "safe_wasm"
    research_native = "research_native"
    unsafe = "unsafe"


class PluginInstallStatus(StrEnum):
    installed = "installed"
    disabled = "disabled"
    incompatible = "incompatible"
    error = "error"


class RunStatus(StrEnum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class DataSource(BaseModel):
    source_id: str
    name: str
    status: SourceStatus
    adapter: str = "mock"
    last_updated: datetime | None = None
    last_successful_fetch: datetime | None = None
    last_attempted_fetch: datetime | None = None
    retrieved_at: datetime | None = None
    expires_at: datetime | None = None
    attribution: str
    license_url: str | None = None
    description: str
    homepage_url: str | None = None
    message: str = ""
    error_type: str | None = None
    is_live: bool = False
    is_experimental: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class GridDefinition(BaseModel):
    grid_id: str
    name: str
    crs: str
    width: int
    height: int
    resolution_m: float | None = None
    bbox: tuple[float, float, float, float] = Field(
        description="Bounding box as west,south,east,north in EPSG:4326"
    )


class WeatherLayer(BaseModel):
    layer_id: str
    name: str
    title: str | None = None
    kind: LayerKind
    variable: str
    unit: str
    source_id: str
    status: SourceStatus
    adapter: str = "mock"
    service_type: LayerServiceType = LayerServiceType.generated
    last_updated: datetime | None = None
    last_successful_fetch: datetime | None = None
    last_attempted_fetch: datetime | None = None
    retrieved_at: datetime | None = None
    expires_at: datetime | None = None
    attribution: str
    license_url: str | None = None
    homepage_url: str | None = None
    message: str = ""
    error_type: str | None = None
    is_live: bool = False
    is_experimental: bool = False
    default_opacity: float = Field(ge=0.0, le=1.0)
    color_ramps: list[str] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)
    wms_base_url: str | None = None
    wms_layer_name: str | None = None
    time_dimension_supported: bool = False
    legend_url: str | None = None
    min_zoom: int | None = None
    max_zoom: int | None = None
    update_frequency_hint: str | None = None
    description: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class ForecastRun(BaseModel):
    run_id: str
    source_id: str
    model_name: str
    model_run_time: datetime
    valid_time: datetime
    lead_time_hours: int
    variables: list[str]
    grid_id: str
    provenance: dict[str, Any] = Field(default_factory=dict)


class Observation(BaseModel):
    observation_id: str
    station_id: str
    station_name: str
    latitude: float
    longitude: float
    elevation_m: float | None = None
    observed_at: datetime
    values: dict[str, float]
    units: dict[str, str]
    source_id: str
    source_status: SourceStatus = SourceStatus.mock
    adapter: str = "mock"
    quality_flags: list[str] = Field(default_factory=list)
    retrieved_at: datetime | None = None
    expires_at: datetime | None = None
    raw_properties: dict[str, Any] = Field(default_factory=dict)


class AlertFeature(BaseModel):
    alert_id: str
    source_id: str
    source_status: SourceStatus = SourceStatus.mock
    adapter: str = "mock"
    event: str
    severity: Literal["minor", "moderate", "severe", "extreme", "unknown"]
    status: Literal["actual", "exercise", "system", "test", "draft"] = "actual"
    headline: str
    description: str
    issued_at: datetime
    expires_at: datetime | None = None
    geometry: dict[str, Any]
    attribution: str
    retrieved_at: datetime | None = None
    raw_properties: dict[str, Any] = Field(default_factory=dict)


class SourceStatusResponse(BaseModel):
    data_mode: Literal["mock", "live", "hybrid"]
    live_eccc_enabled: bool
    sources: list[DataSource]


class LayerCatalogResponse(BaseModel):
    layers: list[WeatherLayer]


class WmsCapabilityLayerSummary(BaseModel):
    layer_name: str
    title: str | None = None
    abstract: str | None = None
    styles: list[str] = Field(default_factory=list)
    dimensions: dict[str, str] = Field(default_factory=dict)
    bounding_boxes: dict[str, list[float]] = Field(default_factory=dict)
    legend_url: str | None = None
    queryable: bool = False
    has_time_dimension: bool = False
    time_extent: str | None = None


class WmsCapabilitiesSummaryResponse(BaseModel):
    source: DataSource
    layers: list[WmsCapabilityLayerSummary]


class SimulationDomain(BaseModel):
    domain_id: str
    name: str
    grid: GridDefinition
    start_time: datetime | None = None
    description: str


class SimulationConfig(BaseModel):
    domain_id: str = "canada_demo_64"
    start_time: datetime = Field(default_factory=lambda: datetime.now(UTC))
    duration_hours: float = Field(default=1.0, gt=0)
    timestep_seconds: float = Field(default=30.0, gt=0)
    output_interval_minutes: float = Field(default=10.0, gt=0)
    dynamics_core: str = "shallow_water_2d"
    physics_modules: list[str] = Field(default_factory=lambda: ["simple_condensation"])
    random_seed: int = 42
    requested_by: str = "local-user"


class SimulationDiagnostics(BaseModel):
    steps_completed: int
    min_pressure_height: float
    max_pressure_height: float
    min_temperature: float
    max_temperature: float
    min_moisture: float
    max_moisture: float
    max_wind_speed: float
    water_budget_error: float
    stability_warnings: list[str] = Field(default_factory=list)


class SimulationRun(BaseModel):
    run_id: str
    status: RunStatus
    config: SimulationConfig
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None
    diagnostics: SimulationDiagnostics | None = None
    fields_url: str | None = None
    error: str | None = None
    provenance: dict[str, Any] = Field(default_factory=dict)


class VerificationMetric(BaseModel):
    metric_id: str
    source_id: str
    model_name: str
    variable: str
    region: str
    lead_time_hours: int
    mae: float
    rmse: float
    bias: float
    sample_count: int
    valid_start: datetime
    valid_end: datetime
    status: SourceStatus = SourceStatus.mock


class PluginManifest(BaseModel):
    id: str
    name: str
    version: str
    author: str
    api_version: str
    plugin_type: PluginType
    safety_level: SafetyLevel
    required_variables: list[str] = Field(default_factory=list)
    produced_variables: list[str] = Field(default_factory=list)
    config_schema: dict[str, Any] = Field(default_factory=dict)
    description: str


class PluginCatalogItem(PluginManifest):
    enabled_default: bool = True
    source_path: str
    status: PluginInstallStatus = PluginInstallStatus.installed
    is_builtin: bool = False
    contributes_layers: bool = False
    contributes_diagnostics: bool = False
    manifest_errors: list[str] = Field(default_factory=list)


class PluginDiscoveryError(BaseModel):
    source_path: str
    error: str


class PluginCatalogResponse(BaseModel):
    plugins: list[PluginCatalogItem]
    errors: list[PluginDiscoveryError] = Field(default_factory=list)
