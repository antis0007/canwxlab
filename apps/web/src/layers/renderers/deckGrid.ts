import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";

import { resolveRamp } from "../colorRamps";
import type { LayerRuntimeState } from "../types";

interface PointFieldDatum {
  longitude: number;
  latitude: number;
  value: number;
}

function colorFromStops(value: number, min: number, max: number, colors: string[]): [number, number, number] {
  const normalized = Math.max(0, Math.min(1, (value - min) / Math.max(0.001, max - min)));
  const index = Math.min(colors.length - 1, Math.floor(normalized * colors.length));
  const hex = colors[index].replace("#", "");
  const parsed = Number.parseInt(hex, 16);
  if (Number.isNaN(parsed)) return [128, 128, 128];
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff];
}

export function createDeckGridLayer(options: {
  id: string;
  data: GeoJSON.FeatureCollection;
  valueKey: string;
  runtime: LayerRuntimeState;
  min: number;
  max: number;
}) {
  const ramp = resolveRamp(options.runtime.colourRamp);
  const colors = ramp.stops.map((stop) => stop.color);

  return new GeoJsonLayer({
    id: options.id,
    data: options.data as any,
    filled: true,
    stroked: false,
    opacity: options.runtime.opacity,
    pickable: true,
    wrapLongitude: true,
    _subLayerProps: {
      "polygons-fill": { _normalize: false },
    },
    getFillColor: (feature: any) => {
      const raw = feature?.properties?.[options.valueKey];
      const numeric = typeof raw === "number" ? raw : options.min;
      const [r, g, b] = colorFromStops(numeric, options.min, options.max, colors);
      return [r, g, b, 170];
    },
    parameters: { depthTest: false },
  });
}

export function createDeckPointFieldLayer(options: {
  id: string;
  data: GeoJSON.FeatureCollection;
  valueKey: string;
  runtime: LayerRuntimeState;
  min: number;
  max: number;
  radiusMeters?: number;
}) {
  const ramp = resolveRamp(options.runtime.colourRamp);
  const colors = ramp.stops.map((stop) => stop.color);

  const points = options.data.features
    .map((feature) => {
      const ring = (feature.geometry as any)?.coordinates?.[0] as [number, number][] | undefined;
      if (!ring || ring.length === 0) return null;
      const usable = ring.slice(0, -1);
      const longitude = usable.reduce((sum, point) => sum + point[0], 0) / usable.length;
      const latitude = usable.reduce((sum, point) => sum + point[1], 0) / usable.length;
      return {
        longitude,
        latitude,
        value: Number((feature.properties as Record<string, unknown>)?.[options.valueKey] ?? options.min),
      };
    })
    .filter((point): point is PointFieldDatum => point !== null);

  return new ScatterplotLayer({
    id: options.id,
    data: points,
    getPosition: (point: PointFieldDatum) => [point.longitude, point.latitude],
    getRadius: options.radiusMeters ?? 90_000,
    radiusMinPixels: 2,
    radiusMaxPixels: 28,
    stroked: false,
    filled: true,
    opacity: options.runtime.opacity,
    pickable: true,
    getFillColor: (point: PointFieldDatum) => {
      const [r, g, b] = colorFromStops(point.value, options.min, options.max, colors);
      return [r, g, b, 150];
    },
    parameters: { depthTest: false },
  });
}
