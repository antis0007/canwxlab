import "maplibre-gl/dist/maplibre-gl.css";
import "./workbench.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MapView } from "./components/MapView";
import { LayersPicker, type BasemapId, BASEMAP_OPTIONS } from "./components/LayersPicker";
import { CityPicker } from "./components/CityPicker";
import { GifExportPanel } from "./components/workbench/GifExportPanel";
import { BottomTimeline } from "./components/workbench/BottomTimeline";
import { LeftSidebar } from "./components/workbench/LeftSidebar";
import { RightInspector } from "./components/workbench/RightInspector";
import { TopBar } from "./components/workbench/TopBar";
import { useAnimationTimeline } from "./layers/animation";
import { useLayerEngine } from "./layers/layerEngine";
import type { LayerDefinition, LayerDiagnostics, RendererFeatureValue, ViewMode, CameraState } from "./layers/types";
import { api } from "./lib/api";
import { logManager } from "./lib/logging";
import { useAppLogging } from "./hooks/useAppLogging";
import { useResizableWidth } from "./hooks/useResizableWidth";
import { builtInPresets } from "./layers/presets";
import type { DiffOverlayPayload } from "./layers/renderers/diffBitmap";
import {
  fallbackAlerts,
  fallbackLayers,
  fallbackObservations,
  fallbackSources,
} from "./lib/layerRegistry";
import {
  getStoredTimeZone,
  setStoredTimeZone,
} from "./lib/timezone";
import type { CityEntry } from "./lib/cityCatalog";
import { buildInspectorPayload, type InspectorWmsRow } from "./layers/inspection";
import { buildRenderPlan } from "./layers/renderPlan";
import { exportGif, downloadGif } from "./lib/gifExport";
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

const BASEMAP_STORAGE_KEY = "canwxlab.basemap.v3";
const LOCAL_STATE_PREFIX = "canwxlab.";
const INITIAL_OBSERVATION_LIMIT = 300;

function readBasemap(): BasemapId {
  if (typeof window === "undefined") return "blue_marble";
  const raw = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
  if (raw && BASEMAP_OPTIONS.some((o) => o.id === raw)) return raw as BasemapId;
  return "blue_marble";
}

function sourceStatusSummary(sources: DataSource[]): SourceStatus {
  if (sources.some((source) => source.status === "live")) return "live";
  if (sources.some((source) => source.status === "stale")) return "stale";
  if (sources.some((source) => source.status === "fallback")) return "fallback";
  if (sources.some((source) => source.status === "mock")) return "mock";
  return "unavailable";
}

async function clearClientStorage(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(LOCAL_STATE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
  try {
    Object.keys(window.sessionStorage)
      .filter((key) => key.startsWith(LOCAL_STATE_PREFIX))
      .forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    /* ignore */
  }
  if ("caches" in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(names.map((name) => window.caches.delete(name)));
    } catch {
      /* ignore */
    }
  }
}

export function statusMessage(
  sourceReport: SourceStatusResponse | null,
  globeCapabilityChecked: boolean,
  globeSupported: boolean,
): string[] {
  const notices: string[] = [];
  if (!sourceReport) return notices;

  const ogcSource = sourceReport.sources.find((source) => source.source_id === "eccc_geomet_ogc_api");
  if (ogcSource?.status === "fallback" || ogcSource?.status === "unavailable") {
    notices.push("Live source unavailable - showing fallback sources only");
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
  const [diffOverlay, setDiffOverlay] = useState<DiffOverlayPayload | null>(null);
  const [isRunningSimulation, setIsRunningSimulation] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isResettingExperience, setIsResettingExperience] = useState(false);
  const [activeTab, setActiveTab] = useState("layers");
  const [cameraState, setCameraState] = useState<CameraState>({ longitude: -35, latitude: 20, zoom: 1.6, bearing: 0, pitch: 0 });
  const cameraStateRef = useRef(cameraState);
  cameraStateRef.current = cameraState;
  const [cameraTarget, setCameraTarget] = useState<CameraState | null>(null);
  const [dynamicLayers, setDynamicLayers] = useState<WeatherLayer[]>([]);
  const [timelineMode, setTimelineMode] = useState("live");
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [basemap, setBasemap] = useState<BasemapId>(readBasemap);
  const [globeSupported, setGlobeSupported] = useState(false);
  const [globeCapabilityChecked, setGlobeCapabilityChecked] = useState(false);
  const [inspectorState, setInspectorState] = useState<{
    longitude: number | null;
    latitude: number | null;
    values: RendererFeatureValue[];
    heroMetrics: import("./layers/inspection").HeroMetric[];
    pressureSystems: import("./layers/pressureSystems").PressureSystem[];
    wmsLayerRows: InspectorWmsRow[];
    nearestStation: string | null;
    nearestStationKm: number | null;
    activeAlert: string | null;
  }>({
    longitude: null,
    latitude: null,
    values: [],
    heroMetrics: [],
    pressureSystems: [],
    wmsLayerRows: [],
    nearestStation: null,
    nearestStationKm: null,
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
    stepFrame,
    shiftWindowDays,
    toggle,
    reset,
  } = useAnimationTimeline();

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CityEntry | null>(null);
  const [gifExportOpen, setGifExportOpen] = useState(false);
  const [gifExportProgress, setGifExportProgress] = useState<[number, number] | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timeZone, setTimeZone] = useState<string>(() => getStoredTimeZone());

  const leftSidebar = useResizableWidth({
    storageKey: "leftSidebarWidth",
    defaultWidth: 300,
    minWidth: 220,
    maxWidth: 560,
    edge: "right",
  });
  const rightSidebar = useResizableWidth({
    storageKey: "rightSidebarWidth",
    defaultWidth: 320,
    minWidth: 240,
    maxWidth: 560,
    edge: "left",
  });

  useEffect(() => {
    setStoredTimeZone(timeZone);
  }, [timeZone]);

  const combinedLayers = useMemo(
    () => [...backendLayers, ...dynamicLayers],
    [backendLayers, dynamicLayers],
  );

  const layerEngine = useLayerEngine({
    backendLayers: combinedLayers,
    plugins,
  });

  useEffect(() => {
    writeViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    try { window.localStorage.setItem(BASEMAP_STORAGE_KEY, basemap); } catch {/* ignore */}
  }, [basemap]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      switch (event.key) {
        case " ":
          event.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
          event.preventDefault();
          stepFrame(event.shiftKey ? -10 : -1);
          break;
        case "ArrowRight":
          event.preventDefault();
          stepFrame(event.shiftKey ? 10 : 1);
          break;
        case "Home":
          event.preventDefault();
          setFrame(playbackState.loopStart);
          break;
        case "End":
          event.preventDefault();
          setFrame(playbackState.loopEnd);
          break;
        case "r":
        case "R":
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            reset();
          }
          break;
        case "g":
        case "G":
          if (!event.ctrlKey && !event.metaKey && globeSupported) {
            event.preventDefault();
            setViewMode((v) => (v === "globe" ? "map" : "globe"));
          }
          break;
        case "[":
          event.preventDefault();
          setSpeedMultiplier(Math.max(0.25, playbackState.speedMultiplier / 2));
          break;
        case "]":
          event.preventDefault();
          setSpeedMultiplier(Math.min(4, playbackState.speedMultiplier * 2));
          break;
        case "l":
        case "L":
          if (!event.ctrlKey && !event.metaKey) {
            event.preventDefault();
            setLayersOpen((v) => !v);
          }
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globeSupported, playbackState.loopEnd, playbackState.loopStart, playbackState.speedMultiplier, reset, setFrame, setSpeedMultiplier, stepFrame, toggle]);

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
    if (supported) {
      // Restore user preference once globe is confirmed available
      const stored = window.localStorage.getItem("canwxlab.viewMode.v2");
      if (stored === "globe") setViewMode("globe");
    }
  }, []);

  const applyPreset = useCallback((presetId: string) => {
    const preset = builtInPresets.find((p) => p.id === presetId);
    if (!preset) return;

    logManager.info("app", "Applying layer preset", { preset: presetId });

    const target = new Set(preset.categories);
    const categoryOpacity = preset.categoryOpacity ?? {};
    const maxPerCategory = preset.maxPerCategory;

    // Sort layers by zIndex descending so higher-on-top layers are enabled first
    // when a per-category cap is in effect.
    const sorted = [...layerEngine.orderedLayers].sort((a, b) => b.zIndex - a.zIndex);
    const catCounts = new Map<string, number>();

    sorted.forEach((layer) => {
      const shouldEnable = target.has(layer.category);
      if (!shouldEnable) {
        if (layerEngine.runtimeState[layer.id]?.enabled) {
          layerEngine.toggleLayer(layer.id);
        }
        return;
      }
      // Enforce maxPerCategory cap (sorted = highest zIndex layers first)
      if (typeof maxPerCategory === "number") {
        const catCount = catCounts.get(layer.category) ?? 0;
        if (catCount >= maxPerCategory) {
          if (layerEngine.runtimeState[layer.id]?.enabled) {
            layerEngine.toggleLayer(layer.id);
          }
          return;
        }
        catCounts.set(layer.category, catCount + 1);
      }
      if (!layerEngine.runtimeState[layer.id]?.enabled) {
        layerEngine.toggleLayer(layer.id);
      }
      const presetOpacity = categoryOpacity[layer.category];
      if (typeof presetOpacity === "number") {
        layerEngine.setLayerOpacity(layer.id, presetOpacity);
      }
    });
  }, [layerEngine]);

  const handleGifExport = useCallback(async (range: { startFrame: number; endFrame: number; frameDelay: number }) => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;

    setGifExportProgress([0, range.endFrame - range.startFrame + 1]);

    // Pause playback during export so WMS layers don't fight the frame-stepping
    const wasPlaying = playbackState.isPlaying;
    if (wasPlaying) toggle();

    try {
      const result = await exportGif({
        canvas,
        totalFrames: playbackState.frameCount,
        startFrame: range.startFrame,
        endFrame: range.endFrame,
        frameDelay: range.frameDelay,
        onRequestFrame: async (frame) => {
          setFrame(frame);
          // Wait for render: rAF × 2 gives WMS double-buffer time to promote
          await new Promise((resolve) => requestAnimationFrame(resolve));
          await new Promise((resolve) => requestAnimationFrame(resolve));
        },
        onProgress: (current, total) => {
          setGifExportProgress([current, total]);
        },
      });

      const tz = timeZone || "UTC";
      const label = new Date(playbackState.selectedValidTime).toLocaleString("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).replace(/[^a-zA-Z0-9]/g, "-");
      downloadGif(result.blob, `canwxlab-f${range.startFrame}-f${range.endFrame}-${label}.gif`);
    } catch (err) {
      logManager.error("app", "GIF export failed", { error: String(err) });
    } finally {
      setGifExportProgress(null);
      setGifExportOpen(false);
    }
  }, [playbackState.isPlaying, playbackState.frameCount, playbackState.selectedValidTime, timeZone, toggle, setFrame]);

  const refreshData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [status, layers, stations, hourly, activeAlerts, verification, pluginCatalog] = await Promise.all([
        api.sourceStatus(),
        api.layers(),
        api.observations({ limit: INITIAL_OBSERVATION_LIMIT }),
        api.hourlyObservations({ limit: INITIAL_OBSERVATION_LIMIT }),
        api.alerts(),
        api.verification(),
        api.plugins(),
      ]);

      setSourceReport(status);
      setSources(status.sources);
      setBackendLayers(layers);
      setObservations([...stations, ...hourly]);
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

  const freshStart = useCallback(async () => {
    if (typeof window !== "undefined") {
      const ok = window.confirm("Clear CanWxLab local settings, browser cache, and API cache, then reload?");
      if (!ok) return;
    }
    setIsResettingExperience(true);
    try {
      await Promise.allSettled([
        api.clearServerCache(),
        clearClientStorage(),
      ]);
    } finally {
      window.location.reload();
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

  // Poll the simulation run while it is queued/running. Stops as soon as the
  // backend reports a terminal state (completed / failed).
  useEffect(() => {
    if (!simulationRun) return;
    if (simulationRun.status !== "queued" && simulationRun.status !== "running") return;
    let cancelled = false;
    const runId = simulationRun.run_id;
    const interval = window.setInterval(async () => {
      try {
        const next = await api.getSimulationRun(runId);
        if (cancelled) return;
        setSimulationRun(next);
      } catch (error) {
        if (cancelled) return;
        setApiError(error instanceof Error ? error.message : "simulation poll failed");
      }
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [simulationRun]);

  // The inspector is always populated. If the operator has never clicked the
  // map, we auto-seed at the first available observation so the panel shows
  // real numbers immediately. Once the operator clicks, MapView's onInspect
  // takes over (handleInspect below sets clickedInspect = true).
  const [clickedInspect, setClickedInspect] = useState(false);
  useEffect(() => {
    if (clickedInspect) return;
    if (observations.length === 0) return;
    const seed = observations[0];
    const renderPlan = buildRenderPlan({
      layers: layerEngine.activeLayers,
      runtimeState: layerEngine.runtimeState,
      globalTimeMs: new Date(playbackState.selectedValidTime).getTime(),
      viewMode,
    });
    const payload = buildInspectorPayload({
      longitude: seed.longitude,
      latitude: seed.latitude,
      frame: playbackState.frame,
      activeLayers: layerEngine.activeLayers,
      renderPlan,
      observations,
      alerts,
      sampledRgb: null,
      sampledAtMs: new Date(playbackState.selectedValidTime).getTime(),
    });
    setInspectorState({
      longitude: payload.longitude,
      latitude: payload.latitude,
      values: payload.values,
      heroMetrics: payload.heroMetrics,
      pressureSystems: payload.pressureSystems,
      wmsLayerRows: payload.wmsLayers,
      nearestStation: payload.nearestStation,
      nearestStationKm: payload.nearestStationKm,
      activeAlert: payload.activeAlert,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [observations, clickedInspect, alerts, viewMode, playbackState.selectedValidTime]);

  const handleInspect = useCallback((payload: {
    longitude: number;
    latitude: number;
    values: RendererFeatureValue[];
    heroMetrics: import("./layers/inspection").HeroMetric[];
    pressureSystems: import("./layers/pressureSystems").PressureSystem[];
    wmsLayerRows: InspectorWmsRow[];
    nearestStation: string | null;
    nearestStationKm: number | null;
    activeAlert: string | null;
  }) => {
    setClickedInspect(true);
    setInspectorState(payload);
  }, []);

  const notices = useMemo(() => {
    const base = statusMessage(sourceReport, globeCapabilityChecked, globeSupported);
    if (apiError) base.push(`API error: ${apiError}`);
    if (pluginErrors.length > 0) base.push(`Plugin issues: ${pluginErrors.length}`);
    return base;
  }, [apiError, globeCapabilityChecked, globeSupported, pluginErrors.length, sourceReport]);

  const sourceHealth = useMemo(() => sourceStatusSummary(sources), [sources]);
  const activeLayerForLegend = layerEngine.activeLayers[layerEngine.activeLayers.length - 1] ?? null;

  return (
    <main className="wb-app">
      <TopBar
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
        isResettingExperience={isResettingExperience}
        onFreshStart={freshStart}
        timelineMode={timelineMode}
        onSetTimelineMode={setTimelineMode}
        onToggleLeftPanel={() => setLeftCollapsed(cur => !cur)}
        onToggleRightPanel={() => setRightCollapsed(cur => !cur)}
        leftPanelOpen={!leftCollapsed}
        rightPanelOpen={!rightCollapsed}
        timeZone={timeZone}
        onSetTimeZone={setTimeZone}
        onOpenCityPicker={() => setCityPickerOpen(true)}
      />

      <section
        className={`wb-main ${leftCollapsed ? 'left-collapsed' : ''} ${rightCollapsed ? 'right-collapsed' : ''}`}
        style={{
          ["--wb-left-width" as any]: `${leftSidebar.width}px`,
          ["--wb-right-width" as any]: `${rightSidebar.width}px`,
        }}
      >
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
          onReorderLayer={layerEngine.reorderLayer}
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
          onDiffOverlay={setDiffOverlay}
        />

        {!leftCollapsed && (
          <div
            className="wb-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize layers panel"
            title="Drag to resize · double-click to reset"
            {...leftSidebar.handlers}
          />
        )}

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
            onInspect={handleInspect}
            onDiagnostics={(partial) => setDiagnostics((current) => ({
              ...current,
              ...partial,
              mapMode: viewMode,
            }))}
            onGlobeSupportDetected={handleGlobeSupport}
            cameraTarget={cameraTarget}
            onCameraChange={setCameraState}
            basemap={basemap}
            photorealisticGlobe={layerEngine.uiPreferences.photorealisticGlobe ?? false}
            diffOverlay={diffOverlay}
            starExposure={layerEngine.uiPreferences.starExposure}
            starMaxDistanceLy={layerEngine.uiPreferences.starMaxDistanceLy}
            timelinePlaying={playbackState.isPlaying}
            timelineSpeedMultiplier={playbackState.speedMultiplier}
            onCanvasReady={(canvas) => { mapCanvasRef.current = canvas; }}
          />

          <LayersPicker
            basemap={basemap}
            onSetBasemap={setBasemap}
            layers={layerEngine.orderedLayers}
            runtimeState={layerEngine.runtimeState}
            onToggleLayer={layerEngine.toggleLayer}
            onSetLayerOpacity={layerEngine.setLayerOpacity}
            customStyleConfigured={Boolean(import.meta.env.VITE_MAP_STYLE_URL)}
            open={layersOpen}
            onSetOpen={setLayersOpen}
          />

          <BottomTimeline
            playback={playbackState}
            onSetFrame={setFrame}
            onSetLoopWindow={setLoopWindow}
            onTogglePlay={toggle}
            onStepFrame={stepFrame}
            onSetSpeed={setSpeedMultiplier}
            onShiftWindowDays={shiftWindowDays}
            timeZone={timeZone}
            onOpenGifExport={() => setGifExportOpen(true)}
          />
        </section>

        {!rightCollapsed && (
          <div
            className="wb-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            title="Drag to resize · double-click to reset"
            {...rightSidebar.handlers}
          />
        )}

        <RightInspector
          longitude={inspectorState.longitude}
          latitude={inspectorState.latitude}
          values={inspectorState.values}
          heroMetrics={inspectorState.heroMetrics}
          pressureSystems={inspectorState.pressureSystems}
          wmsLayerRows={inspectorState.wmsLayerRows}
          activeLayer={activeLayerForLegend}
          sources={sources}
          diagnostics={diagnostics}
          nearestStation={inspectorState.nearestStation}
          nearestStationKm={inspectorState.nearestStationKm}
          activeAlert={inspectorState.activeAlert}
          animationFrame={playbackState.frame}
          selectedValidTime={playbackState.selectedValidTime}
          runtimeState={layerEngine.runtimeState}
          timeZone={timeZone}
        />

        {cityPickerOpen && (
          <CityPicker
            onClose={() => setCityPickerOpen(false)}
            observations={observations}
            selectedCity={selectedCity}
            onPickCity={(city) => {
              setSelectedCity(city);
              setCameraTarget({
                longitude: city.longitude,
                latitude: city.latitude,
                zoom: Math.max(cameraStateRef.current.zoom, 6.5),
                bearing: 0,
                pitch: 0,
              });
            }}
            onAdoptTimeZone={(tz) => setTimeZone(tz)}
            cameraState={cameraState}
          />
        )}

        {gifExportOpen && (
          <GifExportPanel
            onClose={() => { if (!gifExportProgress) setGifExportOpen(false); }}
            totalFrames={playbackState.frameCount}
            onExport={handleGifExport}
            progress={gifExportProgress}
          />
        )}
      </section>
    </main>
  );
}
