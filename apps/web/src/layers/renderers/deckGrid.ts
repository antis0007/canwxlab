import { GeoJsonLayer } from "@deck.gl/layers";

import { resolveRamp } from "../colorRamps";
import type { LayerRuntimeState } from "../types";

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
    getFillColor: (feature: any) => {
      const raw = feature?.properties?.[options.valueKey];
      const numeric = typeof raw === "number" ? raw : options.min;
      const [r, g, b] = colorFromStops(numeric, options.min, options.max, colors);
      return [r, g, b, 170];
    },
  });
}
