import { describe, expect, it } from "vitest";

import { buildLayerDefinitions } from "./registry";
import { buildInspectorPayload } from "./inspection";
import { buildRenderPlan } from "./renderPlan";
import { legendFromRamp } from "./legends";
import { fallbackLayers } from "../lib/layerRegistry";
import type { LayerDefinition, LayerRuntimeState } from "./types";
import type { Observation } from "../types/weather";

function makeObs(overrides: Partial<Observation> & Pick<Observation, "station_id" | "station_name" | "longitude" | "latitude" | "values">): Observation {
  return {
    observation_id: overrides.station_id + "_obs",
    elevation_m: null,
    source_id: "eccc",
    adapter: "eccc_geomet",
    observed_at: "2026-05-17T12:00:00Z",
    source_status: "live",
    quality_flags: ["measured"],
    retrieved_at: null,
    expires_at: null,
    raw_properties: {},
    units: {},
    ...overrides,
  };
}

const testObservations: Observation[] = [
  makeObs({
    station_id: "CYEG",
    station_name: "Edmonton Intl",
    longitude: -113.58,
    latitude: 53.31,
    values: {
      temperature_2m: 15.2,
      pressure_msl: 1011.2,
      wind_speed_10m: 5.4,
      wind_direction_10m: 240,
      precipitation_1h: 0.0,
      dewpoint_2m: 3.1,
    },
    units: {
      temperature_2m: "°C",
      pressure_msl: "hPa",
      wind_speed_10m: "m/s",
      wind_direction_10m: "°",
      precipitation_1h: "mm",
      dewpoint_2m: "°C",
    },
  }),
  makeObs({
    station_id: "CYVR",
    station_name: "Vancouver Intl",
    longitude: -123.12,
    latitude: 49.19,
    values: { temperature_2m: 12.0, pressure_msl: 1016.1 },
    units: { temperature_2m: "°C", pressure_msl: "hPa" },
  }),
  makeObs({
    station_id: "CYYC",
    station_name: "Calgary Intl",
    longitude: -114.02,
    latitude: 51.11,
    values: { temperature_2m: 10.5, pressure_msl: 1008.5 },
    units: { temperature_2m: "°C", pressure_msl: "hPa" },
  }),
];

describe("buildInspectorPayload", () => {
  it("populates hero metrics from station observations and exposes WMS rows", () => {
    const layers = buildLayerDefinitions({
      backendLayers: fallbackLayers,
      plugins: [],
      pluginEnabled: {},
    });
    // Synthesize a GOES cloud-type layer for the render plan so microphysics activates.
    const cloud = layers.find((layer) => layer.id === "eccc_goes_east_cloud_type");
    const runtimeState: Record<string, LayerRuntimeState> = cloud
      ? {
          [cloud.id]: {
            enabled: true,
            opacity: cloud.defaultOpacity,
            colourRamp: cloud.colourRamp,
            zIndex: cloud.zIndex,
            controls: cloud.controls,
            wmsTimePolicy: "latest",
          },
        }
      : {};

    const renderPlan = buildRenderPlan({
      layers: cloud ? [cloud] : [],
      runtimeState,
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "map",
    });

    const payload = buildInspectorPayload({
      longitude: -113.58,
      latitude: 53.31,
      frame: 0,
      activeLayers: cloud ? [cloud] : [],
      renderPlan,
      observations: testObservations,
      alerts: [],
      sampledRgb: [80, 215, 210],
      sampledAtMs: Date.parse("2026-05-17T06:00:00Z"),
    });

    expect(payload.nearestStation).toContain("Edmonton");
    expect(payload.nearestStationKm).not.toBeNull();

    const heroIds = payload.heroMetrics.map((metric) => metric.id);
    expect(heroIds).toContain("temperature");
    expect(heroIds).toContain("pressure");
    expect(heroIds).toContain("wind");
    expect(heroIds).toContain("density");
    const wind = payload.heroMetrics.find((metric) => metric.id === "wind")!;
    expect(wind.caption).toMatch(/F\d/);

    expect(payload.wmsLayers.length).toBeGreaterThan(0);
    expect(payload.wmsLayers[0].title).toBeTruthy();
  });

  it("detects pressure highs and lows across the station network", () => {
    const layers = buildLayerDefinitions({
      backendLayers: [],
      plugins: [],
      pluginEnabled: {},
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
      observations: testObservations,
      alerts: [],
    });

    expect(payload.pressureSystems.length).toBeGreaterThan(0);
    const kinds = new Set(payload.pressureSystems.map((entry) => entry.kind));
    expect(kinds.has("L") || kinds.has("H")).toBe(true);
  });

  it("does not present mock-flagged observations as live weather", () => {
    const mockObs: Observation[] = [
      makeObs({
        station_id: "MOCK1",
        station_name: "Mock Station",
        longitude: -113.58,
        latitude: 53.31,
        quality_flags: ["mock"],
        values: { temperature_2m: 20.0, pressure_msl: 1013.0 },
        units: { temperature_2m: "°C", pressure_msl: "hPa" },
      }),
    ];
    const payload = buildInspectorPayload({
      longitude: -113.58,
      latitude: 53.31,
      frame: 0,
      activeLayers: [],
      renderPlan: [],
      observations: mockObs,
      alerts: [],
    });

    expect(payload.nearestStation).toBeNull();
    expect(payload.nearestStationKm).toBeNull();
    expect(payload.heroMetrics).toEqual([]);
    expect(payload.pressureSystems).toEqual([]);
  });

  it("promotes calibrated surface-temperature canvas samples into hero metrics", () => {
    const layer: LayerDefinition = {
      id: "surface_temp_test",
      title: "Surface Temperature",
      description: "Test surface temperature layer.",
      category: "forecast",
      sourceId: "test",
      status: "live",
      isExperimental: false,
      defaultVisible: true,
      defaultOpacity: 1,
      zIndex: 1,
      colourRamp: "temperature-blue-red",
      legend: legendFromRamp("Surface Temperature", "degC", "temperature-blue-red"),
      rendererType: "deck-grid",
      capabilities: {
        supportsMap: true,
        supportsGlobe: false,
        supportsAnimation: true,
        supportsPicking: true,
        supportsShader: true,
        supportsWms: false,
        supportsCustomColorRamp: true,
        supportsOpacity: true,
      },
      animation: { frameCount: 1 },
      controls: {
        min: -35,
        max: 35,
        smoothing: 0.5,
        particleCount: 2000,
        windScale: 1,
        precipitationIntensity: 1,
        cloudOpacity: 0.7,
        contourInterval: 4,
        blendMode: "normal",
        edgeBlur: 0,
      },
      variable: "surface_temperature",
      unit: "degC",
    };
    const runtimeState: Record<string, LayerRuntimeState> = {
      [layer.id]: {
        enabled: true,
        opacity: 1,
        colourRamp: "temperature-blue-red",
        zIndex: 1,
        controls: layer.controls,
      },
    };
    const renderPlan = buildRenderPlan({
      layers: [layer],
      runtimeState,
      globalTimeMs: Date.parse("2026-05-17T12:00:00Z"),
      viewMode: "map",
    });
    const payload = buildInspectorPayload({
      longitude: -113.58,
      latitude: 53.31,
      frame: 0,
      activeLayers: [layer],
      renderPlan,
      runtimeState,
      observations: [],
      alerts: [],
      sampledRgb: [254, 224, 139],
      sampledAtMs: Date.parse("2026-05-17T12:00:00Z"),
    });

    expect(payload.heroMetrics[0]?.label).toBe("SFC TEMP");
    expect(Number(payload.heroMetrics[0]?.value)).toBeGreaterThan(5);
    expect(Number(payload.heroMetrics[0]?.value)).toBeLessThan(15);
  });
});
