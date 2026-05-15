import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";

import type { AlertFeature, Observation } from "../../types/weather";
import type { LayerRuntimeState } from "../types";

function severityColor(severity: string): [number, number, number, number] {
  if (severity === "severe" || severity === "extreme") return [239, 71, 111, 190];
  if (severity === "moderate") return [255, 209, 102, 170];
  return [121, 220, 207, 160];
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
    getFillColor: (feature: any) => {
      const severity = String(feature?.properties?.severity ?? "unknown");
      const [r, g, b, a] = severityColor(severity);
      return [r, g, b, Math.round(a * options.runtime.opacity)];
    },
    getLineColor: [250, 250, 250, 210],
    lineWidthMinPixels: 2,
    pickable: true,
  });
}

export function createStationLayer(options: {
  id: string;
  observations: Observation[];
  runtime: LayerRuntimeState;
}) {
  return new ScatterplotLayer({
    id: options.id,
    data: options.observations,
    getPosition: (station: Observation) => [station.longitude, station.latitude],
    getFillColor: [255, 255, 255, Math.round(220 * options.runtime.opacity)],
    getLineColor: [24, 31, 41, 255],
    getRadius: 38000,
    radiusMinPixels: 4,
    radiusMaxPixels: 11,
    lineWidthMinPixels: 1,
    stroked: true,
    pickable: true,
  });
}
