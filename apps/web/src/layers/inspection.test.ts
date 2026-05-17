import { describe, expect, it } from "vitest";

import { fallbackLayers, fallbackObservations } from "../lib/layerRegistry";
import { buildLayerDefinitions } from "./registry";
import { buildInspectorPayload } from "./inspection";
import { buildRenderPlan } from "./renderPlan";
import type { LayerRuntimeState } from "./types";

describe("buildInspectorPayload", () => {
  it("populates hero metrics from station observations and exposes WMS rows", () => {
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
    expect(payload.nearestStationKm).not.toBeNull();

    // Hero metric cards must include real station numbers.
    const heroIds = payload.heroMetrics.map((metric) => metric.id);
    expect(heroIds).toContain("temperature");
    expect(heroIds).toContain("pressure");
    expect(heroIds).toContain("wind");
    // Air density is derived from temp + pressure.
    expect(heroIds).toContain("density");
    const wind = payload.heroMetrics.find((metric) => metric.id === "wind")!;
    expect(wind.caption).toMatch(/F\d/);

    // WMS-in-view rows are surfaced separately, not in the free-form values list.
    expect(payload.wmsLayers.length).toBeGreaterThan(0);
    expect(payload.wmsLayers[0].title).toBeTruthy();

    // Microphysics analysis + precip hint sit in the free-form values list.
    const microphysics = payload.values.find((value) => value.label === "GOES Microphysics RGB");
    expect(microphysics?.status).toBe("derived");
    expect(microphysics?.value).toContain("Night Microphysics");
    const precipHint = payload.values.find((value) => value.label === "Precip / Cloud Hint");
    expect(precipHint?.status).toBe("derived");
    expect(precipHint?.unit).toBe("night");
  });

  it("detects pressure highs and lows across the station network", () => {
    const layers = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
      dataMode: "mock",
    });
    const renderPlan = buildRenderPlan({
      layers: [],
      runtimeState: {},
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "map",
    });
    const payload = buildInspectorPayload({
      longitude: -113.58,
      latitude: 53.31,
      frame: 0,
      activeLayers: layers.slice(0, 2),
      renderPlan,
      observations: fallbackObservations,
      alerts: [],
    });

    // The seed fallback observations have Vancouver at 1016.1 hPa (highest),
    // Edmonton at 1011.2 hPa (middle), Calgary at 1008.5 hPa (lowest); the
    // detector should flag at least one of those extremes.
    expect(payload.pressureSystems.length).toBeGreaterThan(0);
    const kinds = new Set(payload.pressureSystems.map((entry) => entry.kind));
    expect(kinds.has("L") || kinds.has("H")).toBe(true);
  });
});
