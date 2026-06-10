import type { PlanetaryTimelineState } from "../types/planetary";
import type { SourceStatus } from "../types/weather";
import type { TimelineViewDays } from "../time/timelineWindow";

export type ViewMode = "map" | "globe";

export type RendererKind = "maplibre-2d" | "maplibre-globe" | "earth-webgl";

export interface CameraState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export type LayerCategory =
  | "base"
  | "observation"
  | "radar"
  | "satellite"
  | "forecast"
  | "simulation"
  | "infrastructure"
  | "diagnostic"
  | "alert"
  | "plugin"
  | "experimental";

export type LayerRendererType =
  | "maplibre-raster"
  | "maplibre-vector"
  | "deck-scatter"
  | "deck-grid"
  | "deck-polygon"
  | "deck-line"
  | "deck-particles"
  | "deck-power-grid"
  | "deck-satellite"
  | "custom-canvas"
  | "wms-raster";

export interface LayerRendererCapabilities {
  supportsMap: boolean;
  supportsGlobe: boolean;
  supportsAnimation: boolean;
  supportsPicking: boolean;
  supportsShader: boolean;
  supportsWms: boolean;
  supportsCustomColorRamp: boolean;
  supportsOpacity: boolean;
}

export interface LayerControlValues {
  min: number;
  max: number;
  smoothing: number;
  rasterSmoothing?: "linear" | "nearest";
  rasterContrast?: number;
  rasterSaturation?: number;
  rasterBrightness?: number;
  particleCount: number;
  windScale: number;
  precipitationIntensity: number;
  cloudOpacity: number;
  contourInterval: number;
  blendMode: string;
  edgeBlur: number;
}

export type RenderLayerType =
  | "wms-raster"
  | "deck-grid"
  | "deck-vector"
  | "native-raster"
  | "shader-raster";

export type RenderTimePolicy = "latest" | "timeline" | "fixed";

export type RenderBlendMode = "normal" | "screen" | "multiply" | "add" | "max" | "alpha";

export interface RenderSourcePlan {
  kind: "wms" | "deck" | "native" | "shader";
  sourceKind?: "wms" | "wmts";
  layerId: string;
  sourceId: string;
  status: SourceStatus;
  title: string;
  urlTemplate?: string;
  wmsBaseUrl?: string | null;
  wmsLayerName?: string | null;
  styles?: string[];
  timeExtent?: string | null;
  variable?: string;
  unit?: string;
  metadata: Record<string, unknown>;
}

export interface RenderLayerPlan {
  id: string;
  rendererType: RenderLayerType;
  order: number;
  opacity: number;
  visible: boolean;
  timePolicy: RenderTimePolicy;
  resolvedTime: string | null;
  source: RenderSourcePlan;
  blendMode: RenderBlendMode;
  visualFilters?: {
    rasterSmoothing: "linear" | "nearest";
    rasterContrast: number;
    rasterSaturation: number;
    rasterBrightness: number;
  };
  priority: number;
}

export interface LayerLegendStop {
  value: number;
  color: string;
  label: string;
}

export interface LayerLegend {
  title: string;
  unit?: string;
  gradient: string;
  stops: LayerLegendStop[];
}

export interface LayerDefinition {
  id: string;
  title: string;
  description: string;
  category: LayerCategory;
  sourceId: string;
  status: SourceStatus;
  isExperimental: boolean;
  defaultVisible: boolean;
  defaultOpacity: number;
  zIndex: number;
  colourRamp: string;
  legend: LayerLegend;
  rendererType: LayerRendererType;
  capabilities: LayerRendererCapabilities;
  /** Only frameCount is consumed by the render plan. */
  animation: { frameCount: number };
  controls: LayerControlValues;
  serviceType?: string;
  variable?: string;
  unit?: string;
  message?: string;
  wmsBaseUrl?: string | null;
  wmsLayerName?: string | null;
  styles?: string[];
  pluginId?: string | null;
  metadata?: Record<string, unknown>;
}

export type WmsTimePolicy = RenderTimePolicy | "global";

export interface LayerRuntimeState {
  enabled: boolean;
  opacity: number;
  colourRamp: string;
  zIndex: number;
  controls: LayerControlValues;
  wmsTimePolicy?: WmsTimePolicy;
  wmsFixedTime?: number;
}

export interface LayerDiagnostics {
  fps: number;
  activeLayerCount: number;
  animatedLayerCount: number;
  lastDataRefreshAt: string | null;
  mapMode: ViewMode;
  deckLayerCount: number;
  rendererKind?: RendererKind;
  pendingRasterFrames?: number;
  promotedRasterFrames?: number;
  failedRasterFrames?: number;
  lastSourceError?: string | null;
  warnings: string[];
}

export interface AnimationPlaybackState {
  isPlaying: boolean;
  /** True while playback is held at the edge of buffered satellite data. */
  isBuffering: boolean;
  speedMultiplier: number;
  /** Continuous timeline position, in frame units. Drives smooth scrub/playback UI. */
  playheadFrame: number;
  /** Discrete WMS target frame used for fetching the next raster frame. */
  frame: number;
  frameCount: number;
  visibleDays: TimelineViewDays;
  selectedValidTime: string;
  selectedContinuousTime: string;
  loopStart: number;
  loopEnd: number;
  /** 0→1 progress from the current frame toward the next. 0 when paused. */
  subFrameProgress: number;
  timelineState: PlanetaryTimelineState;
  liveFrame: number;
  forecastFrame: number;
}

export interface UnitPreferences {
  temperature: "C" | "F" | "K";
  wind: "km/h" | "m/s" | "knots";
  pressure: "hPa" | "Pa";
  precipitation: "mm" | "in";
}

export type StarExposure = "dim" | "realistic" | "bright" | "extreme";
export type RenderQualityPreset = "performance" | "balanced" | "quality";

export interface UiPreferences {
  compactMode: boolean;
  theme: "dark" | "light" | "system";
  accentColor: string;
  mapBackgroundStyle: "default" | "muted" | "high-contrast";
  photorealisticGlobe: boolean;
  /** Restrained orbital-photo colour response for the photorealistic globe pass. */
  globePhotoGrade?: boolean;
  /** Visibility floor for the celestial-sphere starfield. */
  starExposure?: StarExposure;
  /** Light-years; stars beyond this distance are not drawn. Catalogue caps practical density. */
  starMaxDistanceLy?: number;
  /** Global workstation quality profile used by heavy visual renderers. */
  renderQuality?: RenderQualityPreset;
  units: UnitPreferences;
}

export interface RendererFeatureValue {
  label: string;
  value: string;
  unit?: string;
  status: SourceStatus;
}

export const defaultLayerControls: LayerControlValues = {
  min: 0,
  max: 1,
  smoothing: 0.5,
  rasterSmoothing: "linear",
  rasterContrast: 0,
  rasterSaturation: 0,
  rasterBrightness: 0,
  particleCount: 2000,
  windScale: 1,
  precipitationIntensity: 1,
  cloudOpacity: 0.7,
  contourInterval: 4,
  blendMode: "normal",
  edgeBlur: 0,
};

export const defaultUiPreferences: UiPreferences = {
  compactMode: true,
  theme: "dark",
  accentColor: "#58d0bf",
  mapBackgroundStyle: "default",
  photorealisticGlobe: false,
  globePhotoGrade: true,
  starExposure: "realistic",
  starMaxDistanceLy: 500,
  renderQuality: "balanced",
  units: {
    temperature: "C",
    wind: "m/s",
    pressure: "hPa",
    precipitation: "mm",
  },
};
