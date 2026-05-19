import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";

import { resolveRamp, rgbForRampValue } from "../colorRamps";
import type { LayerRuntimeState } from "../types";

interface PointFieldDatum {
  longitude: number;
  latitude: number;
  value: number;
}

function colorFromRamp(value: number, min: number, max: number, rampId: string): [number, number, number] {
  const ramp = resolveRamp(rampId);
  const sorted = ramp.stops.slice().sort((a, b) => a.value - b.value);
  const rampMin = sorted[0]?.value ?? 0;
  const rampMax = sorted[sorted.length - 1]?.value ?? 1;
  const normalized = Math.max(0, Math.min(1, (value - min) / Math.max(0.001, max - min)));
  return rgbForRampValue(rampId, rampMin + (rampMax - rampMin) * normalized);
}

// WebGL blend constants.
//   GL.SRC_ALPHA           = 0x0302 (770)
//   GL.ONE_MINUS_SRC_ALPHA = 0x0303 (771)
//   GL.ONE                 = 1
//   GL.DST_COLOR           = 0x0306 (774)
//   GL.ONE_MINUS_SRC_COLOR = 0x0301 (769)
//   GL.FUNC_ADD            = 0x8006 (32774)
//   GL.MAX                 = 0x8008 (32776)
function blendParams(blendMode: string): Record<string, unknown> {
  // additive / add — fragments accumulate without alpha penalty.
  // Radar, precipitation, and cloud overlays.
  if (blendMode === "additive" || blendMode === "add") {
    return { depthTest: false, blendFunc: [1, 1] as [number, number], blendEquation: 0x8006 };
  }
  // screen — 1 - (1-src)*(1-dst). Softer brightening, good for cloud composites.
  if (blendMode === "screen") {
    return { depthTest: false, blendFunc: [1, 0x0301] as [number, number], blendEquation: 0x8006 };
  }
  // multiply — dst * src. Darkens, useful for satellite overlays on bright basemaps.
  if (blendMode === "multiply") {
    return { depthTest: false, blendFunc: [0x0306, 0x0303] as [number, number], blendEquation: 0x8006 };
  }
  // max — picks the lighter fragment. Good for compositing forecast max-fields.
  if (blendMode === "max") {
    return { depthTest: false, blendFunc: [1, 1] as [number, number], blendEquation: 0x8008 };
  }
  // alpha — explicit alpha compositing (same pipeline as normal, semantically distinct).
  // normal — standard src-alpha / 1-src-alpha.
  return { depthTest: false };
}

export function createDeckGridLayer(options: {
  id: string;
  data: GeoJSON.FeatureCollection;
  valueKey: string;
  runtime: LayerRuntimeState;
  min: number;
  max: number;
}) {
  return new GeoJsonLayer({
    id: options.id,
    data: options.data as any,
    filled: true,
    stroked: false,
    opacity: options.runtime.opacity,
    pickable: true,
    wrapLongitude: true,
    transitions: {},
    _subLayerProps: {
      "polygons-fill": { _normalize: false },
    },
    getFillColor: (feature: any) => {
      const raw = feature?.properties?.[options.valueKey];
      const numeric = typeof raw === "number" ? raw : options.min;
      const [r, g, b] = colorFromRamp(numeric, options.min, options.max, options.runtime.colourRamp);
      return [r, g, b, 170];
    },
    updateTriggers: {
      getFillColor: [options.runtime.controls.min, options.runtime.controls.max, options.runtime.colourRamp, options.runtime.opacity],
    },
    parameters: blendParams(options.runtime.controls.blendMode),
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
    transitions: {},
    getFillColor: (point: PointFieldDatum) => {
      const [r, g, b] = colorFromRamp(point.value, options.min, options.max, options.runtime.colourRamp);
      return [r, g, b, 150];
    },
    updateTriggers: {
      getFillColor: [options.min, options.max, options.runtime.colourRamp, options.runtime.opacity],
    },
    parameters: blendParams(options.runtime.controls.blendMode),
  });
}
