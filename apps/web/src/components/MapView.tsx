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
import {
  createAlertMarkerLayer,
  createAlertPolygonLayer,
  createOgcFeatureLayer,
  createStationLayer,
} from "../layers/renderers/deckVector";
import { getWmsRendererTelemetry, syncWmsLayers } from "../layers/renderers/maplibreRaster";
import { buildInspectorPayload, type InspectorWmsRow } from "../layers/inspection";
import { buildRenderPlan, rendererKindForViewMode } from "../layers/renderPlan";
import type { BasemapId } from "./LayersPicker";
import { Starfield, type StarProjection } from "./Starfield";
import { StarInfoCard } from "./StarInfoCard";
import type { Star } from "../lib/celestialSphere";
import type { StarExposure } from "../layers/types";
import { createDiffBitmapLayer, type DiffOverlayPayload } from "../layers/renderers/diffBitmap";
import { createSatelliteCompositeLayer, getSatelliteDiskParams, isGeostationarySatellite } from "../layers/renderers/satelliteComposite";
import { detectPressureSystems } from "../layers/pressureSystems";
import { createPressureSystemLayers } from "../layers/renderers/pressureSystemMarkers";

interface MapInspectPayload {
  longitude: number;
  latitude: number;
  values: RendererFeatureValue[];
  heroMetrics: import("../layers/inspection").HeroMetric[];
  pressureSystems: import("../layers/pressureSystems").PressureSystem[];
  wmsLayerRows: InspectorWmsRow[];
  nearestStation: string | null;
  nearestStationKm: number | null;
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
  subFrameProgress?: number;
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
  onCanvasReady?: (canvas: HTMLCanvasElement) => void;
}

interface BasemapPreset {
  id: BasemapId;
  style: StyleSpecification;
}

const NORMALIZED_ALERT_LAYER_IDS = new Set(["eccc_weather_alerts"]);
const NORMALIZED_OBSERVATION_LAYER_IDS = new Set([
  "eccc_climate_stations",
  "eccc_climate_hourly",
]);
// Performance cap. 2.0 would render 4× the pixels on a Retina display which
// crushes mid-range GPUs when multiple WMS rasters and deck overlays are
// active simultaneously. 1.5 keeps text crisp without exploding fill cost.
const MAX_RENDER_PIXEL_RATIO = 1.5;

function renderPixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_RENDER_PIXEL_RATIO));
}

/**
 * Compact signature of the WMS-relevant slice of a render plan. The WMS sync
 * pass only needs to fire when one of these fields actually changes; the full
 * plan reference flips on every `globalTimeMs` tick, which is far too often.
 */
function wmsSyncSignature(plan: RenderLayerPlan[]): string {
  let acc = "";
  for (const entry of plan) {
    if (entry.rendererType !== "wms-raster") continue;
    acc += `${entry.id}|${entry.visible ? 1 : 0}|${entry.opacity.toFixed(3)}|${entry.timePolicy}|${entry.resolvedTime ?? ""}|${entry.source.wmsBaseUrl ?? ""}|${entry.source.wmsLayerName ?? ""};`;
  }
  return acc;
}

function normalizeLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return 0;
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function viewportBboxParam(map: maplibregl.Map): string | null {
  const bounds = map.getBounds();
  const west = clamp(bounds.getWest(), -180, 180);
  const south = clamp(bounds.getSouth(), -90, 90);
  const east = clamp(bounds.getEast(), -180, 180);
  const north = clamp(bounds.getNorth(), -90, 90);
  const minLon = Math.min(west, east);
  const maxLon = Math.max(west, east);
  const minLat = Math.min(south, north);
  const maxLat = Math.max(south, north);
  if (maxLon - minLon < 0.001 || maxLat - minLat < 0.001) return null;
  return [minLon, minLat, maxLon, maxLat].map((part) => part.toFixed(4)).join(",");
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
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
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
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
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
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
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

function basemapUsesTimelineDate(id: BasemapId): boolean {
  return id === "gibs_truecolor" || id === "gibs_viirs";
}

function basemapStyleKey(id: BasemapId, timeMs: number): string {
  const dateKey = basemapUsesTimelineDate(id) ? ymdUtcMinusDays(timeMs, 1) : "static";
  return `${id}:${dateKey}`;
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

export function MapView({
  layers,
  layerState,
  observations,
  alerts,
  viewMode,
  animationFrame,
  subFrameProgress,
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
  onCanvasReady,
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
  const lastBasemapStyleKeyRef = useRef<string | null>(null);
  const [ogcFeaturesByLayer, setOgcFeaturesByLayer] = useState<Record<string, OgcFeatureCollection>>({});
  const [visibleBbox, setVisibleBbox] = useState<string | null>(null);

  const onInspectRef = useRef(onInspect);
  const onGlobeSupportDetectedRef = useRef(onGlobeSupportDetected);
  const onDiagnosticsRef = useRef(onDiagnostics);
  const prevDiagnosticsRef = useRef<string>("");
  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => { onInspectRef.current = onInspect; });
  useEffect(() => { onGlobeSupportDetectedRef.current = onGlobeSupportDetected; });
  useEffect(() => { onDiagnosticsRef.current = onDiagnostics; });
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
    if (!visibleBbox) {
      setOgcFeaturesByLayer({});
      return () => {
        cancelled = true;
      };
    }

    Promise.all(
      genericOgcLayerIds.map(async (layerId) => {
        try {
          return [layerId, await api.ogcLayerFeatures(layerId, { bbox: visibleBbox, limit: 250 })] as const;
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
  }, [genericOgcLayerIds.join("|"), visibleBbox]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const mapped: MapInspectPayload = {
      longitude: payload.longitude,
      latitude: payload.latitude,
      values: payload.values,
      heroMetrics: payload.heroMetrics,
      pressureSystems: payload.pressureSystems,
      wmsLayerRows: payload.wmsLayers,
      nearestStation: nearestStationDetailsEnabled ? payload.nearestStation : null,
      nearestStationKm: nearestStationDetailsEnabled ? payload.nearestStationKm : null,
      activeAlert: payload.activeAlert,
    };
    onInspectRef.current(mapped);
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
    const mapped: MapInspectPayload = {
      longitude: payload.longitude,
      latitude: payload.latitude,
      values: [
        { label: "Layer Stack", value: stack || "no active render layers", status: "derived" },
        ...payload.values,
      ],
      heroMetrics: payload.heroMetrics,
      pressureSystems: payload.pressureSystems,
      wmsLayerRows: payload.wmsLayers,
      nearestStation: payload.nearestStation,
      nearestStationKm: payload.nearestStationKm,
      activeAlert: payload.activeAlert,
    };
    onInspectRef.current(mapped);
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

  // ── Static deck layers (do NOT depend on animationFrame) ──────────────────
  // These are memoised separately so station markers, alert polygons, and OGC
  // feature layers survive across frame ticks without WebGL teardown/rebuild.
  // Animated raster/satellite layers are handled by their dedicated renderers.
  const staticDeckLayers = useMemo(() => {
    const list: any[] = [];
    const getRuntime = (layerId: string) => layerState[layerId];
    const useGlobePointFields = viewMode === "globe";

    try {
      const alertLayer = activeLayers.find((layer) => NORMALIZED_ALERT_LAYER_IDS.has(layer.id));
      if (alertLayer) {
        const runtime = getRuntime(alertLayer.id);
        if (runtime) {
          list.push(useGlobePointFields
            ? createAlertMarkerLayer({ id: "alerts-globe-markers", alerts, runtime })
            : createAlertPolygonLayer({ id: "alerts", alerts, runtime }));
        }
      }
    } catch (err) {
      console.warn("[MapView] Failed to create alert layers:", err);
    }

    try {
      const stationLayer = activeLayers.find((layer) => NORMALIZED_OBSERVATION_LAYER_IDS.has(layer.id));
      if (stationLayer) {
        const runtime = getRuntime(stationLayer.id);
        if (runtime) list.push(createStationLayer({ id: "stations", observations, runtime }));
      }
    } catch (err) {
      console.warn("[MapView] Failed to create station layer:", err);
    }

    activeLayers
      .filter((layer) => genericOgcLayerIds.includes(layer.id))
      .forEach((layer) => {
        try {
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
        } catch (err) {
          console.warn(`[MapView] Failed to create OGC layer ${layer.id}:`, err);
        }
      });

    try {
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
    } catch (err) {
      console.warn("[MapView] Failed to create sim domain layer:", err);
    }

    try {
      if (diffOverlay && viewMode !== "globe") {
        const bmp = createDiffBitmapLayer(diffOverlay);
        if (bmp) list.push(bmp);
      }
    } catch (err) {
      console.warn("[MapView] Failed to create diff overlay layer:", err);
    }

    try {
      const stationLayerActive = activeLayers.some((layer) => NORMALIZED_OBSERVATION_LAYER_IDS.has(layer.id));
      if (stationLayerActive && observations.length > 0) {
        const systems = detectPressureSystems(observations);
        list.push(...createPressureSystemLayers(systems));
      }
    } catch (err) {
      console.warn("[MapView] Failed to create pressure system layers:", err);
    }

    return list;
  }, [activeLayers, alerts, layerState, observations, viewMode, diffOverlay, genericOgcLayerIds, ogcFeaturesByLayer]);

  // ── Satellite GPU compositor ───────────────────────────────────────────
  // Replaces the old black-ellipse GeoJsonLayer edge masks with a proper
  // WebGL multi-texture shader. Configs are derived from the render plan so
  // the compositor always has the latest WMS URL templates (which carry the
  // resolved timeline time). A signature string prevents needless re-creation
  // on every animation frame tick — the layer instance is stable as long as
  // the satellite URLs, visibility, and opacity don't change.
  const satelliteSignature = useMemo(() => {
    let acc = "";
    for (const plan of renderPlan) {
      if (plan.rendererType !== "wms-raster" || !isGeostationarySatellite(plan.id)) continue;
      acc += `${plan.id}|${plan.visible ? 1 : 0}|${plan.opacity.toFixed(3)}|${plan.source.urlTemplate ?? ""};`;
    }
    return acc;
  }, [renderPlan]);

  const satelliteCompositeLayer = useMemo(() => {
    const configs = renderPlan
      .filter((plan) => plan.visible && plan.rendererType === "wms-raster" && isGeostationarySatellite(plan.id))
      .map((plan) => {
        const params = getSatelliteDiskParams(plan.id);
        if (!params) return null;
        return {
          id: plan.id,
          subPoint: params.subPoint,
          coverageRadiusDeg: params.coverageRadiusDeg,
          featherRadiusDeg: params.featherRadiusDeg,
          wmsUrlTemplate: plan.source.urlTemplate ?? "",
          opacity: plan.opacity,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (configs.length === 0) return null;
    return createSatelliteCompositeLayer({ satellites: configs, timeProgress: subFrameProgress ?? 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satelliteSignature, subFrameProgress]);

  const deckLayers = useMemo(
    () => [...staticDeckLayers, satelliteCompositeLayer].filter(Boolean),
    [staticDeckLayers, satelliteCompositeLayer],
  );
  const currentBasemapStyleKey = useMemo(
    () => basemapStyleKey(basemap, globalTimeMs),
    [basemap, globalTimeMs],
  );

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    lastBasemapStyleKeyRef.current = currentBasemapStyleKey;

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
      maxTileCacheSize: 8192,
      pixelRatio: renderPixelRatio(),
      attributionControl: false,
    });
    map.dragRotate.disable();
    (map.touchZoomRotate as any)?.disableRotation?.();

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    // GlobeControl is intentionally NOT added. MapLibre's built-in globe toggle
    // calls setProjection() directly, bypassing React's viewMode state and
    // causing the TopBar MAP/GLOBE indicator to desync. Projection is controlled
    // exclusively through the TopBar toggle → applyGlobePresentation().
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
      setVisibleBbox(viewportBboxParam(map));
      const globeCapable = typeof (map as any).setProjection === "function";
      onGlobeSupportDetectedRef.current(globeCapable);
      onCanvasReady?.(map.getCanvas());
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
      setVisibleBbox(viewportBboxParam(map));
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
    try {
      applyGlobePresentation(map, viewMode);
    } catch {
      // Projection switch can throw on older builds; safe to ignore.
    }
  }, [mapReady, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (lastBasemapStyleKeyRef.current === currentBasemapStyleKey) return;
    if (
      timelinePlaying
      && basemapUsesTimelineDate(basemap)
      && lastBasemapStyleKeyRef.current?.startsWith(`${basemap}:`)
    ) {
      return;
    }
    lastBasemapStyleKeyRef.current = currentBasemapStyleKey;
    const next = getBasemapStyle(basemap, globalTimeMs);
    map.setStyle(next as any);
    const onStyle = () => {
      applyGlobePresentation(map, viewMode);
      syncWmsLayers({ map, renderPlan, isPlaying: timelinePlaying, speedMultiplier: timelineSpeedMultiplier });
    };
    if (map.isStyleLoaded()) onStyle();
    else map.once("style.load", onStyle);
  }, [basemap, currentBasemapStyleKey, mapReady, timelinePlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  const wmsSignature = useMemo(() => wmsSyncSignature(renderPlan), [renderPlan]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncWmsLayers({ map, renderPlan, isPlaying: timelinePlaying, speedMultiplier: timelineSpeedMultiplier });
    // The signature key is the real driver; renderPlan is left out of the
    // dependency array on purpose to avoid resyncing on every globalTimeMs
    // tick when no WMS field actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, wmsSignature, timelinePlaying]);

  useEffect(() => {
    const now = performance.now();
    const delta = now - lastFrameAtRef.current;
    const fps = delta > 0 ? 1000 / delta : 0;
    lastFrameAtRef.current = now;
    const wmsTelemetry = getWmsRendererTelemetry(mapRef.current);

    // Build a stable signature to avoid triggering parent re-renders when
    // nothing material changed. fps is excluded because it varies every frame.
    const sig = [
      activeLayers.length,
      deckLayers.length,
      viewMode,
      wmsTelemetry.pendingRasterFrames,
      wmsTelemetry.promotedRasterFrames,
      wmsTelemetry.failedRasterFrames,
      wmsTelemetry.lastSourceError,
      renderPlan.map((plan) => `${plan.id}:${String(plan.source.metadata.time_availability ?? "")}`).join(","),
    ].join("|");

    if (sig === prevDiagnosticsRef.current) return;
    prevDiagnosticsRef.current = sig;

    onDiagnosticsRef.current({
      fps,
      activeLayerCount: activeLayers.length,
      animatedLayerCount: activeLayers.filter((layer) => layer.capabilities.supportsAnimation).length,
      deckLayerCount: deckLayers.length,
      rendererKind: rendererKindForViewMode(viewMode),
      pendingRasterFrames: wmsTelemetry.pendingRasterFrames,
      promotedRasterFrames: wmsTelemetry.promotedRasterFrames,
      failedRasterFrames: wmsTelemetry.failedRasterFrames,
      lastSourceError: wmsTelemetry.lastSourceError,
      warnings: [
        ...activeLayers
        .filter((layer) => viewMode === "globe" && !layer.capabilities.supportsGlobe)
        .map((layer) => `${layer.title} is map-only and may be hidden in globe mode.`),
        ...renderPlan
          .filter((plan) => {
            const availability = plan.source.metadata.time_availability;
            return availability === "before-range" || availability === "after-range";
          })
          .slice(0, 3)
          .map((plan) => {
            const requested = String(plan.source.metadata.requested_time ?? "requested time");
            const edge = plan.source.metadata.time_availability === "before-range"
              ? String(plan.source.metadata.available_time_start ?? "earliest available time")
              : String(plan.source.metadata.available_time_end ?? "latest available time");
            return `${plan.source.title} has no frame at ${requested}; showing ${edge}.`;
          }),
      ],
    });
  }, [activeLayers, deckLayers, renderPlan, viewMode]);

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
          maxFps={timelinePlaying ? 45 : 60}
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
