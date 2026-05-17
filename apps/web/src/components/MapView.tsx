import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AlertFeature, Observation, OgcFeatureCollection } from "../types/weather";
import { api } from "../lib/api";
import type {
  LayerDefinition,
  LayerDiagnostics,
  LayerRuntimeState,
  RendererFeatureValue,
  RenderLayerPlan,
  ViewMode,
  CameraState,
} from "../layers/types";
import { createDeckGridLayer, createDeckPointFieldLayer } from "../layers/renderers/deckGrid";
import { createDeckParticleLayer } from "../layers/renderers/deckParticles";
import {
  createAlertMarkerLayer,
  createAlertPolygonLayer,
  createOgcFeatureLayer,
  createStationLayer,
} from "../layers/renderers/deckVector";
import {
  createCloudOverlay,
  createPressureGrid,
  createRadarBlobs,
  createTemperatureGrid,
  createWindParticles,
  sampleMockWeatherPoint,
} from "../layers/renderers/mockWeatherFields";
import { getWmsRendererTelemetry, syncWmsLayers } from "../layers/renderers/maplibreRaster";
import { buildInspectorPayload } from "../layers/inspection";
import { buildRenderPlan, rendererKindForViewMode } from "../layers/renderPlan";
import type { BasemapId } from "./LayersPicker";
import { Starfield, type StarProjection } from "./Starfield";
import { StarInfoCard } from "./StarInfoCard";
import type { Star } from "../lib/celestialSphere";
import type { StarExposure } from "../layers/types";
import { createDiffBitmapLayer, type DiffOverlayPayload } from "../layers/renderers/diffBitmap";

interface MapInspectPayload {
  longitude: number;
  latitude: number;
  values: RendererFeatureValue[];
  nearestStation: string | null;
  activeAlert: string | null;
}

interface MapContextMenuState {
  x: number;
  y: number;
  longitude: number;
  latitude: number;
}

const CONTEXT_MENU_WIDTH = 200;
const CONTEXT_MENU_HEIGHT = 240;
const CONTEXT_MENU_MARGIN = 8;

function clampContextMenuPosition(
  x: number,
  y: number,
  containerWidth: number,
  containerHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(CONTEXT_MENU_MARGIN, Math.min(x, containerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_MARGIN)),
    y: Math.max(CONTEXT_MENU_MARGIN, Math.min(y, containerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_MARGIN)),
  };
}

interface MapViewProps {
  layers: LayerDefinition[];
  layerState: Record<string, LayerRuntimeState>;
  observations: Observation[];
  alerts: AlertFeature[];
  viewMode: ViewMode;
  animationFrame: number;
  onInspect: (payload: MapInspectPayload) => void;
  onDiagnostics: (diagnostics: Partial<LayerDiagnostics>) => void;
  onGlobeSupportDetected: (supported: boolean) => void;
  cameraTarget: CameraState | null;
  onCameraChange: (state: CameraState) => void;
  globalTimeMs: number;
  basemap: BasemapId;
  photorealisticGlobe: boolean;
  diffOverlay?: DiffOverlayPayload | null;
  starExposure?: StarExposure;
  starMaxDistanceLy?: number;
  timelinePlaying: boolean;
  timelineSpeedMultiplier: number;
}

interface BasemapPreset {
  id: BasemapId;
  style: StyleSpecification;
}

const NORMALIZED_ALERT_LAYER_IDS = new Set(["eccc_weather_alerts", "mock_alerts"]);
const NORMALIZED_OBSERVATION_LAYER_IDS = new Set([
  "eccc_climate_stations",
  "eccc_climate_hourly",
  "mock_stations",
]);
const MAX_RENDER_PIXEL_RATIO = 2;

function renderPixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO));
}

function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return 0;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeCameraState(camera: CameraState, viewMode: ViewMode): CameraState {
  return {
    longitude: normalizeLongitude(camera.longitude),
    latitude: clamp(camera.latitude, -85, 85),
    zoom: clamp(camera.zoom, viewMode === "globe" ? 0.25 : -1, 18),
    bearing: viewMode === "globe" ? 0 : clamp(camera.bearing, -180, 180),
    pitch: viewMode === "globe" ? 0 : clamp(camera.pitch, 0, 60),
  };
}

function rasterStyle(spec: {
  background: string;
  tiles: string[];
  attribution: string;
  tileSize?: number;
  maxzoom?: number;
  overlayTiles?: string[];
  overlayAttribution?: string;
}): StyleSpecification {
  const sources: StyleSpecification["sources"] = {
    base: {
      type: "raster",
      tiles: spec.tiles,
      tileSize: spec.tileSize ?? 256,
      maxzoom: spec.maxzoom ?? 19,
      attribution: spec.attribution,
    },
  };
  const layers: StyleSpecification["layers"] = [
    { id: "background", type: "background", paint: { "background-color": spec.background } },
    { id: "base-tiles", type: "raster", source: "base" },
  ];
  if (spec.overlayTiles) {
    (sources as any)["overlay"] = {
      type: "raster",
      tiles: spec.overlayTiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: spec.overlayAttribution ?? "",
    };
    layers.push({ id: "overlay-tiles", type: "raster", source: "overlay" });
  }
  return { version: 8, sources, layers };
}

const BASEMAP_PRESETS: BasemapPreset[] = [
  {
    id: "dark",
    style: rasterStyle({
      background: "#090d14",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      maxzoom: 20,
      attribution: "© OpenStreetMap contributors © CARTO",
    }),
  },
  {
    id: "light",
    style: rasterStyle({
      background: "#e8eef5",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      maxzoom: 20,
      attribution: "© OpenStreetMap contributors © CARTO",
    }),
  },
  {
    id: "satellite",
    style: rasterStyle({
      background: "#0a0d12",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics",
    }),
  },
  {
    id: "hybrid",
    style: rasterStyle({
      background: "#0a0d12",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Tiles © Esri — Imagery + Boundaries/Labels",
      overlayTiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      ],
      overlayAttribution: "Labels © Esri",
    }),
  },
  {
    id: "terrain",
    style: rasterStyle({
      background: "#1a1f1a",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution: "© OpenStreetMap contributors, SRTM | OpenTopoMap (CC-BY-SA)",
    }),
  },
  {
    id: "blue_marble",
    style: rasterStyle({
      background: "#06101c",
      tiles: [
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/{z}/{y}/{x}.jpeg",
      ],
      tileSize: 256,
      maxzoom: 8,
      attribution: "NASA EOSDIS GIBS — Blue Marble: Shaded Relief and Bathymetry",
    }),
  },
  {
    id: "gibs_truecolor",
    style: rasterStyle({
      background: "#02060e",
      tiles: [
        // {time} placeholder is rewritten to YYYY-MM-DD by getBasemapStyle().
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/250m/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
      maxzoom: 9,
      attribution:
        "NASA EOSDIS GIBS — MODIS Terra Corrected Reflectance (True Colour, daily, T-1)",
    }),
  },
  {
    id: "gibs_viirs",
    style: rasterStyle({
      background: "#02060e",
      tiles: [
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{time}/250m/{z}/{y}/{x}.jpg",
      ],
      tileSize: 256,
      maxzoom: 9,
      attribution:
        "NASA EOSDIS GIBS — VIIRS NOAA-20 Corrected Reflectance (True Colour, daily, T-1)",
    }),
  },
  {
    id: "topo_dark",
    style: rasterStyle({
      background: "#0a0f18",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 512,
      maxzoom: 20,
      attribution: "© OpenStreetMap contributors © CARTO",
    }),
  },
];

function ymdUtcMinusDays(refMs: number, daysBack: number): string {
  const d = new Date(refMs);
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function rewriteTimeInStyle(style: StyleSpecification, timeStr: string): StyleSpecification {
  // Replace {time} placeholders in raster source tiles arrays. Deep-clones the
  // style so the shared BASEMAP_PRESETS entry isn't mutated.
  const cloned = JSON.parse(JSON.stringify(style)) as StyleSpecification;
  const sources = cloned.sources as Record<string, { tiles?: string[] }>;
  for (const sourceId of Object.keys(sources)) {
    const tiles = sources[sourceId]?.tiles;
    if (Array.isArray(tiles)) {
      sources[sourceId].tiles = tiles.map((url) => url.replace("{time}", timeStr));
    }
  }
  return cloned;
}

function applyGlobePresentation(
  map: maplibregl.Map,
  viewMode: ViewMode,
) {
  try {
    if (map.getLayer("background")) {
      map.setPaintProperty("background", "background-opacity", 1);
    }
  } catch { /* style not yet ready */ }
  if (viewMode === "globe") {
    map.dragRotate.disable();
    (map.touchZoomRotate as any)?.disableRotation?.();
    if (typeof (map as any).setProjection === "function") {
      (map as any).setProjection({ type: "globe" });
    }
    if (typeof (map as any).setSky === "function") {
      (map as any).setSky({});
    }
    if (Math.abs(map.getPitch()) > 0.01 || Math.abs(map.getBearing()) > 0.01) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 200, essential: true });
    }
  } else if (typeof (map as any).setProjection === "function") {
    map.dragRotate.disable();
    (map.touchZoomRotate as any)?.disableRotation?.();
    (map as any).setProjection({ type: "mercator" });
  }

  if (typeof (map as any).setLight === "function") {
    (map as any).setLight({ anchor: "viewport", intensity: 0.35 });
  }
}

export function getBasemapStyle(id: BasemapId, timeMs?: number): string | StyleSpecification {
  const configured = import.meta.env.VITE_MAP_STYLE_URL;
  if (configured && configured.trim().length > 0) return configured;
  const preset = BASEMAP_PRESETS.find((p) => p.id === id) ?? BASEMAP_PRESETS[0];
  // GIBS daily imagery: pick T-1 in UTC to maximise availability. For
  // time-aware imagery the caller can supply timeMs; otherwise we use "now".
  const ref = typeof timeMs === "number" && Number.isFinite(timeMs) ? timeMs : Date.now();
  const dateStr = ymdUtcMinusDays(ref, 1);
  return rewriteTimeInStyle(preset.style, dateStr);
}

function activeAlertAtPoint(alerts: AlertFeature[], longitude: number, latitude: number): string | null {
  for (const alert of alerts) {
    const coordinates = (alert.geometry as any)?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const flat = flattenPoints(coordinates);
    if (flat.length === 0) continue;
    const lons = flat.map((point) => point[0]);
    const lats = flat.map((point) => point[1]);
    if (
      longitude >= Math.min(...lons)
      && longitude <= Math.max(...lons)
      && latitude >= Math.min(...lats)
      && latitude <= Math.max(...lats)
    ) {
      return summarizeAlert(alert);
    }
  }
  return null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildFeatureTooltipHtml(object: any, layerId: string): string | null {
  // Native deck.gl AlertFeature / Observation objects (alerts, stations) carry
  // typed fields; pure GeoJSON features carry a `properties` bag. Handle both.

  // Alert object (createAlertPolygonLayer / createAlertMarkerLayer)
  if (object?.event && object?.severity && object?.headline) {
    const event = escapeHtml(object.event);
    const sev = escapeHtml(object.severity).toUpperCase();
    const head = escapeHtml(object.headline);
    const expires = object.expires_at
      ? `<div style="opacity:.7;margin-top:4px">expires ${escapeHtml(new Date(object.expires_at).toLocaleString())}</div>`
      : "";
    const desc = (object.description ?? "").trim();
    const descHtml = desc && desc !== object.headline
      ? `<div style="margin-top:6px;opacity:.85;font-size:10.5px">${escapeHtml(desc.length > 320 ? `${desc.slice(0, 318).trimEnd()}…` : desc)}</div>`
      : "";
    return `<div style="font-weight:600">[${sev}] ${event}</div>
<div style="opacity:.95;margin-top:2px">${head}</div>
${descHtml}${expires}`;
  }

  // Marker payload from createAlertMarkerLayer: { alert, centroid }
  if (object?.alert) return buildFeatureTooltipHtml(object.alert, layerId);

  // Observation (createStationLayer)
  if (object?.station_id && object?.station_name) {
    const name = escapeHtml(object.station_name);
    const sid = escapeHtml(object.station_id);
    const observed = object.observed_at
      ? `<div style="opacity:.7;margin-top:2px">${escapeHtml(new Date(object.observed_at).toLocaleString())}</div>`
      : "";
    const values = object.values ?? {};
    const units = object.units ?? {};
    const rows = Object.keys(values).slice(0, 6).map((key) => {
      const u = units[key] ? ` ${escapeHtml(units[key])}` : "";
      return `<div>${escapeHtml(key)}: <strong>${escapeHtml(values[key])}</strong>${u}</div>`;
    }).join("");
    return `<div style="font-weight:600">${name}</div>
<div style="opacity:.7">${sid}</div>${observed}${rows ? `<div style="margin-top:4px">${rows}</div>` : ""}`;
  }

  // Generic OGC GeoJSON feature with our `_display_*` enrichment.
  const props = object?.properties ?? object?.object?.properties ?? object;
  if (props && typeof props === "object") {
    const title = props._display_title ?? props.name ?? props.NAME ?? props.title;
    const subtitle = props._display_subtitle;
    const body = props._display_body;
    if (title || subtitle || body) {
      const parts: string[] = [];
      if (title) parts.push(`<div style="font-weight:600">${escapeHtml(title)}</div>`);
      if (subtitle) parts.push(`<div style="opacity:.9">${escapeHtml(subtitle)}</div>`);
      if (body) parts.push(`<div style="opacity:.8;margin-top:3px;font-size:10.5px">${escapeHtml(body)}</div>`);
      if (props._canwxlab_collection_id) {
        parts.push(`<div style="opacity:.55;margin-top:4px;font-size:9.5px">${escapeHtml(props._canwxlab_collection_id)}</div>`);
      }
      return parts.join("\n");
    }
  }

  return null;
}

function summarizeAlert(alert: AlertFeature): string {
  const severity = alert.severity && alert.severity !== "unknown"
    ? alert.severity.toUpperCase()
    : null;
  const head = alert.headline?.trim() || alert.event?.trim() || "Weather alert";
  const expiresPart = alert.expires_at
    ? ` · expires ${new Date(alert.expires_at).toLocaleString()}`
    : "";
  const descSrc = (alert.description ?? "").trim();
  const desc = descSrc.length > 220 ? `${descSrc.slice(0, 218).trimEnd()}…` : descSrc;
  const headLine = severity ? `[${severity}] ${head}` : head;
  return desc && desc !== head ? `${headLine}${expiresPart}\n${desc}` : `${headLine}${expiresPart}`;
}

function flattenPoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (
    value.length === 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
  ) {
    return [[value[0], value[1]]];
  }
  return value.flatMap((item) => flattenPoints(item));
}

function nearestObservation(
  observations: Observation[],
  longitude: number,
  latitude: number,
): Observation | null {
  let nearest: Observation | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const observation of observations) {
    const distance = Math.hypot(observation.longitude - longitude, observation.latitude - latitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = observation;
    }
  }

  return nearest;
}

function nearestStationName(
  observations: Observation[],
  longitude: number,
  latitude: number,
): string | null {
  const nearest = nearestObservation(observations, longitude, latitude);
  return nearest ? `${nearest.station_name} (${nearest.station_id})` : null;
}

function sampleValues(
  longitude: number,
  latitude: number,
  frame: number,
  activeLayers: LayerDefinition[],
  observations: Observation[],
): RendererFeatureValue[] {
  const sampled = sampleMockWeatherPoint(longitude, latitude, frame);
  const values: RendererFeatureValue[] = [];

  if (activeLayers.some((layer) => layer.id === "demo_temperature_field" || layer.id === "mock_temperature")) {
    values.push({
      label: "Temperature",
      value: sampled.temperatureC.toFixed(1),
      unit: "degC",
      status: "mock",
    });
  }
  if (activeLayers.some((layer) => layer.id === "demo_pressure_msl" || layer.variable === "pressure_msl")) {
    values.push({
      label: "MSLP",
      value: sampled.pressureHpa.toFixed(1),
      unit: "hPa",
      status: "mock",
    });
  }
  if (activeLayers.some((layer) => layer.id === "demo_radar_animation" || layer.id === "mock_radar")) {
    values.push({
      label: "Precipitation",
      value: sampled.precipitationRate.toFixed(2),
      unit: "mm/h",
      status: "mock",
    });
  }
  if (activeLayers.some((layer) => layer.id === "demo_wind_particles" || layer.id === "mock_wind")) {
    values.push({
      label: "Wind Speed",
      value: sampled.windSpeed.toFixed(1),
      unit: "m/s",
      status: "mock",
    });
    values.push({
      label: "Wind Vector",
      value: `${sampled.windU.toFixed(1)}, ${sampled.windV.toFixed(1)}`,
      unit: "u/v",
      status: "mock",
    });
  }
  if (activeLayers.some((layer) => layer.id === "demo_clouds")) {
    values.push({
      label: "Cloud Opacity",
      value: sampled.cloudOpacity.toFixed(2),
      unit: "ratio",
      status: "mock",
    });
  }

  const nearest = nearestObservation(observations, longitude, latitude);
  if (nearest) {
    const stationValues: Array<[string, string, string]> = [
      ["temperature_2m", "Station Temperature", "degC"],
      ["pressure_msl", "Station MSLP", "hPa"],
      ["wind_speed_10m", "Station Wind", "m/s"],
    ];
    for (const [key, label, fallbackUnit] of stationValues) {
      const raw = nearest.values[key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
      values.push({
        label,
        value: raw.toFixed(key === "pressure_msl" ? 1 : 1),
        unit: nearest.units[key] ?? fallbackUnit,
        status: nearest.source_status,
      });
    }
  }

  return values;
}

export function MapView({
  layers,
  layerState,
  observations,
  alerts,
  viewMode,
  animationFrame,
  onInspect,
  onDiagnostics,
  onGlobeSupportDetected,
  cameraTarget,
  onCameraChange,
  globalTimeMs,
  basemap,
  photorealisticGlobe,
  diffOverlay,
  starExposure,
  starMaxDistanceLy,
  timelinePlaying,
  timelineSpeedMultiplier,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markerRefs = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [contextMenu, setContextMenu] = useState<MapContextMenuState | null>(null);
  const [nearestStationDetailsEnabled, setNearestStationDetailsEnabled] = useState(true);
  const lastFrameAtRef = useRef<number>(performance.now());
  const viewModeRef = useRef<ViewMode>(viewMode);
  const activeLayersRef = useRef<LayerDefinition[]>([]);
  const renderPlanRef = useRef<RenderLayerPlan[]>([]);
  const animationFrameRef = useRef<number>(animationFrame);
  const observationsRef = useRef<Observation[]>(observations);
  const alertsRef = useRef<AlertFeature[]>(alerts);
  const [ogcFeaturesByLayer, setOgcFeaturesByLayer] = useState<Record<string, OgcFeatureCollection>>({});

  const onInspectRef = useRef(onInspect);
  const onGlobeSupportDetectedRef = useRef(onGlobeSupportDetected);
  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => { onInspectRef.current = onInspect; });
  useEffect(() => { onGlobeSupportDetectedRef.current = onGlobeSupportDetected; });
  useEffect(() => { onCameraChangeRef.current = onCameraChange; });

  // Live camera + time refs for the celestial starfield (avoids React re-renders on every drag frame).
  const liveCameraRef = useRef<CameraState | null>(null);
  const liveTimeRef = useRef<number>(globalTimeMs || Date.now());
  const starTimelineAnchorRef = useRef({
    simMs: globalTimeMs || Date.now(),
    perfMs: typeof performance !== "undefined" ? performance.now() : 0,
  });
  useEffect(() => {
    starTimelineAnchorRef.current = {
      simMs: globalTimeMs || Date.now(),
      perfMs: performance.now(),
    };
    liveTimeRef.current = globalTimeMs || Date.now();
  }, [globalTimeMs]);

  useEffect(() => {
    let raf = 0;
    const updateSmoothTime = () => {
      const anchor = starTimelineAnchorRef.current;
      if (timelinePlaying) {
        // The weather timeline advances one 5-minute frame every ~1 s at 1x.
        // Keep the star sphere moving at the same simulated rate between discrete frame changes.
        const simulatedRate = 300 * Math.max(0.25, timelineSpeedMultiplier);
        liveTimeRef.current = anchor.simMs + (performance.now() - anchor.perfMs) * simulatedRate;
      } else {
        liveTimeRef.current = anchor.simMs;
      }
      raf = requestAnimationFrame(updateSmoothTime);
    };
    raf = requestAnimationFrame(updateSmoothTime);
    return () => cancelAnimationFrame(raf);
  }, [timelinePlaying, timelineSpeedMultiplier]);

  // Last-frame star projections (CSS-pixel space) for click hit-testing.
  const starProjectionsRef = useRef<StarProjection[]>([]);
  const [selectedStar, setSelectedStar] = useState<Star | null>(null);

  // ORBITAL-TODO: Auto-transition to OrbitalView when zoom drops below ~0. The MapLibre
  //   globe runs out of meaningful basemap below zoom 2; below zoom 0 we should hide MapLibre,
  //   mount a WebGL <OrbitalView> sibling, and interpolate the camera basis from ECEF-north-up
  //   into ecliptic-J2000-z-up. See docs/cosmic-scope-roadmap.md §6.
  // ORBITAL-TODO: Wire middle-click drag to pan-in-current-plane in OrbitalView. MapLibre's
  //   default middle-click is unused; intercept on the container element before MapLibre sees it.
  // ORBITAL-TODO: Right-click context menu: "Lock to orbital plane (temporary)", "Focus",
  //   "Show info", "Add to verification". Should be a separate component so map-mode and
  //   orbital-mode can share it.
  // ORBITAL-TODO: Render Sun position + sub-solar terminator overlay on the Earth globe.
  //   Sun position comes from /api/cosmic/ephemeris (Horizons-backed). Terminator is a
  //   great-circle 90° from the sub-solar point — draw with deck.gl GeoJsonLayer.
  void starProjectionsRef;
  void selectedStar;
  void setSelectedStar;

  const activeLayers = useMemo(
    () => layers.filter((layer) => {
      if (!layerState[layer.id]?.enabled) return false;
      if (viewMode === "globe" && !layer.capabilities.supportsGlobe) return false;
      return true;
    }),
    [layers, layerState, viewMode],
  );

  const renderPlan = useMemo(
    () => buildRenderPlan({
      layers: activeLayers,
      runtimeState: layerState,
      globalTimeMs,
      viewMode,
    }),
    [activeLayers, globalTimeMs, layerState, viewMode],
  );

  const genericOgcLayerIds = useMemo(
    () =>
      activeLayers
        .filter((layer) => {
          if (layer.serviceType !== "ogc_api") return false;
          if (NORMALIZED_ALERT_LAYER_IDS.has(layer.id)) return false;
          if (NORMALIZED_OBSERVATION_LAYER_IDS.has(layer.id)) return false;
          return true;
        })
        .map((layer) => layer.id)
        .sort(),
    [activeLayers],
  );

  useEffect(() => {
    let cancelled = false;

    if (genericOgcLayerIds.length === 0) {
      setOgcFeaturesByLayer({});
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      genericOgcLayerIds.map(async (layerId) => {
        try {
          return [layerId, await api.ogcLayerFeatures(layerId, { limit: 500 })] as const;
        } catch {
          return [
            layerId,
            { type: "FeatureCollection", features: [] } as OgcFeatureCollection,
          ] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setOgcFeaturesByLayer(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [genericOgcLayerIds.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { activeLayersRef.current = activeLayers; }, [activeLayers]);
  useEffect(() => { renderPlanRef.current = renderPlan; }, [renderPlan]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { animationFrameRef.current = animationFrame; }, [animationFrame]);
  useEffect(() => { observationsRef.current = observations; }, [observations]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  function sampleCompositeRgb(point?: [number, number]): [number, number, number] | null {
    const map = mapRef.current;
    if (!map || !point) return null;
    try {
      const canvas = map.getCanvas();
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const scaleX = canvas.width / Math.max(1, canvas.clientWidth);
      const scaleY = canvas.height / Math.max(1, canvas.clientHeight);
      const x = Math.round(point[0] * scaleX);
      const y = Math.round(canvas.height - point[1] * scaleY);
      const pixel = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      if (pixel[3] === 0 && pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) return null;
      return [pixel[0], pixel[1], pixel[2]];
    } catch {
      return null;
    }
  }

  function inspectAtLocation(longitude: number, latitude: number, point?: [number, number]) {
    const payload = buildInspectorPayload({
      longitude,
      latitude,
      frame: animationFrameRef.current,
      activeLayers: activeLayersRef.current,
      renderPlan: renderPlanRef.current,
      observations: observationsRef.current,
      alerts: alertsRef.current,
      sampledRgb: sampleCompositeRgb(point),
      sampledAtMs: liveTimeRef.current,
    });
    onInspectRef.current(nearestStationDetailsEnabled ? payload : { ...payload, nearestStation: null });
  }

  function inspectLayerStackAt(longitude: number, latitude: number, point?: [number, number]) {
    const payload = buildInspectorPayload({
      longitude,
      latitude,
      frame: animationFrameRef.current,
      activeLayers: activeLayersRef.current,
      renderPlan: renderPlanRef.current,
      observations: observationsRef.current,
      alerts: alertsRef.current,
      sampledRgb: sampleCompositeRgb(point),
      sampledAtMs: liveTimeRef.current,
    });
    const stack = renderPlanRef.current
      .filter((plan) => plan.visible)
      .slice()
      .sort((a, b) => b.order - a.order)
      .map((plan, index) => `${index + 1}. ${plan.source.title}`)
      .join(" | ");
    onInspectRef.current({
      ...payload,
      values: [
        {
          label: "Layer Stack",
          value: stack || "no active render layers",
          status: "derived",
        },
        ...payload.values,
      ],
    });
  }

  function centerMapAt(longitude: number, latitude: number) {
    const map = mapRef.current;
    if (!map) return;
    const target = normalizeCameraState({
      longitude,
      latitude,
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch(),
    }, viewModeRef.current);
    map.easeTo({ center: [target.longitude, target.latitude], bearing: target.bearing, pitch: target.pitch, duration: 350, essential: true });
  }

  function resetMapView() {
    const map = mapRef.current;
    if (!map) return;
    const target = normalizeCameraState({ longitude: -35, latitude: 20, zoom: 1.6, bearing: 0, pitch: 0 }, viewModeRef.current);
    map.easeTo({
      center: [target.longitude, target.latitude],
      zoom: target.zoom,
      bearing: target.bearing,
      pitch: target.pitch,
      duration: 450,
      essential: true,
    });
  }

  function copyCoordinates(longitude: number, latitude: number) {
    const text = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    void navigator.clipboard?.writeText(text);
  }

  function addPinMarker(longitude: number, latitude: number) {
    const map = mapRef.current;
    if (!map) return;
    const marker = new maplibregl.Marker({ color: "#58d0bf" })
      .setLngLat([normalizeLongitude(longitude), clamp(latitude, -85, 85)])
      .addTo(map);
    markerRefs.current.push(marker);
  }

  const deckLayers = useMemo(() => {
    const list: any[] = [];
    const getRuntime = (layerId: string) => layerState[layerId];
    // Globe projection: polygon grids are converted to point fields because large
    // tessellated overlays can tear across wrap/projection boundaries on MapLibre globe.
    const useGlobePointFields = viewMode === "globe";

    const temperatureLayer = activeLayers.find((layer) =>
      layer.id === "demo_temperature_field" || layer.id === "mock_temperature"
    );
    if (temperatureLayer) {
      const runtime = getRuntime(temperatureLayer.id);
      if (runtime) {
        const data = createTemperatureGrid(animationFrame);
        list.push(useGlobePointFields
          ? createDeckPointFieldLayer({
              id: "demo-temperature-points",
              data,
              valueKey: "temperature",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
              radiusMeters: 95_000,
            })
          : createDeckGridLayer({
              id: "demo-temperature-grid",
              data,
              valueKey: "temperature",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
            }));
      }
    }

    const pressureLayer = activeLayers.find((layer) =>
      layer.id === "demo_pressure_msl"
    );
    if (pressureLayer) {
      const runtime = getRuntime(pressureLayer.id);
      if (runtime) {
        const data = createPressureGrid(animationFrame);
        list.push(useGlobePointFields
          ? createDeckPointFieldLayer({
              id: "demo-pressure-points",
              data,
              valueKey: "pressure",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
              radiusMeters: 190_000,
            })
          : createDeckGridLayer({
              id: "demo-pressure-grid",
              data,
              valueKey: "pressure",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
            }));
      }
    }

    const radarLayer = activeLayers.find((layer) =>
      layer.id === "demo_radar_animation" || layer.id === "mock_radar"
    );
    if (radarLayer) {
      const runtime = getRuntime(radarLayer.id);
      if (runtime) {
        const radarData = createRadarBlobs(animationFrame);
        radarData.features.forEach((feature: any) => {
          feature.properties.precip *= runtime.controls.precipitationIntensity;
        });
        list.push(useGlobePointFields
          ? createDeckPointFieldLayer({
              id: "demo-radar-points",
              data: radarData,
              valueKey: "precip",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
              radiusMeters: 135_000,
            })
          : createDeckGridLayer({
              id: "demo-radar-grid",
              data: radarData,
              valueKey: "precip",
              runtime,
              min: runtime.controls.min,
              max: runtime.controls.max,
            }));
      }
    }

    const cloudLayer = activeLayers.find((layer) => layer.id === "demo_clouds");
    if (cloudLayer) {
      const runtime = getRuntime(cloudLayer.id);
      if (runtime) {
        const data = createCloudOverlay(animationFrame);
        const cloudRuntime = { ...runtime, opacity: runtime.controls.cloudOpacity };
        list.push(useGlobePointFields
          ? createDeckPointFieldLayer({
              id: "demo-cloud-points",
              data,
              valueKey: "cloudOpacity",
              runtime: cloudRuntime,
              min: runtime.controls.min,
              max: runtime.controls.max,
              radiusMeters: 125_000,
            })
          : createDeckGridLayer({
              id: "demo-cloud-grid",
              data,
              valueKey: "cloudOpacity",
              runtime: cloudRuntime,
              min: runtime.controls.min,
              max: runtime.controls.max,
            }));
      }
    }

    const windLayer = activeLayers.find((layer) =>
      layer.id === "demo_wind_particles" || layer.id === "mock_wind"
    );
    if (windLayer) {
      const runtime = getRuntime(windLayer.id);
      if (runtime) {
        list.push(createDeckParticleLayer({
          id: "demo-wind-particles",
          particles: createWindParticles(
            animationFrame,
            runtime.controls.particleCount,
            runtime.controls.windScale,
          ),
          runtime,
        }));
      }
    }

    const alertLayer = activeLayers.find((layer) => NORMALIZED_ALERT_LAYER_IDS.has(layer.id));
    if (alertLayer) {
      const runtime = getRuntime(alertLayer.id);
      if (runtime) {
        list.push(useGlobePointFields
          ? createAlertMarkerLayer({ id: "alerts-globe-markers", alerts, runtime })
          : createAlertPolygonLayer({ id: "alerts", alerts, runtime }));
      }
    }

    const stationLayer = activeLayers.find((layer) => NORMALIZED_OBSERVATION_LAYER_IDS.has(layer.id));
    if (stationLayer) {
      const runtime = getRuntime(stationLayer.id);
      if (runtime) list.push(createStationLayer({ id: "stations", observations, runtime }));
    }

    activeLayers
      .filter((layer) => genericOgcLayerIds.includes(layer.id))
      .forEach((layer) => {
        const runtime = getRuntime(layer.id);
        const data = ogcFeaturesByLayer[layer.id];
        if (!runtime || !data) return;
        list.push(createOgcFeatureLayer({
          id: `ogc-${layer.id}`,
          layer,
          data,
          runtime,
          globeSafe: viewMode === "globe",
        }));
      });

    const simLayer = activeLayers.find((layer) => layer.id === "canwxsim_output");
    if (simLayer && layerState[simLayer.id] && viewMode !== "globe") {
      list.push(new GeoJsonLayer({
        id: "canwxsim-domain",
        data: {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: { label: "CanWxSim domain" },
            geometry: {
              type: "Polygon",
              coordinates: [[[-119, 49], [-107, 49], [-107, 56], [-119, 56], [-119, 49]]],
            },
          }],
        } as any,
        filled: true,
        stroked: true,
        getFillColor: [130, 255, 210, Math.round(70 * layerState[simLayer.id].opacity)],
        getLineColor: [130, 255, 210, 240],
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        lineWidthMinPixels: 1.25,
        lineWidthMaxPixels: 2,
        parameters: { depthTest: false },
      }));
    }

    if (diffOverlay && viewMode !== "globe") {
      const bmp = createDiffBitmapLayer(diffOverlay);
      if (bmp) list.push(bmp);
    }

    // TIMELINE-TODO: Add a shader/canvas day-night globe overlay driven by ephemeris-backed
    // solar geometry. Do not use a deck.gl world-scale PolygonLayer on globe projection: it
    // triangulates across wrap boundaries and can produce visible triangular tearing.

    return list;
  }, [
    activeLayers,
    alerts,
    animationFrame,
    layerState,
    observations,
    viewMode,
    diffOverlay,
    genericOgcLayerIds,
    ogcFeaturesByLayer,
  ]);
  const basemapDateKey = useMemo(() => ymdUtcMinusDays(globalTimeMs, 1), [globalTimeMs]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyle(basemap, globalTimeMs),
      center: [-35, 20],
      zoom: 1.6,
      minZoom: -6,
      maxZoom: 18,
      renderWorldCopies: true,
      refreshExpiredTiles: false,
      fadeDuration: 0,
      maxTileCacheSize: 768,
      pixelRatio: renderPixelRatio(),
      attributionControl: false,
    });
    map.dragRotate.disable();
    (map.touchZoomRotate as any)?.disableRotation?.();

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (typeof (maplibregl as any).GlobeControl === "function") {
      map.addControl(new (maplibregl as any).GlobeControl(), "top-right");
    }
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    // interleaved:false renders deck.gl in a single pass entirely on top of
    // MapLibre. This is the only way to guarantee zero z-fighting between
    // basemap tiles and overlays, especially in globe projection where the
    // basemap is drawn as a textured sphere with a depth buffer that deck.gl
    // would otherwise compete with. Overlays internally use depthTest:false
    // so they layer cleanly against each other in declaration order.
    const overlay = new MapboxOverlay({
      layers: [],
      interleaved: false,
      useDevicePixels: renderPixelRatio(),
      getTooltip: ({ object, layer }: any) => {
        if (!object) return null;
        const html = buildFeatureTooltipHtml(object, layer?.id ?? "");
        if (!html) return null;
        return {
          html,
          style: {
            background: "rgba(10, 13, 20, 0.92)",
            color: "#e6eef8",
            font: "11px/1.4 ui-sans-serif, system-ui",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid rgba(255,255,255,0.12)",
            maxWidth: "320px",
            pointerEvents: "none",
            whiteSpace: "pre-wrap",
          },
        };
      },
    });
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("click", (event) => {
      setContextMenu(null);
      // Star hit-test first: stars are drawn on a sibling canvas with pointer-events: none,
      // so we test against the last frame's projections (CSS-pixel space).
      const hitRadius = 14; // px
      const px = event.point.x;
      const py = event.point.y;
      const projections = starProjectionsRef.current;
      if (projections && projections.length > 0) {
        let best: { dist: number; star: Star } | null = null;
        for (const p of projections) {
          const dx = p.cssX - px;
          const dy = p.cssY - py;
          const d = Math.hypot(dx, dy);
          if (d < hitRadius && (!best || d < best.dist)) best = { dist: d, star: p.star };
        }
        if (best) {
          setSelectedStar(best.star);
          return; // suppress normal inspect
        }
      }
      const longitude = event.lngLat.lng;
      const latitude = event.lngLat.lat;
      inspectAtLocation(longitude, latitude, [event.point.x, event.point.y]);
    });

    map.on("load", () => {
      setMapReady(true);
      onGlobeSupportDetectedRef.current(true);
    });

    const updateLiveCamera = () => {
      liveCameraRef.current = normalizeCameraState({
        longitude: map.getCenter().lng,
        latitude: map.getCenter().lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      }, viewModeRef.current);
      // ORBITAL-TODO: Feed liveCameraRef.zoom into cosmicScaleFromZoom() and, when the
      // scale crosses out of `surface`/`globe`, mount the future <OrbitalView> sibling
      // and dim MapLibre. The transition must keep timeline time, not reset it.
    };
    updateLiveCamera();
    map.on("move", updateLiveCamera);
    map.on("moveend", () => {
      updateLiveCamera();
      onCameraChangeRef.current(liveCameraRef.current!);
    });

    const onMapContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      const rect = map.getCanvas().getBoundingClientRect();
      const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
      const lngLat = map.unproject(point);
      const clamped = clampContextMenuPosition(point[0], point[1], rect.width, rect.height);
      setContextMenu({
        x: clamped.x,
        y: clamped.y,
        longitude: lngLat.lng,
        latitude: lngLat.lat,
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") {
        setContextMenu(null);
        return;
      }
      const zoomBy = (delta: number) => {
        const target = normalizeCameraState({
          longitude: map.getCenter().lng,
          latitude: map.getCenter().lat,
          zoom: map.getZoom() + delta,
          bearing: map.getBearing(),
          pitch: map.getPitch(),
        }, viewModeRef.current);
        map.easeTo({ zoom: target.zoom, duration: 200, essential: true });
      };
      const panBy = (dx: number, dy: number) => {
        map.panBy([dx, dy], { duration: 180, essential: true });
      };
      switch (event.key) {
        case "+":
        case "=":
          event.preventDefault();
          zoomBy(0.6);
          break;
        case "-":
        case "_":
          event.preventDefault();
          zoomBy(-0.6);
          break;
        case "ArrowUp":
          event.preventDefault();
          panBy(0, -90);
          break;
        case "ArrowDown":
          event.preventDefault();
          panBy(0, 90);
          break;
        case "ArrowLeft":
          event.preventDefault();
          panBy(-90, 0);
          break;
        case "ArrowRight":
          event.preventDefault();
          panBy(90, 0);
          break;
        case "r":
        case "R": {
          event.preventDefault();
          const target = normalizeCameraState({ longitude: -35, latitude: 20, zoom: 1.6, bearing: 0, pitch: 0 }, viewModeRef.current);
          map.easeTo({
            center: [target.longitude, target.latitude],
            zoom: target.zoom,
            bearing: target.bearing,
            pitch: target.pitch,
            duration: 450,
            essential: true,
          });
          break;
        }
      }
    };

    const canvas = map.getCanvas();
    canvas.addEventListener("contextmenu", onMapContextMenu);
    window.addEventListener("keydown", onKeyDown);

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      canvas.removeEventListener("contextmenu", onMapContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      overlay.finalize();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mapRef.current && cameraTarget) {
      const target = normalizeCameraState(cameraTarget, viewModeRef.current);
      mapRef.current.flyTo({
        center: [target.longitude, target.latitude],
        zoom: target.zoom,
        bearing: target.bearing,
        pitch: target.pitch,
        duration: 1500,
        essential: true,
      });
    }
  }, [cameraTarget]);

  useEffect(() => {
    overlayRef.current?.setProps({ layers: deckLayers });
  }, [deckLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    onGlobeSupportDetectedRef.current(true);
    try {
      applyGlobePresentation(map, viewMode);
    } catch {
      // Projection switch can throw on older builds; safe to ignore.
    }
  }, [mapReady, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const next = getBasemapStyle(basemap, globalTimeMs);
    map.setStyle(next as any);
    const onStyle = () => {
      applyGlobePresentation(map, viewMode);
      syncWmsLayers({ map, renderPlan, isPlaying: timelinePlaying });
    };
    if (map.isStyleLoaded()) onStyle();
    else map.once("style.load", onStyle);
  }, [basemap, basemapDateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncWmsLayers({ map, renderPlan, isPlaying: timelinePlaying });
  }, [mapReady, renderPlan, timelinePlaying]);

  useEffect(() => {
    const now = performance.now();
    const delta = now - lastFrameAtRef.current;
    const fps = delta > 0 ? 1000 / delta : 0;
    lastFrameAtRef.current = now;
    const wmsTelemetry = getWmsRendererTelemetry(mapRef.current);

    onDiagnostics({
      fps,
      activeLayerCount: activeLayers.length,
      animatedLayerCount: activeLayers.filter((layer) => layer.capabilities.supportsAnimation).length,
      deckLayerCount: deckLayers.length,
      rendererKind: rendererKindForViewMode(viewMode),
      pendingRasterFrames: wmsTelemetry.pendingRasterFrames,
      promotedRasterFrames: wmsTelemetry.promotedRasterFrames,
      failedRasterFrames: wmsTelemetry.failedRasterFrames,
      lastSourceError: wmsTelemetry.lastSourceError,
      warnings: activeLayers
        .filter((layer) => viewMode === "globe" && !layer.capabilities.supportsGlobe)
        .map((layer) => `${layer.title} is map-only and may be hidden in globe mode.`),
    });
  }, [activeLayers, deckLayers, onDiagnostics, viewMode]);

  const showStarfield = viewMode === "globe" && photorealisticGlobe;
  return (
    <div className={`map-shell${showStarfield ? " has-starfield" : ""}`}>
      {showStarfield && <div className="map-starfield" aria-hidden="true" />}
      {showStarfield && (
        <Starfield
          cameraRef={liveCameraRef}
          timeRef={liveTimeRef}
          exposure={starExposure}
          maxDistanceLy={starMaxDistanceLy}
          maxFps={timelinePlaying ? 12 : 24}
          projectionsRef={starProjectionsRef}
        />
      )}
      {selectedStar && <StarInfoCard star={selectedStar} onClose={() => setSelectedStar(null)} />}
      <div ref={containerRef} className="map-container" />
      {contextMenu && (
        <>
          <div
            className="map-context-menu-scrim"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="map-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
            role="menu"
          >
            <div className="map-context-coords">
              {contextMenu.latitude.toFixed(4)}, {contextMenu.longitude.toFixed(4)}
            </div>
            <button type="button" role="menuitem" onClick={() => { inspectAtLocation(contextMenu.longitude, contextMenu.latitude, [contextMenu.x, contextMenu.y]); setContextMenu(null); }}>
              Inspect here
            </button>
            <button type="button" role="menuitem" onClick={() => { inspectLayerStackAt(contextMenu.longitude, contextMenu.latitude, [contextMenu.x, contextMenu.y]); setContextMenu(null); }}>
              Show active layer stack
            </button>
            <button type="button" role="menuitem" onClick={() => { setNearestStationDetailsEnabled((value) => !value); setContextMenu(null); }}>
              {nearestStationDetailsEnabled ? "Hide nearest-station details" : "Show nearest-station details"}
            </button>
            <div className="map-context-divider" />
            <button type="button" role="menuitem" onClick={() => { centerMapAt(contextMenu.longitude, contextMenu.latitude); setContextMenu(null); }}>
              Center view here
            </button>
            <button type="button" role="menuitem" onClick={() => { resetMapView(); setContextMenu(null); }}>
              Reset global view <span className="map-context-shortcut">R</span>
            </button>
            <div className="map-context-divider" />
            <button type="button" role="menuitem" onClick={() => { copyCoordinates(contextMenu.longitude, contextMenu.latitude); setContextMenu(null); }}>
              Copy coordinates
            </button>
            <button type="button" role="menuitem" onClick={() => { addPinMarker(contextMenu.longitude, contextMenu.latitude); setContextMenu(null); }}>
              Pin marker
            </button>
          </div>
        </>
      )}
      <div className="map-badge">
        <span>{viewMode}</span>
        <span>{activeLayers.length} active</span>
      </div>
    </div>
  );
}
