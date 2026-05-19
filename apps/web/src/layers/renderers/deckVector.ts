import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";

import type { AlertFeature, Observation } from "../../types/weather";
import type { LayerDefinition, LayerRuntimeState } from "../types";

function severityColor(severity: string): [number, number, number, number] {
  if (severity === "extreme") return [220, 38, 38, 215];     // crimson
  if (severity === "severe") return [239, 71, 111, 200];     // hot pink-red
  if (severity === "moderate") return [255, 159, 64, 195];   // orange
  if (severity === "minor") return [255, 209, 102, 175];     // amber
  return [121, 220, 207, 155];                                // unknown — teal
}

function severityStrokeColor(severity: string): [number, number, number, number] {
  if (severity === "extreme") return [255, 80, 80, 255];
  if (severity === "severe") return [255, 120, 150, 240];
  if (severity === "moderate") return [255, 200, 140, 235];
  if (severity === "minor") return [255, 230, 170, 225];
  return [180, 240, 230, 220];
}

function flattenPoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (
    value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
  ) {
    return [[value[0], value[1]]];
  }
  return value.flatMap((child) => flattenPoints(child));
}

function featureCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === "Point") {
    const point = geometry.coordinates;
    return [point[0], point[1]];
  }
  const points = flattenPoints((geometry as any).coordinates);
  if (points.length === 0) return null;
  const lon = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const lat = points.reduce((sum, point) => sum + point[1], 0) / points.length;
  return [lon, lat];
}

export function createAlertPolygonLayer(options: {
  id: string;
  alerts: AlertFeature[];
  runtime: LayerRuntimeState;
}) {
  return new GeoJsonLayer({
    id: options.id,
    data: {
      type: "FeatureCollection",
      features: options.alerts.map((alert) => ({
        type: "Feature",
        properties: alert,
        geometry: alert.geometry,
      })),
    } as any,
    filled: true,
    stroked: true,
    // Canadian alert polygons never cross the antimeridian; disabling
    // wrapLongitude prevents deck.gl from inserting tessellation slices that
    // tear when zoomed in or rendered against tile-edge basemaps.
    wrapLongitude: false,
    getFillColor: (feature: any) => {
      const severity = String(feature?.properties?.severity ?? "unknown");
      const [r, g, b, a] = severityColor(severity);
      // Polygons stay translucent so basemap reads through — alerts are a
      // contextual overlay, not a fill mask.
      return [r, g, b, Math.round(Math.min(160, a) * options.runtime.opacity)];
    },
    getLineColor: (feature: any) => {
      const severity = String(feature?.properties?.severity ?? "unknown");
      return severityStrokeColor(severity);
    },
    lineWidthUnits: "pixels",
    getLineWidth: 1.25,
    lineWidthMinPixels: 1,
    lineWidthMaxPixels: 2,
    pickable: true,
    parameters: { depthTest: false },
  });
}

export function createAlertMarkerLayer(options: {
  id: string;
  alerts: AlertFeature[];
  runtime: LayerRuntimeState;
}) {
  const points = options.alerts
    .map((alert) => {
      const centroid = featureCentroid(alert.geometry);
      return centroid ? { alert, centroid } : null;
    })
    .filter((value): value is { alert: AlertFeature; centroid: [number, number] } => value !== null);

  // Pixel-sized markers — keeps a consistent meteorological symbol scale
  // across all zoom levels (no swelling on globe / over-zoom).
  return new ScatterplotLayer({
    id: options.id,
    data: points,
    getPosition: (item: { centroid: [number, number] }) => item.centroid,
    getFillColor: (item: { alert: AlertFeature }) => {
      const [r, g, b, a] = severityColor(item.alert.severity);
      return [r, g, b, Math.round(a * options.runtime.opacity)];
    },
    getLineColor: (item: { alert: AlertFeature }) => severityStrokeColor(item.alert.severity),
    radiusUnits: "pixels",
    getRadius: 4.5,
    radiusMinPixels: 3.5,
    radiusMaxPixels: 7,
    lineWidthUnits: "pixels",
    getLineWidth: 1.1,
    stroked: true,
    filled: true,
    pickable: true,
    parameters: { depthTest: false },
  });
}

export function createStationLayer(options: {
  id: string;
  observations: Observation[];
  runtime: LayerRuntimeState;
}) {
  // Crisp 3–4 px station dots in pixel space, matching the symbology used by
  // operational meteorological viewers (e.g., METAR/SYNOP plot dots).
  const opacity = options.runtime.opacity;
  return new ScatterplotLayer({
    id: options.id,
    data: options.observations,
    getPosition: (station: Observation) => [station.longitude, station.latitude],
    getFillColor: [240, 248, 255, Math.round(230 * opacity)],
    getLineColor: [12, 18, 26, Math.round(245 * opacity)],
    radiusUnits: "pixels",
    getRadius: 4.8,
    radiusMinPixels: 4,
    radiusMaxPixels: 8,
    lineWidthUnits: "pixels",
    getLineWidth: 1.1,
    stroked: true,
    filled: true,
    pickable: true,
    parameters: { depthTest: false },
  });
}

function categoryColor(layer: LayerDefinition): [number, number, number, number] {
  if (layer.category === "alert") return [239, 71, 111, 170];
  if (layer.category === "observation") return [121, 220, 207, 190];
  if (layer.category === "forecast") return [86, 160, 255, 175];
  return [255, 255, 255, 170];
}

export function createOgcFeatureLayer(options: {
  id: string;
  layer: LayerDefinition;
  data: GeoJSON.FeatureCollection;
  runtime: LayerRuntimeState;
  /**
   * When true (globe projection), polygons/lines are reduced to centroid
   * markers because MapLibre's globe tessellation of large overlay polygons
   * tears at wrap/longitude boundaries. Point features render natively.
   */
  globeSafe?: boolean;
}) {
  const [r, g, b, a] = categoryColor(options.layer);
  const opacity = options.runtime.opacity;

  if (options.globeSafe) {
    const points = options.data.features
      .map((feature, idx) => {
        const geom = feature.geometry;
        if (!geom) return null;
        if (geom.type === "Point") {
          const [lon, lat] = geom.coordinates as [number, number];
          return { id: idx, lon, lat, properties: feature.properties ?? {} };
        }
        const centroid = featureCentroid(geom);
        return centroid
          ? { id: idx, lon: centroid[0], lat: centroid[1], properties: feature.properties ?? {} }
          : null;
      })
      .filter((p): p is { id: number; lon: number; lat: number; properties: any } => p !== null);

    return new ScatterplotLayer({
      id: options.id,
      data: points,
      getPosition: (p: { lon: number; lat: number }) => [p.lon, p.lat],
      getFillColor: [r, g, b, Math.round(a * opacity)],
      getLineColor: [255, 255, 255, Math.round(210 * opacity)],
      radiusUnits: "pixels",
      getRadius: 3.5,
      radiusMinPixels: 2.5,
      radiusMaxPixels: 7,
      lineWidthUnits: "pixels",
      getLineWidth: 0.9,
      stroked: true,
      filled: true,
      pickable: true,
      parameters: { depthTest: false },
    });
  }

  // Pixel-sized point markers + screen-pixel strokes — this matches the
  // visual density of real meteorological/OSINT viewers (point obs render
  // as ~3 px dots, not 45 km circles).
  return new GeoJsonLayer({
    id: options.id,
    data: options.data as any,
    pointType: "circle",
    filled: true,
    stroked: true,
    wrapLongitude: false,
    getFillColor: [r, g, b, Math.round(a * opacity)],
    getLineColor: [
      255,
      255,
      255,
      Math.round(210 * opacity),
    ],
    pointRadiusUnits: "pixels",
    getPointRadius: 3.2,
    pointRadiusMinPixels: 2.5,
    pointRadiusMaxPixels: 6,
    lineWidthUnits: "pixels",
    getLineWidth: 0.9,
    lineWidthMinPixels: 0.75,
    lineWidthMaxPixels: 1.5,
    pickable: true,
    // Polygon/line fills should never punch through other overlays.
    parameters: { depthTest: false },
  });
}
