import "maplibre-gl/dist/maplibre-gl.css";
import "./workbench.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MapView } from "./components/MapView";
import { LayersPicker, type BasemapId, BASEMAP_OPTIONS } from "./components/LayersPicker";
import { CityPicker } from "./components/CityPicker";
import { GifExportPanel } from "./components/workbench/GifExportPanel";
import { BottomTimeline, type TimelineWarningRange } from "./components/workbench/BottomTimeline";
import { LeftSidebar } from "./components/workbench/LeftSidebar";
import { RightInspector } from "./components/workbench/RightInspector";
import { TopBar } from "./components/workbench/TopBar";
import { HourlyForecastPanel } from "./components/workbench/HourlyForecastPanel";
import { useAnimationTimeline } from "./layers/animation";
import { useLayerEngine } from "./layers/layerEngine";
import type { CameraState, LayerDefinition, LayerDiagnostics, LayerRuntimeState, RendererFeatureValue, ViewMode } from "./layers/types";
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
import { parseWmsTimeDimension } from "./time/wmsTime";
import type { SatelliteCompositeLoadingState } from "./layers/renderers/satelliteComposite";
import { exportGif, downloadGif } from "./lib/gifExport";
import { EMPTY_ARCHIVE_SUMMARY, getArchiveSummary } from "./lib/archiveIndex";
import { buildSourceContractViews } from "./lib/planetaryCatalog";
import type { ArchiveSummary } from "./types/planetary";
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
const TERMINATOR_VISIBLE_STORAGE_KEY = "canwxlab.terminator.visible.v1";
const TERMINATOR_INTENSITY_STORAGE_KEY = "canwxlab.terminator.intensity.v1";
const LOCAL_STATE_PREFIX = "canwxlab.";
const INITIAL_OBSERVATION_LIMIT = 1000;
const TIMELINE_FRAME_INTERVAL_MS = 5 * 60 * 1000;

function readBasemap(): BasemapId {
  if (typeof window === "undefined") return "blue_marble";
  const raw = window.localStorage.getItem(BASEMAP_STORAGE_KEY);
  if (raw && BASEMAP_OPTIONS.some((o) => o.id === raw)) return raw as BasemapId;
  return "blue_marble";
}

function readTerminatorVisible(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TERMINATOR_VISIBLE_STORAGE_KEY) === "true";
}

function readTerminatorIntensity(): number {
  if (typeof window === "undefined") return 0.45;
  const raw = Number(window.localStorage.getItem(TERMINATOR_INTENSITY_STORAGE_KEY));
  if (!Number.isFinite(raw)) return 0.45;
  return Math.max(0, Math.min(1, raw));
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

function buildTimelineWarningRanges(input: {
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  windowStartMs: number;
  frameCount: number;
}): TimelineWarningRange[] {
  const maxFrame = Math.max(1, input.frameCount - 1);
  const windowEndMs = input.windowStartMs + maxFrame * TIMELINE_FRAME_INTERVAL_MS;
  const ranges: TimelineWarningRange[] = [];

  const frameAt = (ms: number) => (ms - input.windowStartMs) / TIMELINE_FRAME_INTERVAL_MS;

  for (const layer of input.layers) {
    const runtime = input.runtimeState[layer.id];
    if (!runtime?.enabled) continue;

    if (layer.status === "unavailable" || layer.status === "mock") {
      ranges.push({
        startFrame: 0,
        endFrame: maxFrame,
        severity: "error",
        label: `${layer.title} is not loadable from its selected source.`,
      });
      continue;
    }

    if (layer.status === "stale" || layer.status === "fallback") {
      ranges.push({
        startFrame: 0,
        endFrame: maxFrame,
        severity: "warning",
        label: `${layer.title} is using ${layer.status} data.`,
      });
    }

    const policy = runtime.wmsTimePolicy ?? "timeline";
    if (layer.rendererType !== "wms-raster" || policy === "latest" || policy === "fixed") continue;

    if (!layer.wmsBaseUrl || !layer.wmsLayerName) {
      ranges.push({
        startFrame: 0,
        endFrame: maxFrame,
        severity: "error",
        label: `${layer.title} is missing WMS configuration.`,
      });
      continue;
    }

    const extent = typeof layer.metadata?.time_extent === "string" ? layer.metadata.time_extent : "";
    const times = parseWmsTimeDimension(extent);
    if (times.length === 0) {
      ranges.push({
        startFrame: 0,
        endFrame: maxFrame,
        severity: "warning",
        label: `${layer.title} has no usable timeline extent.`,
      });
      continue;
    }

    const availableStart = times[0];
    const availableEnd = times[times.length - 1];
    if (availableStart > input.windowStartMs) {
      ranges.push({
        startFrame: 0,
        endFrame: Math.max(0, Math.min(maxFrame, frameAt(Math.min(availableStart, windowEndMs)))),
        severity: "warning",
        label: `${layer.title} has no frames before ${new Date(availableStart).toISOString()}.`,
      });
    }
    if (availableEnd < windowEndMs) {
      ranges.push({
        startFrame: Math.max(0, Math.min(maxFrame, frameAt(Math.max(availableEnd, input.windowStartMs)))),
        endFrame: maxFrame,
        severity: "warning",
        label: `${layer.title} has no frames after ${new Date(availableEnd).toISOString()}.`,
      });
    }

    // Detect internal data gaps (e.g. nighttime for visible satellite).
    // Only flags gaps fully enclosed by the visible window — leading/trailing
    // boundary checks above handle gaps that extend past window edges.
    if (times.length >= 2) {
      let windowStartIdx = -1;
      let windowEndIdx = -1;
      for (let i = 0; i < times.length; i++) {
        if (times[i] >= input.windowStartMs && times[i] <= windowEndMs) {
          if (windowStartIdx < 0) windowStartIdx = i;
          windowEndIdx = i;
        }
      }

      if (windowStartIdx >= 0 && windowEndIdx > windowStartIdx) {
        const windowIntervals: number[] = [];
        for (let i = windowStartIdx + 1; i <= windowEndIdx; i++) {
          const gap = times[i] - times[i - 1];
          if (gap > 0) windowIntervals.push(gap);
        }
        windowIntervals.sort((a, b) => a - b);
        const medianInterval = windowIntervals.length > 0
          ? windowIntervals[Math.floor(windowIntervals.length / 2)]
          : TIMELINE_FRAME_INTERVAL_MS;
        const gapThreshold = Math.max(medianInterval * 3, 30 * 60 * 1000);

        for (let i = windowStartIdx + 1; i <= windowEndIdx; i++) {
          const gap = times[i] - times[i - 1];
          if (gap <= gapThreshold) continue;
          const gapStartMs = times[i - 1];
          const gapEndMs = times[i];
          const startFrame = Math.max(0, Math.min(maxFrame, frameAt(gapStartMs)));
          const endFrame = Math.max(0, Math.min(maxFrame, frameAt(gapEndMs)));
          if (endFrame <= startFrame) continue;
          ranges.push({
            startFrame,
            endFrame,
            severity: "warning",
            label: `${layer.title} has no data from ${new Date(gapStartMs).toISOString()} to ${new Date(gapEndMs).toISOString()}.`,
          });
        }
      }
    }
  }

  return ranges.filter((range) => range.endFrame > range.startFrame);
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
  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [basemap, setBasemap] = useState<BasemapId>(readBasemap);
  const [terminatorVisible, setTerminatorVisible] = useState(readTerminatorVisible);
  const [terminatorIntensity, setTerminatorIntensity] = useState(readTerminatorIntensity);
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

  // Ref that MapView populates with a setter that writes directly to the
  // satellite compositor layer. The animation rAF calls this synchronously,
  // bypassing React's render cycle for zero-latency GPU timeProgress updates.
  const satelliteProgressRef = useRef<(progress: number, timelineMs: number) => void>(() => {});

  const {
    playbackState,
    setFrame,
    setSpeedMultiplier,
    setLoopWindow,
    stepFrame,
    shiftWindowDays,
    toggle,
    reset,
    returnLive,
    setForecastEnabled,
    setVisibleDays,
  } = useAnimationTimeline({
    onProgress: (progress, timelineMs) => satelliteProgressRef.current(progress, timelineMs),
  });

  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [hourlyForecastOpen, setHourlyForecastOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CityEntry | null>(null);
  const [gifExportOpen, setGifExportOpen] = useState(false);
  const [gifExportProgress, setGifExportProgress] = useState<[number, number] | null>(null);
  const mapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [satelliteLoadingState, setSatelliteLoadingState] = useState<SatelliteCompositeLoadingState | null>(null);
  const satelliteLoadingPendingRef = useRef<SatelliteCompositeLoadingState | null>(null);
  const satelliteLoadingTimerRef = useRef<number | null>(null);
  const satelliteLoadingLastCommitAtRef = useRef(0);
  const [timeZone, setTimeZone] = useState<string>(() => getStoredTimeZone());
  const [archiveSummary, setArchiveSummary] = useState<ArchiveSummary>(EMPTY_ARCHIVE_SUMMARY);

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
  const sourceContracts = useMemo(() => buildSourceContractViews(sources), [sources]);

  const refreshArchiveSummary = useCallback(async () => {
    setArchiveSummary(await getArchiveSummary());
  }, []);

  useEffect(() => {
    void refreshArchiveSummary();
    const id = window.setInterval(() => {
      void refreshArchiveSummary();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refreshArchiveSummary]);

  useEffect(() => {
    writeViewMode(viewMode);
  }, [viewMode]);

  useEffect(() => {
    try { window.localStorage.setItem(BASEMAP_STORAGE_KEY, basemap); } catch {/* ignore */}
  }, [basemap]);

  useEffect(() => {
    try { window.localStorage.setItem(TERMINATOR_VISIBLE_STORAGE_KEY, String(terminatorVisible)); } catch {/* ignore */}
  }, [terminatorVisible]);

  useEffect(() => {
    try { window.localStorage.setItem(TERMINATOR_INTENSITY_STORAGE_KEY, String(terminatorIntensity)); } catch {/* ignore */}
  }, [terminatorIntensity]);

  const flushSatelliteLoadingState = useCallback(() => {
    satelliteLoadingTimerRef.current = null;
    satelliteLoadingLastCommitAtRef.current = performance.now();
    setSatelliteLoadingState(satelliteLoadingPendingRef.current);
  }, []);

  const handleSatelliteLoadingState = useCallback((state: SatelliteCompositeLoadingState | null) => {
    satelliteLoadingPendingRef.current = state;
    const now = performance.now();
    const urgent = state === null || state.phase === "ready";
    const minIntervalMs = 160;
    const waitMs = minIntervalMs - (now - satelliteLoadingLastCommitAtRef.current);

    if (urgent || waitMs <= 0) {
      if (satelliteLoadingTimerRef.current !== null) {
        window.clearTimeout(satelliteLoadingTimerRef.current);
        satelliteLoadingTimerRef.current = null;
      }
      satelliteLoadingLastCommitAtRef.current = now;
      setSatelliteLoadingState(state);
      return;
    }

    if (satelliteLoadingTimerRef.current === null) {
      satelliteLoadingTimerRef.current = window.setTimeout(flushSatelliteLoadingState, waitMs);
    }
  }, [flushSatelliteLoadingState]);

  useEffect(() => {
    return () => {
      if (satelliteLoadingTimerRef.current !== null) {
        window.clearTimeout(satelliteLoadingTimerRef.current);
        satelliteLoadingTimerRef.current = null;
      }
    };
  }, []);

  const satelliteLoadingPercent = useMemo(() => {
    if (!satelliteLoadingState || satelliteLoadingState.totalSatellites === 0) return 0;
    if (satelliteLoadingState.phase === "ready") return 100;
    const required = Math.max(1, satelliteLoadingState.requiredFrames);
    const readyRatio = satelliteLoadingState.readySatellites / satelliteLoadingState.totalSatellites;
    const frameRatio = Math.min(1, satelliteLoadingState.bufferedFrames / required);
    return Math.round(Math.max(0, Math.min(1, readyRatio * frameRatio)) * 100);
  }, [satelliteLoadingState]);

  const satelliteLoadingMessage = useMemo(() => {
    if (!satelliteLoadingState || satelliteLoadingState.phase === "ready") return null;
    const { phase, inFlightFrames, pendingFlows, estimatedSecondsRemaining, readySatellites, totalSatellites, bufferedFrames, requiredFrames } = satelliteLoadingState;
    const remaining = estimatedSecondsRemaining !== null ? ` (~${estimatedSecondsRemaining}s)` : "";
    if (phase === "fetching" && inFlightFrames > 0) {
      return `Downloading satellite frames${remaining} — ${inFlightFrames} in flight, ${bufferedFrames}/${requiredFrames} buffered`;
    }
    if (phase === "computing-flow" && pendingFlows > 0) {
      return `Validating satellite motion${remaining} — ${pendingFlows} pair(s) remaining (client fallback, not server AMV/WV)`;
    }
    if (phase === "idle" && readySatellites < totalSatellites) {
      return `Waiting for satellite data — ${readySatellites}/${totalSatellites} satellites ready${remaining}`;
    }
    return `Loading satellite imagery — ${satelliteLoadingPercent}%`;
  }, [satelliteLoadingState, satelliteLoadingPercent]);

  const showSatelliteLoading = Boolean(
    satelliteLoadingState
      && satelliteLoadingState.totalSatellites > 0
      && satelliteLoadingState.phase !== "ready"
      && !playbackState.isPlaying,
  );

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

    // MapLibre canvas sits inside the map container alongside deck.gl's overlay
    // canvas (MapboxOverlay with interleaved:false). Query all canvases in the
    // container and composite them so station markers, alert polygons, satellite
    // compositor, and terminator appear in the export.
    const container = canvas.parentElement;
    const allCanvases = container
      ? Array.from(container.querySelectorAll("canvas"))
      : [];
    const overlayCanvases = allCanvases.filter(
      (c) => c !== canvas && c.width > 0 && c.height > 0,
    );

    setGifExportProgress([0, range.endFrame - range.startFrame + 1]);

    // Pause playback during export so WMS layers don't fight the frame-stepping
    const wasPlaying = playbackState.isPlaying;
    if (wasPlaying) toggle();

    try {
      const result = await exportGif({
        canvas,
        overlayCanvases,
        totalFrames: playbackState.frameCount,
        startFrame: range.startFrame,
        endFrame: range.endFrame,
        frameDelay: range.frameDelay,
        onRequestFrame: async (frame) => {
          setFrame(frame);
        },
        onProgress: (current, total) => {
          setGifExportProgress([current, total]);
        },
      });

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
  }, [playbackState.isPlaying, playbackState.frameCount, playbackState.selectedValidTime, toggle, setFrame]);

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
      runtimeState: layerEngine.runtimeState,
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
  const timelineWindowStartMs = playbackState.timelineState.replayStartMs;
  const timelineWarningRanges = useMemo(
    () => buildTimelineWarningRanges({
      layers: layerEngine.activeLayers,
      runtimeState: layerEngine.runtimeState,
      windowStartMs: timelineWindowStartMs,
      frameCount: playbackState.frameCount,
    }),
    [layerEngine.activeLayers, layerEngine.runtimeState, playbackState.frameCount, timelineWindowStartMs],
  );
  const timelineSolarReference = useMemo(
    () => ({
      latitude: selectedCity?.latitude ?? cameraState.latitude,
      longitude: selectedCity?.longitude ?? cameraState.longitude,
    }),
    [cameraState.latitude, cameraState.longitude, selectedCity?.latitude, selectedCity?.longitude],
  );

  return (
    <main className="wb-app">
      <TopBar
        timelineTime={playbackState.selectedValidTime}
        viewMode={viewMode}
        globeSupported={globeSupported}
        globeCapabilityChecked={globeCapabilityChecked}
        onSetViewMode={setViewMode}
        playback={playbackState}
        timelineState={playbackState.timelineState}
        onTogglePlay={toggle}
        onSpeedChange={setSpeedMultiplier}
        onResetAnimation={reset}
        onReturnLive={returnLive}
        onSetForecastEnabled={setForecastEnabled}
        sourceHealthStatus={sourceHealth}
        isRefreshing={isRefreshing}
        onRefresh={refreshData}
        isResettingExperience={isResettingExperience}
        onFreshStart={freshStart}
        onToggleLeftPanel={() => setLeftCollapsed(cur => !cur)}
        onToggleRightPanel={() => setRightCollapsed(cur => !cur)}
        leftPanelOpen={!leftCollapsed}
        rightPanelOpen={!rightCollapsed}
        timeZone={timeZone}
        onSetTimeZone={setTimeZone}
        onOpenCityPicker={() => setCityPickerOpen(true)}
        onToggleHourlyForecast={() => setHourlyForecastOpen(cur => !cur)}
        hourlyForecastOpen={hourlyForecastOpen}
        terminatorVisible={terminatorVisible}
        terminatorIntensity={terminatorIntensity}
        onSetTerminatorVisible={setTerminatorVisible}
        onSetTerminatorIntensity={setTerminatorIntensity}
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
          selectedValidTime={playbackState.selectedValidTime}
          timelineState={playbackState.timelineState}
          sourceContracts={sourceContracts}
          archiveSummary={archiveSummary}
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
          {showSatelliteLoading && satelliteLoadingState && (
            <div className="wb-satellite-loading" role="status" aria-live="polite">
              <div
                className="wb-satellite-loading-track"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={satelliteLoadingPercent}
                role="progressbar"
              >
                <div
                  className="wb-satellite-loading-fill"
                  style={{ width: `${satelliteLoadingPercent}%` }}
                />
              </div>
              <div className="wb-satellite-loading-meta">
                <span>{satelliteLoadingMessage ?? `Loading satellite imagery — ${satelliteLoadingPercent}%`}</span>
                <span className="wb-satellite-loading-detail">
                  {satelliteLoadingState.readySatellites}/{satelliteLoadingState.totalSatellites} satellites, {satelliteLoadingState.bufferedFrames}/{satelliteLoadingState.requiredFrames} frames
                  {satelliteLoadingState.estimatedSecondsRemaining !== null && (
                    <> &middot; ~{satelliteLoadingState.estimatedSecondsRemaining}s remaining</>
                  )}
                </span>
              </div>
            </div>
          )}
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
            globalTimeMs={new Date(playbackState.selectedContinuousTime).getTime()}
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
            globePhotoGrade={layerEngine.uiPreferences.globePhotoGrade ?? true}
            terminatorVisible={terminatorVisible}
            terminatorIntensity={terminatorIntensity}
            diffOverlay={diffOverlay}
            starExposure={layerEngine.uiPreferences.starExposure}
            starMaxDistanceLy={layerEngine.uiPreferences.starMaxDistanceLy}
            renderQuality={layerEngine.uiPreferences.renderQuality ?? "balanced"}
            timelinePlaying={playbackState.isPlaying}
            timelineSpeedMultiplier={playbackState.speedMultiplier}
            satelliteSubFrameProgress={playbackState.subFrameProgress}
            satelliteTimelineMs={new Date(playbackState.selectedContinuousTime).getTime()}
            satelliteProgressRef={satelliteProgressRef}
            onSatelliteLoadingState={handleSatelliteLoadingState}
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
            onSetVisibleDays={setVisibleDays}
            onReturnLive={returnLive}
            timeZone={timeZone}
            onOpenGifExport={() => setGifExportOpen(true)}
            warningRanges={timelineWarningRanges}
            timelineState={playbackState.timelineState}
            solarReference={timelineSolarReference}
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

        {hourlyForecastOpen && (
          <HourlyForecastPanel
            latitude={inspectorState.latitude}
            longitude={inspectorState.longitude}
            timeZone={timeZone}
            onClose={() => setHourlyForecastOpen(false)}
          />
        )}

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
