import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LeftSidebar } from "./LeftSidebar";
import { TopBar } from "./TopBar";
import type {
  AnimationPlaybackState,
  LayerDefinition,
  LayerRuntimeState,
} from "../../layers/types";
import type {
  DataSource,
  PluginCatalogItem,
  VerificationMetric,
} from "../../types/weather";

const playback: AnimationPlaybackState = {
  isPlaying: true,
  speedMultiplier: 1,
  frame: 10,
  frameCount: 240,
  selectedValidTime: new Date().toISOString(),
  loopStart: 0,
  loopEnd: 239,
};

const layer: LayerDefinition = {
  id: "demo_temperature_field",
  title: "Demo Temperature Field",
  description: "Demo",
  category: "forecast",
  sourceId: "mock_canwxlab",
  status: "mock",
  isBuiltIn: true,
  isPlugin: false,
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
  animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
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
  },
  variable: "temperature_2m",
  unit: "degC",
};

const runtimeState: Record<string, LayerRuntimeState> = {
  demo_temperature_field: {
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
  source_id: "mock_canwxlab",
  name: "Mock Source",
  status: "mock",
  adapter: "mock",
  last_updated: new Date().toISOString(),
  last_successful_fetch: null,
  last_attempted_fetch: null,
  retrieved_at: null,
  expires_at: null,
  attribution: "Synthetic",
  description: "Mock",
  message: "Mock mode",
  is_live: false,
  is_experimental: false,
  metadata: {},
};

const metrics: VerificationMetric[] = [];

describe("workbench components", () => {
  it("renders map/globe toggle and animation controls", () => {
    const html = renderToStaticMarkup(
      <TopBar
        dataMode="hybrid"
        timelineTime={playback.selectedValidTime}
        viewMode="map"
        globeSupported={false}
        globeCapabilityChecked
        onSetViewMode={() => undefined}
        playback={playback}
        onTogglePlay={() => undefined}
        onSpeedChange={() => undefined}
        onResetAnimation={() => undefined}
        sourceHealthStatus="mock"
        isRefreshing={false}
        onRefresh={() => undefined}
        timelineMode="live"
        onSetTimelineMode={() => undefined}
        onToggleLeftPanel={() => undefined}
        onToggleRightPanel={() => undefined}
        leftPanelOpen
        rightPanelOpen
      />
    );

    expect(html).toContain("MAP");
    expect(html).toContain("GLOBE");
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
      />
    );

    expect(html).toContain("Demo Temperature Field");
    expect(html).toContain("MOCK");
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
      />
    );

    expect(pluginHtml).toContain("Radar Layer Renderer");
    expect(pluginHtml).toContain("BUILT-IN");
    expect(pluginHtml).toContain("Install Plugin (Planned)");
  });
});
