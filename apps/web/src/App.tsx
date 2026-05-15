import "maplibre-gl/dist/maplibre-gl.css";
import "./workbench.css";

import { useCallback, useEffect, useMemo, useState } from "react";

import { MapView } from "./components/MapView";
import { BottomTimeline } from "./components/workbench/BottomTimeline";
import { LeftSidebar } from "./components/workbench/LeftSidebar";
import { RightInspector } from "./components/workbench/RightInspector";
import { TopBar } from "./components/workbench/TopBar";
import { useAnimationTimeline } from "./layers/animation";
import { useLayerEngine } from "./layers/layerEngine";
import type { LayerDiagnostics, RendererFeatureValue, ViewMode, CameraState } from "./layers/types";
import { api } from "./lib/api";
import { logManager } from "./lib/logging";
import { useAppLogging } from "./hooks/useAppLogging";
import { builtInPresets } from "./layers/presets";
import {
  fallbackAlerts,
  fallbackLayers,
  fallbackObservations,
  fallbackSources,
} from "./lib/layerRegistry";
import type {
  AlertFeature,
  DataSource,
  Observation,
  PluginCatalogItem,
  SimulationRun,
  SourceStatusResponse,
  SourceStatus,
  VerificationMetric,
  WeatherLayer,
} from "./types/weather";

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "map";
  const raw = window.localStorage.getItem("canwxlab.viewMode.v2");
  return raw === "globe" ? "globe" : "map";
}

function writeViewMode(mode: ViewMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("canwxlab.viewMode.v2", mode);
}

function sourceStatusSummary(sources: DataSource[]): SourceStatus {
  if (sources.some((source) => source.status === "live")) return "live";
  if (sources.some((source) => source.status === "stale")) return "stale";
  if (sources.some((source) => source.status === "fallback")) return "fallback";
  if (sources.some((source) => source.status === "mock")) return "mock";
  return "unavailable";
}

export function statusMessage(
  sourceReport: SourceStatusResponse | null,
  globeCapabilityChecked: boolean,
  globeSupported: boolean,
): string[] {
  const notices: string[] = [];
  if (!sourceReport) return notices;

  const ogcSource = sourceReport.sources.find((source) => source.source_id === "eccc_geomet_ogc_api");
  if (!sourceReport.live_eccc_enabled) {
    notices.push("Live ECCC data disabled");
  } else if (ogcSource?.status === "fallback" || ogcSource?.status === "unavailable") {
    notices.push("Live source unavailable — showing mock data");
  }

  if (globeCapabilityChecked && !globeSupported) {
    notices.push("Globe projection not supported by this MapLibre build");
  }

  return notices;
}

export default function App() {
  useAppLogging();

  const [sourceReport, setSourceReport] = useState<SourceStatusResponse | null>(null);
  const [sources, setSources] = useState<DataSource[]>(fallbackSources);
  const [backendLayers, setBackendLayers] = useState<WeatherLayer[]>(fallbackLayers);
  const [observations, setObservations] = useState<Observation[]>(fallbackObservations);
  const [alerts, setAlerts] = useState<AlertFeature[]>(fallbackAlerts);
  const [metrics, setMetrics] = useState<VerificationMetric[]>([]);
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [pluginErrors, setPluginErrors] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
  const [isRunningSimulation, setIsRunningSimulation] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("layers");
  const [cameraState, setCameraState] = useState<CameraState>({ longitude: -97, latitude: 57, zoom: 3, bearing: 0, pitch: 0 });
  const [cameraTarget, setCameraTarget] = useState<CameraState | null>(null);
  const [dynamicLayers, setDynamicLayers] = useState<WeatherLayer[]>([]);
  const [timelineMode, setTimelineMode] = useState("live");
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [globeSupported, setGlobeSupported] = useState(false);
  const [globeCapabilityChecked, setGlobeCapabilityChecked] = useState(false);
  const [inspectorState, setInspectorState] = useState<{
    longitude: number | null;
    latitude: number | null;
    values: RendererFeatureValue[];
    nearestStation: string | null;
    activeAlert: string | null;
  }>({
    longitude: null,
    latitude: null,
    values: [],
    nearestStation: null,
    activeAlert: null,
  });

  const [diagnostics, setDiagnostics] = useState<LayerDiagnostics>({
    fps: 0,
    activeLayerCount: 0,
    animatedLayerCount: 0,
    lastDataRefreshAt: null,
    mapMode: "map",
    deckLayerCount: 0,
    warnings: [],
  });

  const {
    playbackState,
    setFrame,
    setSpeedMultiplier,
    setLoopWindow,
    toggle,
    reset,
  } = useAnimationTimeline();

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const layerEngine = useLayerEngine({
    backendLayers: [...backendLayers, ...dynamicLayers],
    plugins,
  });

  useEffect(() => {
    writeViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    document.documentElement.style.setProperty("--wb-accent", layerEngine.uiPreferences.accentColor);
  }, [layerEngine.uiPreferences.accentColor]);

  useEffect(() => {
    const themePreference = layerEngine.uiPreferences.theme;
    const resolvedTheme = themePreference === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : themePreference;
    document.documentElement.setAttribute("data-wb-theme", resolvedTheme);
    document.body.classList.toggle("wb-compact", layerEngine.uiPreferences.compactMode);
  }, [layerEngine.uiPreferences.compactMode, layerEngine.uiPreferences.theme]);

  const handleGlobeSupport = useCallback((supported: boolean) => {
    setGlobeCapabilityChecked(true);
    setGlobeSupported(supported);
    if (!supported && viewMode === "globe") {
      setViewMode("map");
    }
  }, [viewMode]);

  const applyPreset = useCallback((presetId: string) => {
    const preset = builtInPresets.find((p) => p.id === presetId);
    if (!preset) return;

    logManager.info("app", "Applying layer preset", { preset: presetId });

    layerEngine.orderedLayers.forEach((layer) => {
      const shouldEnable = preset.layers.includes(layer.id);
      const isEnabled = layerEngine.runtimeState[layer.id]?.enabled;
      if (shouldEnable !== isEnabled) {
        layerEngine.toggleLayer(layer.id);
      }
    });
  }, [layerEngine]);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [status, layers, stations, activeAlerts, verification, pluginCatalog] = await Promise.all([
        api.sourceStatus(),
        api.layers(),
        api.observations(),
        api.alerts(),
        api.verification(),
        api.plugins(),
      ]);

      setSourceReport(status);
      setSources(status.sources);
      setBackendLayers(layers);
      setObservations(stations);
      setAlerts(activeAlerts);
      setMetrics(verification);
      setPlugins(pluginCatalog.plugins);
      setPluginErrors(pluginCatalog.errors.map((error) => `${error.source_path}: ${error.error}`));
      setDiagnostics((current) => ({
        ...current,
        lastDataRefreshAt: new Date().toISOString(),
      }));
      setApiError(null);
      logManager.info("api", "Data refreshed successfully");
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : "Failed to fetch API data";
      setApiError(errorMsg);
      logManager.error("api", "Data refresh failed", { error: errorMsg });
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  const runSimulation = useCallback(async () => {
    setIsRunningSimulation(true);
    try {
      const run = await api.createSimulation({ duration_hours: 0.5, timestep_seconds: 30 });
      setSimulationRun(run);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Failed to run simulation");
    } finally {
      setIsRunningSimulation(false);
    }
  }, []);

  const notices = useMemo(() => {
    const base = statusMessage(sourceReport, globeCapabilityChecked, globeSupported);
    if (apiError) base.push(`API error: ${apiError}`);
    if (pluginErrors.length > 0) base.push(`Plugin issues: ${pluginErrors.length}`);
    return base;
  }, [apiError, globeCapabilityChecked, globeSupported, pluginErrors.length, sourceReport]);

  const sourceHealth = useMemo(() => sourceStatusSummary(sources), [sources]);
  const activeLayerForLegend = layerEngine.activeLayers[0] ?? null;

  return (
    <main className="wb-app">
      <TopBar
        dataMode={sourceReport?.data_mode ?? "mock"}
        timelineTime={playbackState.selectedValidTime}
        viewMode={viewMode}
        globeSupported={globeSupported}
        globeCapabilityChecked={globeCapabilityChecked}
        onSetViewMode={setViewMode}
        playback={playbackState}
        onTogglePlay={toggle}
        onSpeedChange={setSpeedMultiplier}
        onResetAnimation={reset}
        sourceHealthStatus={sourceHealth}
        isRefreshing={isRefreshing}
        onRefresh={refreshData}
        timelineMode={timelineMode}
        onSetTimelineMode={setTimelineMode}
        onToggleLeftPanel={() => setLeftCollapsed(cur => !cur)}
        onToggleRightPanel={() => setRightCollapsed(cur => !cur)}
        leftPanelOpen={!leftCollapsed}
        rightPanelOpen={!rightCollapsed}
      />

      <section className={`wb-main ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}>
        <LeftSidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          layers={layerEngine.orderedLayers}
          runtimeState={layerEngine.runtimeState}
          onToggleLayer={layerEngine.toggleLayer}
          onSetLayerOpacity={layerEngine.setLayerOpacity}
          onSetLayerRamp={layerEngine.setLayerRamp}
          onSetLayerControl={layerEngine.setLayerControl}
          onMoveLayer={layerEngine.moveLayer}
          onResetLayer={layerEngine.resetLayer}
          plugins={plugins}
          pluginEnabled={layerEngine.pluginEnabled}
          onSetPluginEnabled={layerEngine.setPluginEnabledState}
          sources={sources}
          simulationRun={simulationRun}
          isRunningSimulation={isRunningSimulation}
          onRunSimulation={runSimulation}
          metrics={metrics}
          uiPreferences={layerEngine.uiPreferences}
          onSetUiPreferences={layerEngine.setUiPreferences}
          onAddDynamicLayer={(layer) => setDynamicLayers(cur => [...cur.filter(l => l.layer_id !== layer.layer_id), layer])}
          cameraState={cameraState}
          onCameraTarget={setCameraTarget}
          onApplyPreset={applyPreset}
          onSetWmsTimePolicy={layerEngine.setWmsTimePolicy}
        />

        <section className="wb-map-area">
          {(notices.length > 0 || isRefreshing) && (
            <div className="wb-notice-row">
              {isRefreshing && <p className="wb-notice">Refreshing data…</p>}
              {notices.map((notice) => (
                <p key={notice} className="wb-notice">{notice}</p>
              ))}
            </div>
          )}

          <MapView
            layers={layerEngine.activeLayers}
            layerState={layerEngine.runtimeState}
            observations={observations}
            alerts={alerts}
            viewMode={viewMode}
            animationFrame={playbackState.frame}
            globalTimeMs={new Date(playbackState.selectedValidTime).getTime()}
            onInspect={setInspectorState}
            onDiagnostics={(partial) => setDiagnostics((current) => ({
              ...current,
              ...partial,
              mapMode: viewMode,
            }))}
            onGlobeSupportDetected={handleGlobeSupport}
            cameraTarget={cameraTarget}
            onCameraChange={setCameraState}
          />
        </section>

        <RightInspector
          longitude={inspectorState.longitude}
          latitude={inspectorState.latitude}
          values={inspectorState.values}
          activeLayer={activeLayerForLegend}
          sources={sources}
          diagnostics={diagnostics}
          nearestStation={inspectorState.nearestStation}
          activeAlert={inspectorState.activeAlert}
          animationFrame={playbackState.frame}
          selectedValidTime={playbackState.selectedValidTime}
          runtimeState={layerEngine.runtimeState}
        />
      </section>

      <BottomTimeline
        playback={playbackState}
        onSetFrame={setFrame}
        onSetLoopWindow={setLoopWindow}
      />
    </main>
  );
}
