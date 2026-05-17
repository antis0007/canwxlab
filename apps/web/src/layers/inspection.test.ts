import { describe, expect, it } from "vitest";

import { fallbackLayers, fallbackObservations } from "../lib/layerRegistry";
import { buildLayerDefinitions } from "./registry";
import { buildInspectorPayload } from "./inspection";
import { buildRenderPlan } from "./renderPlan";
import type { LayerRuntimeState } from "./types";

describe("buildInspectorPayload", () => {
  it("includes station values, WMS metadata, and derived microphysics classification", () => {
    const layers = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const cloud = layers.find((layer) => layer.id === "eccc_goes_east_cloud_type")!;
    const runtimeState: Record<string, LayerRuntimeState> = {
      [cloud.id]: {
        enabled: true,
        opacity: cloud.defaultOpacity,
        colourRamp: cloud.colourRamp,
        zIndex: cloud.zIndex,
        controls: cloud.controls,
        wmsTimePolicy: "latest",
      },
    };
    const renderPlan = buildRenderPlan({
      layers: [cloud],
      runtimeState,
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "map",
    });

    const payload = buildInspectorPayload({
      longitude: -113.58,
      latitude: 53.31,
      frame: 0,
      activeLayers: [cloud],
      renderPlan,
      observations: fallbackObservations,
      alerts: [],
      sampledRgb: [80, 215, 210],
      sampledAtMs: Date.parse("2026-05-17T06:00:00Z"),
    });

    expect(payload.nearestStation).toContain("Edmonton");
    expect(payload.values.some((value) => value.label === "Station Temperature")).toBe(true);
    expect(payload.values.some((value) => value.label.startsWith("WMS Layer:"))).toBe(true);
    const microphysics = payload.values.find((value) => value.label === "GOES Microphysics RGB");
    expect(microphysics?.status).toBe("derived");
    expect(microphysics?.value).toContain("Night Microphysics");
    const precipHint = payload.values.find((value) => value.label === "Precip / Cloud Hint");
    expect(precipHint?.status).toBe("derived");
    expect(precipHint?.unit).toBe("night");
    expect(precipHint?.value).toMatch(/[a-z]/);
  });
});
