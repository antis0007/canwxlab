import type { SourceStatus } from "../types/weather";

export type ViewMode = "map" | "globe";

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

export interface LayerAnimationState {
  frameCount: number;
  frameIntervalSeconds: number;
  loop: boolean;
  currentFrame: number;
}

export interface LayerControlValues {
  min: number;
  max: number;
  smoothing: number;
  particleCount: number;
  windScale: number;
  precipitationIntensity: number;
  cloudOpacity: number;
  contourInterval: number;
  blendMode: string;
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
  isBuiltIn: boolean;
  isPlugin: boolean;
  isExperimental: boolean;
  defaultVisible: boolean;
  defaultOpacity: number;
  zIndex: number;
  colourRamp: string;
  legend: LayerLegend;
  rendererType: LayerRendererType;
  capabilities: LayerRendererCapabilities;
  animation: LayerAnimationState;
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

export type WmsTimePolicy = "global" | "latest" | "fixed";

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
  warnings: string[];
}

export interface AnimationPlaybackState {
  isPlaying: boolean;
  speedMultiplier: number;
  frame: number;
  frameCount: number;
  selectedValidTime: string;
  loopStart: number;
  loopEnd: number;
}

export interface UnitPreferences {
  temperature: "C" | "F" | "K";
  wind: "km/h" | "m/s" | "knots";
  pressure: "hPa" | "Pa";
  precipitation: "mm" | "in";
}

export interface UiPreferences {
  compactMode: boolean;
  theme: "dark" | "light" | "system";
  accentColor: string;
  mapBackgroundStyle: "default" | "muted" | "high-contrast";
  photorealisticGlobe: boolean;
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
  particleCount: 2000,
  windScale: 1,
  precipitationIntensity: 1,
  cloudOpacity: 0.7,
  contourInterval: 4,
  blendMode: "normal",
};

export const defaultUiPreferences: UiPreferences = {
  compactMode: true,
  theme: "dark",
  accentColor: "#58d0bf",
  mapBackgroundStyle: "default",
  photorealisticGlobe: true,
  units: {
    temperature: "C",
    wind: "m/s",
    pressure: "hPa",
    precipitation: "mm",
  },
};
