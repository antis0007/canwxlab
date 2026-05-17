// deck.gl marker layer for detected surface pressure systems.
//
// Two layers are produced and bundled in a CompositeLayer-style array so
// the caller can drop them in alongside other deck.gl layers:
//   1. A coloured circle behind the glyph for legibility on busy basemaps.
//   2. A TextLayer with the L/H glyph + MSLP readout.
//
// Both stay depthTest:false to ensure they paint on top of the basemap.

import { ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { PressureSystem } from "../pressureSystems";

const LOW_COLOR: [number, number, number, number] = [255, 96, 64, 240];
const HIGH_COLOR: [number, number, number, number] = [80, 168, 255, 240];

export function createPressureSystemLayers(systems: PressureSystem[]) {
  if (!systems || systems.length === 0) return [];

  const data = systems.map((entry) => ({
    longitude: entry.longitude,
    latitude: entry.latitude,
    kind: entry.kind,
    pressureHpa: entry.pressureHpa,
    label: `${entry.kind}\n${entry.pressureHpa.toFixed(0)}`,
    color: entry.kind === "L" ? LOW_COLOR : HIGH_COLOR,
  }));

  const halo = new ScatterplotLayer({
    id: "pressure-system-halo",
    data,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getRadius: 16,
    getLineColor: (d: any) => d.color,
    getFillColor: [10, 14, 24, 220],
    radiusUnits: "pixels",
    stroked: true,
    filled: true,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1.5,
    getLineWidth: 2,
    pickable: false,
    parameters: { depthTest: false },
  });

  const text = new TextLayer({
    id: "pressure-system-text",
    data,
    getPosition: (d: any) => [d.longitude, d.latitude],
    getText: (d: any) => d.label,
    getColor: (d: any) => d.color,
    getSize: 16,
    sizeUnits: "pixels",
    fontFamily: "Cascadia Code, JetBrains Mono, monospace",
    fontWeight: 700,
    background: false,
    parameters: { depthTest: false },
    pickable: false,
    characterSet: "LH0123456789\n .-",
  });

  return [halo, text];
}
