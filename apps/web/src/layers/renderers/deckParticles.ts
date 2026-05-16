import { PathLayer } from "@deck.gl/layers";

import type { WindParticle } from "./mockWeatherFields";
import type { LayerRuntimeState } from "../types";

export function createDeckParticleLayer(options: {
  id: string;
  particles: WindParticle[];
  runtime: LayerRuntimeState;
}) {
  return new PathLayer({
    id: options.id,
    data: options.particles,
    wrapLongitude: true,
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
    rounded: true,
    pickable: true,
  });
}
