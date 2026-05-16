import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer } from "@deck.gl/layers";
import { useEffect, useMemo, useRef, useState } from "react";

import type { AlertFeature, Observation } from "../types/weather";
import type {
  LayerDefinition,
  LayerDiagnostics,
  LayerRuntimeState,
  RendererFeatureValue,
  ViewMode,
  CameraState,
} from "../layers/types";
import { createDeckGridLayer } from "../layers/renderers/deckGrid";
import { createDeckParticleLayer } from "../layers/renderers/deckParticles";
import { createAlertPolygonLayer, createStationLayer } from "../layers/renderers/deckVector";
import {
  createCloudOverlay,
  createRadarBlobs,
  createTemperatureGrid,
  createWindParticles,
  sampleMockWeatherPoint,
} from "../layers/renderers/mockWeatherFields";
import { syncWmsLayers } from "../layers/renderers/maplibreRaster";
import type { BasemapId } from "./LayersPicker";
import { Starfield, type StarProjection } from "./Starfield";
import { StarInfoCard } from "./StarInfoCard";
import type { Star } from "../lib/celestialSphere";
import type { StarExposure } from "../layers/types";
import { createDiffBitmapLayer, type DiffOverlayPayload } from "../layers/renderers/diffBitmap";
import { createTerminatorLayer } from "../layers/renderers/terminator";

interface MapInspectPayload {
  longitude: number;
  latitude: number;
  values: RendererFeatureValue[];
  nearestStation: string | null;
  activeAlert: string | null;
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
}

interface BasemapPreset {
  id: BasemapId;
  style: StyleSpecification;
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
      return alert.headline;
    }
  }
  return null;
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

function nearestStationName(
  observations: Observation[],
  longitude: number,
  latitude: number,
): string | null {
  let nearest: Observation | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const observation of observations) {
    const distance = Math.hypot(observation.longitude - longitude, observation.latitude - latitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = observation;
    }
  }

  return nearest ? `${nearest.station_name} (${nearest.station_id})` : null;
}

function sampleValues(
  longitude: number,
  latitude: number,
  frame: number,
  activeLayers: LayerDefinition[],
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
}: MapViewProps) {
  // Held for in-progress celestial-sphere wiring; reference them to keep
  // them in the component signature without lint complaining.
  void starExposure;
  void starMaxDistanceLy;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const lastFrameAtRef = useRef<number>(performance.now());
  const activeLayersRef = useRef<LayerDefinition[]>([]);
  const animationFrameRef = useRef<number>(animationFrame);
  const observationsRef = useRef<Observation[]>(observations);
  const alertsRef = useRef<AlertFeature[]>(alerts);

  const onInspectRef = useRef(onInspect);
  const onGlobeSupportDetectedRef = useRef(onGlobeSupportDetected);
  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => { onInspectRef.current = onInspect; });
  useEffect(() => { onGlobeSupportDetectedRef.current = onGlobeSupportDetected; });
  useEffect(() => { onCameraChangeRef.current = onCameraChange; });

  // Live camera + time refs for the celestial starfield (avoids React re-renders on every drag frame).
  const liveCameraRef = useRef<CameraState | null>(null);
  const liveTimeRef = useRef<number>(globalTimeMs || Date.now());
  useEffect(() => { liveTimeRef.current = globalTimeMs || Date.now(); }, [globalTimeMs]);

  // Last-frame star projections (CSS-pixel space) for click hit-testing.
  const starProjectionsRef = useRef<StarProjection[]>([]);
  const [selectedStar, setSelectedStar] = useState<Star | null>(null);

  // COSMIC-TODO(C): Auto-transition to OrbitalView when zoom drops below ~0. The MapLibre
  //   globe runs out of meaningful basemap below zoom 2; below zoom 0 we should hide MapLibre,
  //   mount a WebGL <OrbitalView> sibling, and interpolate the camera basis from ECEF-north-up
  //   into ecliptic-J2000-z-up. See docs/cosmic-scope-roadmap.md §6.
  // COSMIC-TODO(C): Wire middle-click drag → pan-in-current-plane in OrbitalView. MapLibre's
  //   default middle-click is unused; intercept on the container element before MapLibre sees it.
  // COSMIC-TODO(D): Right-click context menu — "Lock to orbital plane (temporary)", "Focus",
  //   "Show info", "Add to verification". Should be a separate component so map-mode and
  //   orbital-mode can share it.
  // COSMIC-TODO(B): Render Sun position + sub-solar terminator overlay on the Earth globe.
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

  useEffect(() => { activeLayersRef.current = activeLayers; }, [activeLayers]);
  useEffect(() => { animationFrameRef.current = animationFrame; }, [animationFrame]);
  useEffect(() => { observationsRef.current = observations; }, [observations]);
  useEffect(() => { alertsRef.current = alerts; }, [alerts]);

  const deckLayers = useMemo(() => {
    const list: any[] = [];
    const getRuntime = (layerId: string) => layerState[layerId];
    // Globe projection: skip world-spanning deck.gl grid/particle layers.
    // GridCell + ParticleLayer assume mercator-flat positions; on a sphere they
    // wrap and produce the "strange patterns / glitches" reported by users.
    // Point/polygon layers (stations/alerts) reproject correctly and stay.
    const skipFlatGrids = viewMode === "globe";

    const temperatureLayer = activeLayers.find((layer) =>
      layer.id === "demo_temperature_field" || layer.id === "mock_temperature"
    );
    if (temperatureLayer && !skipFlatGrids) {
      const runtime = getRuntime(temperatureLayer.id);
      if (runtime) {
        list.push(createDeckGridLayer({
          id: "demo-temperature-grid",
          data: createTemperatureGrid(animationFrame),
          valueKey: "temperature",
          runtime,
          min: runtime.controls.min,
          max: runtime.controls.max,
        }));
      }
    }

    const radarLayer = activeLayers.find((layer) =>
      layer.id === "demo_radar_animation" || layer.id === "mock_radar"
    );
    if (radarLayer && !skipFlatGrids) {
      const runtime = getRuntime(radarLayer.id);
      if (runtime) {
        const radarData = createRadarBlobs(animationFrame);
        radarData.features.forEach((feature: any) => {
          feature.properties.precip *= runtime.controls.precipitationIntensity;
        });
        list.push(createDeckGridLayer({
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
    if (cloudLayer && !skipFlatGrids) {
      const runtime = getRuntime(cloudLayer.id);
      if (runtime) {
        list.push(createDeckGridLayer({
          id: "demo-cloud-grid",
          data: createCloudOverlay(animationFrame),
          valueKey: "cloudOpacity",
          runtime: { ...runtime, opacity: runtime.controls.cloudOpacity },
          min: runtime.controls.min,
          max: runtime.controls.max,
        }));
      }
    }

    const windLayer = activeLayers.find((layer) =>
      layer.id === "demo_wind_particles" || layer.id === "mock_wind"
    );
    if (windLayer && !skipFlatGrids) {
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

    const alertLayer = activeLayers.find((layer) => layer.variable?.includes("alert"));
    if (alertLayer) {
      const runtime = getRuntime(alertLayer.id);
      if (runtime) list.push(createAlertPolygonLayer({ id: "alerts", alerts, runtime }));
    }

    const stationLayer = activeLayers.find((layer) =>
      layer.variable?.includes("observation") || layer.variable?.includes("station")
    );
    if (stationLayer) {
      const runtime = getRuntime(stationLayer.id);
      if (runtime) list.push(createStationLayer({ id: "stations", observations, runtime }));
    }

    const simLayer = activeLayers.find((layer) => layer.id === "canwxsim_output");
    if (simLayer && layerState[simLayer.id]) {
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
        getFillColor: [130, 255, 210, Math.round(95 * layerState[simLayer.id].opacity)],
        getLineColor: [130, 255, 210, 240],
        lineWidthMinPixels: 2,
      }));
    }

    if (diffOverlay) {
      const bmp = createDiffBitmapLayer(diffOverlay);
      if (bmp) list.push(bmp);
    }

    // Day/night terminator — only meaningful in photorealistic globe mode.
    // Driven by the global timeline so scrubbing dawn→dusk animates.
    if (viewMode === "globe" && photorealisticGlobe) {
      list.push(
        createTerminatorLayer({
          id: "terminator-night",
          timeMs: globalTimeMs,
          intensity: 0.45,
        }),
      );
    }

    return list;
  }, [
    activeLayers,
    alerts,
    animationFrame,
    layerState,
    observations,
    viewMode,
    diffOverlay,
    photorealisticGlobe,
    globalTimeMs,
  ]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getBasemapStyle(basemap, globalTimeMs),
      center: [-97, 57],
      zoom: 3,
      minZoom: 2,
      maxZoom: 18,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    if (typeof (maplibregl as any).GlobeControl === "function") {
      map.addControl(new (maplibregl as any).GlobeControl(), "top-right");
    }
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const overlay = new MapboxOverlay({ layers: [], interleaved: true });
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("click", (event) => {
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
      onInspectRef.current({
        longitude,
        latitude,
        values: sampleValues(
          longitude,
          latitude,
          animationFrameRef.current,
          activeLayersRef.current,
        ),
        nearestStation: nearestStationName(observationsRef.current, longitude, latitude),
        activeAlert: activeAlertAtPoint(alertsRef.current, longitude, latitude),
      });
    });

    map.on("load", () => {
      setMapReady(true);
      onGlobeSupportDetectedRef.current(true);
    });

    const updateLiveCamera = () => {
      liveCameraRef.current = {
        longitude: map.getCenter().lng,
        latitude: map.getCenter().lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    };
    updateLiveCamera();
    map.on("move", updateLiveCamera);
    map.on("moveend", () => {
      updateLiveCamera();
      onCameraChangeRef.current(liveCameraRef.current!);
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
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
      mapRef.current.flyTo({
        center: [cameraTarget.longitude, cameraTarget.latitude],
        zoom: cameraTarget.zoom,
        bearing: cameraTarget.bearing,
        pitch: cameraTarget.pitch,
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
      const bgVisible = !(viewMode === "globe" && photorealisticGlobe);
      try {
        if (map.getLayer("background")) {
          map.setPaintProperty("background", "background-opacity", bgVisible ? 1 : 0);
        }
      } catch { /* style not yet ready */ }
      if (viewMode === "globe") {
        if (typeof (map as any).setProjection === "function") {
          (map as any).setProjection({ type: "globe" });
        }
        if (typeof (map as any).setSky === "function") {
          if (photorealisticGlobe) {
            (map as any).setSky({
              "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.9, 8, 0.4, 12, 0],
              "sky-color": "#000308",
              "horizon-color": "#5b8ec9",
              "atmosphere-color": "#7fb3ff",
              "atmosphere-halo-color": "#cfe2ff",
            });
          } else {
            (map as any).setSky({});
          }
        }
      } else {
        if (typeof (map as any).setProjection === "function") {
          (map as any).setProjection({ type: "mercator" });
        }
      }
      // Directional lighting: warm sun-lit hemisphere for photorealistic
      // globe; neutral for flat map.
      if (typeof (map as any).setLight === "function") {
        if (viewMode === "globe" && photorealisticGlobe) {
          (map as any).setLight({
            anchor: "map",
            color: "#fff4dd",
            intensity: 0.55,
            position: [1.15, 210, 30],
          });
        } else {
          (map as any).setLight({ anchor: "viewport", intensity: 0.35 });
        }
      }
    } catch {
      // Projection switch can throw on older builds; safe to ignore.
    }
  }, [mapReady, viewMode, photorealisticGlobe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const next = getBasemapStyle(basemap, globalTimeMs);
    map.setStyle(next as any);
    const onStyle = () => {
      syncWmsLayers({ map, layers, runtimeState: layerState, globalTimeMs });
      try {
        if (map.getLayer("background")) {
          const bgVisible = !(viewMode === "globe" && photorealisticGlobe);
          map.setPaintProperty("background", "background-opacity", bgVisible ? 1 : 0);
        }
      } catch { /* ignore */ }
    };
    map.once("styledata", onStyle);
  }, [basemap]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncWmsLayers({ map, layers, runtimeState: layerState, globalTimeMs });
  }, [layers, layerState, mapReady, globalTimeMs]);

  useEffect(() => {
    const now = performance.now();
    const delta = now - lastFrameAtRef.current;
    const fps = delta > 0 ? 1000 / delta : 0;
    lastFrameAtRef.current = now;

    onDiagnostics({
      fps,
      activeLayerCount: activeLayers.length,
      animatedLayerCount: activeLayers.filter((layer) => layer.capabilities.supportsAnimation).length,
      deckLayerCount: deckLayers.length,
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
          projectionsRef={starProjectionsRef}
        />
      )}
      {selectedStar && <StarInfoCard star={selectedStar} onClose={() => setSelectedStar(null)} />}
      <div ref={containerRef} className="map-container" />
      <div className="map-badge">
        <span>{viewMode}</span>
        <span>{activeLayers.length} active</span>
      </div>
    </div>
  );
}
