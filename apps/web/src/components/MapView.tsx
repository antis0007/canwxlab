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
}

const defaultBaseStyle: StyleSpecification = {
  version: 8,
  sources: {
    "carto-dark": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#090d14" } },
    {
      id: "base-tiles",
      type: "raster",
      source: "carto-dark",
      paint: { "raster-opacity": 0.72, "raster-saturation": -0.3 },
    },
  ],
};

function styleFromEnvironment(): string | StyleSpecification {
  const configured = import.meta.env.VITE_MAP_STYLE_URL;
  return configured && configured.trim().length > 0 ? configured : defaultBaseStyle;
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
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const lastFrameAtRef = useRef<number>(performance.now());
  const activeLayersRef = useRef<LayerDefinition[]>([]);
  const animationFrameRef = useRef<number>(animationFrame);
  const observationsRef = useRef<Observation[]>(observations);
  const alertsRef = useRef<AlertFeature[]>(alerts);

  // Stable callback refs — updated every render so handlers always see latest values
  // but never trigger map re-creation.
  const onInspectRef = useRef(onInspect);
  const onGlobeSupportDetectedRef = useRef(onGlobeSupportDetected);
  const onCameraChangeRef = useRef(onCameraChange);
  useEffect(() => { onInspectRef.current = onInspect; });
  useEffect(() => { onGlobeSupportDetectedRef.current = onGlobeSupportDetected; });
  useEffect(() => { onCameraChangeRef.current = onCameraChange; });

  const activeLayers = useMemo(
    () => layers.filter((layer) => layerState[layer.id]?.enabled),
    [layers, layerState],
  );

  useEffect(() => {
    activeLayersRef.current = activeLayers;
  }, [activeLayers]);

  useEffect(() => {
    animationFrameRef.current = animationFrame;
  }, [animationFrame]);

  useEffect(() => {
    observationsRef.current = observations;
  }, [observations]);

  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  const deckLayers = useMemo(() => {
    const list: any[] = [];

    const getRuntime = (layerId: string) => layerState[layerId];

    const temperatureLayer = activeLayers.find((layer) =>
      layer.id === "demo_temperature_field" || layer.id === "mock_temperature"
    );
    if (temperatureLayer) {
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
    if (radarLayer) {
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
    if (cloudLayer) {
      const runtime = getRuntime(cloudLayer.id);
      if (runtime) {
        list.push(createDeckGridLayer({
          id: "demo-cloud-grid",
          data: createCloudOverlay(animationFrame),
          valueKey: "cloudOpacity",
          runtime: {
            ...runtime,
            opacity: runtime.controls.cloudOpacity,
          },
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

    const alertLayer = activeLayers.find((layer) => layer.variable?.includes("alert"));
    if (alertLayer) {
      const runtime = getRuntime(alertLayer.id);
      if (runtime) {
        list.push(createAlertPolygonLayer({ id: "alerts", alerts, runtime }));
      }
    }

    const stationLayer = activeLayers.find((layer) =>
      layer.variable?.includes("observation") || layer.variable?.includes("station")
    );
    if (stationLayer) {
      const runtime = getRuntime(stationLayer.id);
      if (runtime) {
        list.push(createStationLayer({ id: "stations", observations, runtime }));
      }
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

    return list;
  }, [activeLayers, alerts, animationFrame, layerState, observations]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleFromEnvironment(),
      center: [-97, 57],
      zoom: 3,
      minZoom: 2,
      maxZoom: 12,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    const overlay = new MapboxOverlay({ layers: [], interleaved: false });
    map.addControl(overlay as unknown as maplibregl.IControl);

    map.on("click", (event) => {
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
      const supportsGlobe = typeof (map as any).setProjection === "function";
      onGlobeSupportDetectedRef.current(supportsGlobe);
    });

    map.on("moveend", () => {
      onCameraChangeRef.current({
        longitude: map.getCenter().lng,
        latitude: map.getCenter().lat,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
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

    const supportsGlobe = typeof (map as any).setProjection === "function";
    onGlobeSupportDetectedRef.current(supportsGlobe);

    if (viewMode === "globe" && supportsGlobe) {
      (map as any).setProjection({ type: "globe" });
    }
    if (viewMode === "map" && supportsGlobe) {
      (map as any).setProjection({ type: "mercator" });
    }
  }, [mapReady, viewMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    syncWmsLayers({
      map,
      layers,
      runtimeState: layerState,
      globalTimeMs,
    });
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

  return (
    <div className="map-shell">
      <div ref={containerRef} className="map-container" />
      <div className="map-badge">
        <span>Map mode</span>
        <strong>{viewMode}</strong>
        <span>{activeLayers.length} active</span>
      </div>
      {import.meta.env.VITE_MAP_STYLE_URL ? (
        <div className="map-style-warning">
          Map style: {String(import.meta.env.VITE_MAP_STYLE_URL).slice(0, 80)}
        </div>
      ) : (
        <div className="map-style-warning" data-fallback="true" style={{ background: "#542a06", color: "#ffd29c" }}>
          LOW-RES FALLBACK BASEMAP — set VITE_MAP_STYLE_URL for production
        </div>
      )}
    </div>
  );
}
