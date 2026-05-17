import { describe, expect, it } from "vitest";

import { fallbackLayers } from "../lib/layerRegistry";
import { buildLayerDefinitions } from "./registry";
import { buildRenderPlan } from "./renderPlan";
import type { LayerRuntimeState } from "./types";

describe("buildRenderPlan", () => {
  it("keeps layer order bottom-to-top and defaults WMS time to latest", () => {
    const layers = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const active = layers.filter((layer) => ["eccc_radar_1km_rrai", "eccc_goes_east_cloud_type"].includes(layer.id));
    const runtimeState = Object.fromEntries(
      active.map((layer, index) => [
        layer.id,
        {
          enabled: true,
          opacity: layer.defaultOpacity,
          colourRamp: layer.colourRamp,
          zIndex: layer.zIndex,
          controls: layer.controls,
          wmsTimePolicy: "latest",
        } satisfies LayerRuntimeState,
      ]),
    );

    const plan = buildRenderPlan({
      layers: active,
      runtimeState,
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "globe",
    });

    expect(plan.map((entry) => entry.id)).toEqual(active.map((layer) => layer.id));
    expect(plan.every((entry) => entry.rendererType === "wms-raster")).toBe(true);
    expect(plan.every((entry) => entry.timePolicy === "latest")).toBe(true);
    expect(plan[0].source.metadata.rendererKind).toBe("maplibre-globe");
  });

  it("maps historical global WMS policy back to latest default", () => {
    const layer = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    }).find((item) => item.id === "eccc_radar_1km_rrai")!;
    const runtimeState: Record<string, LayerRuntimeState> = {
      [layer.id]: {
        enabled: true,
        opacity: layer.defaultOpacity,
        colourRamp: layer.colourRamp,
        zIndex: layer.zIndex,
        controls: layer.controls,
        wmsTimePolicy: "global",
      },
    };

    const [plan] = buildRenderPlan({
      layers: [layer],
      runtimeState,
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "map",
    });

    expect(plan.timePolicy).toBe("latest");
  });
});
