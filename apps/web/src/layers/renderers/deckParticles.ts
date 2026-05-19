import { PathLayer } from "@deck.gl/layers";

import type { LayerRuntimeState } from "../types";

export interface WindParticle {
  path: [number, number][];
  speed: number;
}

// Shared with deckGrid.ts — keep in sync.
function blendParams(blendMode: string): Record<string, unknown> {
  if (blendMode === "additive" || blendMode === "add") {
    return { depthTest: false, blendFunc: [1, 1] as [number, number], blendEquation: 0x8006 };
  }
  if (blendMode === "screen") {
    return { depthTest: false, blendFunc: [1, 0x0301] as [number, number], blendEquation: 0x8006 };
  }
  if (blendMode === "multiply") {
    return { depthTest: false, blendFunc: [0x0306, 0x0303] as [number, number], blendEquation: 0x8006 };
  }
  if (blendMode === "max") {
    return { depthTest: false, blendFunc: [1, 1] as [number, number], blendEquation: 0x8008 };
  }
  return { depthTest: false };
}

export function createDeckParticleLayer(options: {
  id: string;
  particles: WindParticle[];
  runtime: LayerRuntimeState;
}) {
  return new PathLayer({
    id: options.id,
    data: options.particles,
    wrapLongitude: false,
    transitions: {},
    getPath: (item: WindParticle) => item.path,
    getColor: (item: WindParticle) => {
      const alpha = Math.round(220 * options.runtime.opacity);
      if (item.speed < 3) return [116, 207, 255, alpha];
      if (item.speed < 8) return [91, 241, 167, alpha];
      if (item.speed < 14) return [255, 214, 102, alpha];
      return [255, 133, 111, alpha];
    },
    getWidth: (item: WindParticle) => Math.max(1, item.speed * 0.22),
    widthMinPixels: 1,
    widthMaxPixels: 6,
    widthUnits: "pixels",
    rounded: true,
    pickable: true,
    updateTriggers: {
      getColor: [options.runtime.opacity],
    },
    parameters: blendParams(options.runtime.controls.blendMode),
  });
}
