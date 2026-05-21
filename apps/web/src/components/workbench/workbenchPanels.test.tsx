import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeftSidebar } from "./LeftSidebar";
import { buildTicks, clampTimelineInputFrame, timelineMaxFrame } from "./BottomTimeline";
import { TopBar } from "./TopBar";
import { EMPTY_ARCHIVE_SUMMARY } from "../../lib/archiveIndex";
import { buildSourceContractViews } from "../../lib/planetaryCatalog";
import type {
  AnimationPlaybackState,
  LayerDefinition,
  LayerRuntimeState,
} from "../../layers/types";
import type { PlanetaryTimelineState } from "../../types/planetary";
import type {
  DataSource,
  PluginCatalogItem,
  VerificationMetric,
} from "../../types/weather";

const playback: AnimationPlaybackState = {
  isPlaying: true,
  speedMultiplier: 1,
  playheadFrame: 288,
  frame: 288,
  frameCount: 865,
  selectedValidTime: new Date().toISOString(),
  selectedContinuousTime: new Date().toISOString(),
  loopStart: 0,
  loopEnd: 288,
  subFrameProgress: 0,
  liveFrame: 288,
  forecastFrame: 864,
  timelineState: {
    mode: "live",
    isTrackingLive: true,
    forecastEnabled: false,
    selectedTimeMs: Date.parse("2026-05-20T00:00:00.000Z"),
    liveTimeMs: Date.parse("2026-05-20T00:00:00.000Z"),
    replayStartMs: Date.parse("2026-05-19T00:00:00.000Z"),
    replayEndMs: Date.parse("2026-05-20T00:00:00.000Z"),
    forecastEndMs: Date.parse("2026-05-22T00:00:00.000Z"),
  },
};

const layer: LayerDefinition = {
  id: "eccc_climate_stations",
  title: "ECCC Climate Stations",
  description: "Official ECCC station observations.",
  category: "observation",
  sourceId: "eccc_geomet_ogc_api",
  status: "live",
  isExperimental: false,
  defaultVisible: true,
  defaultOpacity: 0.7,
  zIndex: 1,
  colourRamp: "temperature-blue-red",
  legend: {
    title: "Temperature",
    unit: "degC",
    gradient: "linear-gradient(90deg, #000, #fff)",
    stops: [{ value: 0, color: "#000", label: "0" }],
  },
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
  animation: { frameCount: 240 },
  controls: {
    min: 0,
    max: 1,
    smoothing: 0.5,
    particleCount: 1200,
    windScale: 1,
    precipitationIntensity: 1,
    cloudOpacity: 0.7,
    contourInterval: 4,
    blendMode: "normal",
    edgeBlur: 0,
  },
  variable: "temperature_2m",
  unit: "degC",
};

const runtimeState: Record<string, LayerRuntimeState> = {
  eccc_climate_stations: {
    enabled: true,
    opacity: 0.7,
    colourRamp: "temperature-blue-red",
    zIndex: 1,
    controls: layer.controls,
  },
};

const plugin: PluginCatalogItem = {
  id: "core_radar_layer",
  name: "Radar Layer Renderer",
  version: "0.1.0",
  author: "CanWxLab",
  api_version: "0.1",
  plugin_type: "layer",
  safety_level: "core",
  required_variables: ["precipitation_rate"],
  produced_variables: ["radar_visual_layer"],
  config_schema: {},
  description: "Radar renderer",
  enabled_default: true,
  source_path: "plugins/core/layers/radar/plugin.toml",
  status: "installed",
  is_builtin: true,
  contributes_layers: true,
  contributes_diagnostics: false,
  manifest_errors: [],
};

const source: DataSource = {
  source_id: "eccc_geomet_ogc_api",
  name: "ECCC GeoMet OGC API",
  status: "live",
  adapter: "eccc_geomet",
  last_updated: new Date().toISOString(),
  last_successful_fetch: null,
  last_attempted_fetch: null,
  retrieved_at: null,
  expires_at: null,
  attribution: "Environment and Climate Change Canada / Meteorological Service of Canada.",
  description: "Official ECCC GeoMet source.",
  message: "Live source available.",
  is_live: true,
  is_experimental: false,
  metadata: {},
};

const metrics: VerificationMetric[] = [];
const timelineState: PlanetaryTimelineState = playback.timelineState;
const sourceContracts = buildSourceContractViews([source]);

describe("workbench components", () => {
  it("aligns timeline tick labels to the selected local time zone", () => {
    const startMs = Date.parse("2026-05-15T00:00:00Z");
    const frameCount = 24 * 12 + 1;
    const utcTicks = buildTicks(startMs, frameCount, "UTC");
    const edmontonTicks = buildTicks(startMs, frameCount, "America/Edmonton");

    expect(utcTicks.find((tick) => tick.label === "06:00Z")?.pct).toBeCloseTo(25, 4);
    expect(edmontonTicks.find((tick) => tick.label === "06:00")?.pct).toBeCloseTo(50, 4);
  });

  it("blocks future timeline input unless forecast is enabled", () => {
    const locked = { ...timelineState, forecastEnabled: false };
    const unlocked = { ...timelineState, forecastEnabled: true };

    expect(timelineMaxFrame(playback, locked)).toBe(playback.liveFrame);
    expect(clampTimelineInputFrame(playback.forecastFrame, playback, locked)).toBe(playback.liveFrame);
    expect(timelineMaxFrame(playback, unlocked)).toBe(playback.forecastFrame);
    expect(clampTimelineInputFrame(playback.forecastFrame, playback, unlocked)).toBe(playback.forecastFrame);
  });

  it("renders map/globe toggle and animation controls", () => {
    const html = renderToStaticMarkup(
      <TopBar
        timelineTime={playback.selectedValidTime}
        viewMode="map"
        globeSupported={false}
        globeCapabilityChecked
        onSetViewMode={() => undefined}
        playback={playback}
        timelineState={timelineState}
        onTogglePlay={() => undefined}
        onSpeedChange={() => undefined}
        onResetAnimation={() => undefined}
        onReturnLive={() => undefined}
        onSetForecastEnabled={() => undefined}
        sourceHealthStatus="live"
        isRefreshing={false}
        onRefresh={() => undefined}
        onFreshStart={() => undefined}
        onToggleLeftPanel={() => undefined}
        onToggleRightPanel={() => undefined}
        leftPanelOpen
        rightPanelOpen
        timeZone="UTC"
        onSetTimeZone={() => undefined}
        onOpenCityPicker={() => undefined}
        onToggleHourlyForecast={() => undefined}
        hourlyForecastOpen={false}
        terminatorVisible={false}
        terminatorIntensity={0.45}
        onSetTerminatorVisible={() => undefined}
        onSetTerminatorIntensity={() => undefined}
      />
    );

    expect(html).toContain("MAP");
    expect(html).toContain("GLOBE");
    expect(html).toContain("NIGHT");
    expect(html).toContain("LIVE");
    expect(html).toContain("FCST");
    expect(html).toContain("CanWxLab");
  });

  it("renders layers and plugin manager badges", () => {
    const html = renderToStaticMarkup(
      <LeftSidebar
        activeTab="layers"
        onTabChange={() => undefined}
        layers={[layer]}
        runtimeState={runtimeState}
        onToggleLayer={() => undefined}
        onSetLayerOpacity={() => undefined}
        onSetLayerRamp={() => undefined}
        onSetLayerControl={() => undefined}
        onMoveLayer={() => undefined}
        onReorderLayer={() => undefined}
        onResetLayer={() => undefined}
        plugins={[plugin]}
        pluginEnabled={{ core_radar_layer: true }}
        onSetPluginEnabled={() => undefined}
        sources={[source]}
        simulationRun={null}
        isRunningSimulation={false}
        onRunSimulation={() => undefined}
        metrics={metrics}
        uiPreferences={{
          compactMode: true,
          theme: "dark",
          accentColor: "#58d0bf",
          mapBackgroundStyle: "default",
          photorealisticGlobe: false,
          units: {
            temperature: "C",
            wind: "m/s",
            pressure: "hPa",
            precipitation: "mm",
          },
        }}
        onSetUiPreferences={() => undefined}
        cameraState={{ longitude: 0, latitude: 0, zoom: 0, bearing: 0, pitch: 0 }}
        onCameraTarget={() => undefined}
        selectedValidTime="2026-05-20T00:00:00.000Z"
        timelineState={timelineState}
        sourceContracts={sourceContracts}
        archiveSummary={EMPTY_ARCHIVE_SUMMARY}
      />
    );

    expect(html).toContain("ECCC Climate Stations");
    expect(html).toContain("checked");

    const pluginHtml = renderToStaticMarkup(
      <LeftSidebar
        activeTab="plugins"
        onTabChange={() => undefined}
        layers={[layer]}
        runtimeState={runtimeState}
        onToggleLayer={() => undefined}
        onSetLayerOpacity={() => undefined}
        onSetLayerRamp={() => undefined}
        onSetLayerControl={() => undefined}
        onMoveLayer={() => undefined}
        onReorderLayer={() => undefined}
        onResetLayer={() => undefined}
        plugins={[plugin]}
        pluginEnabled={{ core_radar_layer: true }}
        onSetPluginEnabled={() => undefined}
        sources={[source]}
        simulationRun={null}
        isRunningSimulation={false}
        onRunSimulation={() => undefined}
        metrics={metrics}
        uiPreferences={{
          compactMode: true,
          theme: "dark",
          accentColor: "#58d0bf",
          mapBackgroundStyle: "default",
          photorealisticGlobe: false,
          units: {
            temperature: "C",
            wind: "m/s",
            pressure: "hPa",
            precipitation: "mm",
          },
        }}
        onSetUiPreferences={() => undefined}
        cameraState={{ longitude: 0, latitude: 0, zoom: 0, bearing: 0, pitch: 0 }}
        onCameraTarget={() => undefined}
        selectedValidTime="2026-05-20T00:00:00.000Z"
        timelineState={timelineState}
        sourceContracts={sourceContracts}
        archiveSummary={EMPTY_ARCHIVE_SUMMARY}
      />
    );

    expect(pluginHtml).toContain("Radar Layer Renderer");
    expect(pluginHtml).toContain("BUILT-IN");
    expect(pluginHtml).toContain("Install Plugin (Planned)");
  });

  it("renders planetary timeline, source contract, and archive state", () => {
    const html = renderToStaticMarkup(
      <LeftSidebar
        activeTab="planetary"
        onTabChange={() => undefined}
        layers={[layer]}
        runtimeState={runtimeState}
        onToggleLayer={() => undefined}
        onSetLayerOpacity={() => undefined}
        onSetLayerRamp={() => undefined}
        onSetLayerControl={() => undefined}
        onMoveLayer={() => undefined}
        onReorderLayer={() => undefined}
        onResetLayer={() => undefined}
        plugins={[plugin]}
        pluginEnabled={{ core_radar_layer: true }}
        onSetPluginEnabled={() => undefined}
        sources={[source]}
        simulationRun={null}
        isRunningSimulation={false}
        onRunSimulation={() => undefined}
        metrics={metrics}
        uiPreferences={{
          compactMode: true,
          theme: "dark",
          accentColor: "#58d0bf",
          mapBackgroundStyle: "default",
          photorealisticGlobe: false,
          units: {
            temperature: "C",
            wind: "m/s",
            pressure: "hPa",
            precipitation: "mm",
          },
        }}
        onSetUiPreferences={() => undefined}
        cameraState={{ longitude: 0, latitude: 0, zoom: 0, bearing: 0, pitch: 0 }}
        onCameraTarget={() => undefined}
        selectedValidTime="2026-05-20T00:00:00.000Z"
        timelineState={timelineState}
        sourceContracts={sourceContracts}
        archiveSummary={{ ...EMPTY_ARCHIVE_SUMMARY, assetCount: 2, allowedCount: 1, unknownCount: 1 }}
      />
    );

    expect(html).toContain("Timeline state");
    expect(html).toContain("Local archive");
    expect(html).toContain("MSC GeoMet");
    expect(html).toContain("Costed Weather Archive");
  });
});
