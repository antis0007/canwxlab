import maplibregl from "maplibre-gl";

import { buildGibsWmtsTileUrl, buildMapLibreWmtsSource, buildMapLibreWmsSource, isGibsWmtsLayer, type WmsLayerDefinition } from "../../lib/wms";
import type { RenderLayerPlan } from "../types";
import { logManager } from "../../lib/logging";
import { isGeostationarySatellite } from "./satelliteComposite";

const WMS_ERROR_HOOK = "canwxlab.wms.errorHook";
const WMS_LAYER_STATE = "canwxlab.wms.layerState";
const WMS_TELEMETRY = "canwxlab.wms.telemetry";
const WMS_PLAYBACK_REQUEST_TILE_SIZE = 256;
const WMS_SETTLED_REQUEST_TILE_SIZE = 384;
// Pending tiles load at near-zero opacity behind the current tiles. They are
// promoted ONLY when isSourceLoaded() confirms every viewport tile arrived —
// never on a timeout, because promoting a partially-loaded tile is the root
// cause of flicker between frames. During playback, if tiles never finish
// loading, we keep showing the (stale) current frame — stale is better than
// flashing.
const WMS_PENDING_OPACITY = 0.001;
const WMS_RASTER_PAINT = {
  "raster-opacity": 1,
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
} as const;

// During playback, skip requesting a new WMS frame until the current one has
// been visible for at least this long. Scales inversely with speed so fast
// playback skips more frames instead of queueing doomed tile requests.
function playbackThrottleMs(speedMultiplier: number): number {
  return Math.round(1200 / Math.max(0.25, speedMultiplier));
}

interface WmsTileSetState {
  url: string;
  sourceId: string;
  layerId: string;
  requestedAt: number;
  failed?: boolean;
  tolerateTileErrors?: boolean;
  tileErrorCount?: number;
  detach?: () => void;
}

interface WmsMapLayerState {
  current?: WmsTileSetState;
  pending?: WmsTileSetState;
}

export interface WmsRendererTelemetry {
  pendingRasterFrames: number;
  promotedRasterFrames: number;
  failedRasterFrames: number;
  lastSourceError: string | null;
}

function wmsState(map: maplibregl.Map): Record<string, WmsMapLayerState> {
  const keyed = map as unknown as Record<string, Record<string, WmsMapLayerState>>;
  keyed[WMS_LAYER_STATE] ??= {};
  return keyed[WMS_LAYER_STATE];
}

function wmsTelemetry(map: maplibregl.Map): WmsRendererTelemetry {
  const keyed = map as unknown as Record<string, WmsRendererTelemetry>;
  keyed[WMS_TELEMETRY] ??= {
    pendingRasterFrames: 0,
    promotedRasterFrames: 0,
    failedRasterFrames: 0,
    lastSourceError: null,
  };
  return keyed[WMS_TELEMETRY];
}

export function getWmsRendererTelemetry(map: maplibregl.Map | null): WmsRendererTelemetry {
  if (!map) {
    return {
      pendingRasterFrames: 0,
      promotedRasterFrames: 0,
      failedRasterFrames: 0,
      lastSourceError: null,
    };
  }
  const telemetry = wmsTelemetry(map);
  telemetry.pendingRasterFrames = Object.values(wmsState(map)).filter((entry) => entry.pending).length;
  return { ...telemetry };
}

function hashUrl(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function removeWmsLayerAndSource(map: maplibregl.Map, layerId: string, sourceId: string) {
  try {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  } catch {
    /* style changed while cleaning */
  }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    /* source still in use or style changed */
  }
}

function scheduleWmsCleanup(map: maplibregl.Map, layerId: string, sourceId: string, isPlaying?: boolean) {
  const cleanup = () => removeWmsLayerAndSource(map, layerId, sourceId);
  // During playback, use a short safety timeout so stale layers don't accumulate
  // across rapid frame steps. The idle event fires as soon as the style is settled.
  const safetyMs = isPlaying ? 1500 : 4000;
  const timeout = window.setTimeout(cleanup, safetyMs);
  map.once("idle", () => {
    window.clearTimeout(timeout);
    cleanup();
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function setRasterLayerPaint(map: maplibregl.Map, layerId: string, plan: Pick<RenderLayerPlan, "opacity" | "visualFilters">) {
  if (!map.getLayer(layerId)) return;
  const filters = plan.visualFilters;
  const brightness = clamp(filters?.rasterBrightness ?? 0, -1, 1);
  map.setPaintProperty(layerId, "raster-opacity", plan.opacity);
  map.setPaintProperty(layerId, "raster-resampling", filters?.rasterSmoothing === "nearest" ? "nearest" : "linear");
  map.setPaintProperty(layerId, "raster-contrast", clamp(filters?.rasterContrast ?? 0, -1, 1));
  map.setPaintProperty(layerId, "raster-saturation", clamp(filters?.rasterSaturation ?? 0, -1, 1));
  map.setPaintProperty(layerId, "raster-brightness-min", brightness > 0 ? brightness : 0);
  map.setPaintProperty(layerId, "raster-brightness-max", brightness < 0 ? 1 + brightness : 1);
  map.setPaintProperty(layerId, "raster-fade-duration", 0);
}


function cleanupTileSet(map: maplibregl.Map, tileSet?: WmsTileSetState) {
  tileSet?.detach?.();
  if (tileSet) removeWmsLayerAndSource(map, tileSet.layerId, tileSet.sourceId);
}

function isSatelliteLike(plan: RenderLayerPlan): boolean {
  const product = String(plan.source.metadata?.intended_product_type ?? "").toLowerCase();
  return (
    product === "satellite" ||
    product === "cloud" ||
    String(plan.source.variable ?? "").toLowerCase().includes("satellite") ||
    String(plan.source.wmsLayerName ?? "").toLowerCase().includes("goes")
  );
}

function readLonLatBounds(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((part) => Number(part));
  if (nums.some((part) => !Number.isFinite(part))) return null;
  const [west, south, east, north] = nums;
  if (west >= east || south >= north) return null;
  return [
    Math.max(-180, Math.min(180, west)),
    Math.max(-90, Math.min(90, south)),
    Math.max(-180, Math.min(180, east)),
    Math.max(-90, Math.min(90, north)),
  ];
}

function wmsDefinitionForPlan(plan: RenderLayerPlan): WmsLayerDefinition | null {
  if (!plan.source.wmsBaseUrl || !plan.source.wmsLayerName) return null;
  return {
    layerId: plan.id,
    title: plan.source.title,
    status: plan.source.status,
    wmsBaseUrl: plan.source.wmsBaseUrl,
    wmsLayerName: plan.source.wmsLayerName,
    styles: plan.source.styles ?? [],
    timeDimensionSupported: Boolean(plan.source.timeExtent),
    bounds: readLonLatBounds(plan.source.metadata?.wms_bounds_lonlat),
  };
}

function promotePendingWms(map: maplibregl.Map, layerBaseId: string, plan: RenderLayerPlan, isPlaying?: boolean) {
  const state = wmsState(map)[layerBaseId];
  const pending = state?.pending;
  if (!state || !pending) return;
  if (pending.failed) {
    cleanupTileSet(map, pending);
    state.pending = undefined;
    return;
  }

  pending.detach?.();
  pending.detach = undefined;
  wmsTelemetry(map).promotedRasterFrames += 1;

  const previous = state.current;
  state.current = pending;
  state.pending = undefined;

  if (previous && previous.sourceId !== pending.sourceId) {
    previous.detach?.();
    setRasterLayerPaint(map, pending.layerId, plan);
    scheduleWmsCleanup(map, previous.layerId, previous.sourceId, isPlaying);
  } else {
    setRasterLayerPaint(map, pending.layerId, plan);
  }
}

function watchPendingWms(map: maplibregl.Map, layerBaseId: string, tileSet: WmsTileSetState, plan: RenderLayerPlan, isPlaying?: boolean) {
  if (tileSet.detach) return;
  let detached = false;
  // Safety-net timeout: if the WMS server never delivers all tiles, give up
  // after 20 s rather than stalling the layer forever. During normal operation
  // the sourcedata/idle listeners promote much sooner.
  let safetyTimeout = 0;

  const detach = () => {
    if (detached) return;
    detached = true;
    if (safetyTimeout) window.clearTimeout(safetyTimeout);
    map.off("sourcedata", onSourceData);
    map.off("idle", check);
  };

  const check = () => {
    const state = wmsState(map)[layerBaseId];
    if (!state?.pending || state.pending.sourceId !== tileSet.sourceId) {
      detach();
      return;
    }
    if (tileSet.failed) {
      detach();
      cleanupTileSet(map, tileSet);
      state.pending = undefined;
      return;
    }
    let loaded = false;
    try {
      loaded = map.isSourceLoaded(tileSet.sourceId);
    } catch {
      loaded = false;
    }
    if (loaded) {
      detach();
      promotePendingWms(map, layerBaseId, plan, isPlaying);
    }
  };

  const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
    if (event.sourceId === tileSet.sourceId) check();
  };

  map.on("sourcedata", onSourceData);
  map.on("idle", check);
  tileSet.detach = detach;
  safetyTimeout = window.setTimeout(() => {
    // Last-resort promotion after 20 s — prevents a layer from stalling
    // forever when the WMS server is reachable but never finishes loading
    // every viewport tile (e.g. partial tile errors).
    detach();
    promotePendingWms(map, layerBaseId, plan, isPlaying);
  }, tileSet.tolerateTileErrors ? 3500 : 20_000);
  check();
}

function isManagedWmsId(id: string, kind: "layer" | "source", layerIds: Set<string>): boolean {
  const prefix = kind === "layer" ? "wms-layer-" : "wms-source-";
  if (!id.startsWith(prefix)) return false;
  for (const layerId of layerIds) {
    if (id === `${prefix}${layerId}` || id.startsWith(`${prefix}${layerId}-`)) return true;
  }
  return false;
}

function reorderWmsLayers(map: maplibregl.Map, orderedLayerIds: string[]) {
  const state = wmsState(map);
  for (const layerId of orderedLayerIds) {
    const entry = state[layerId];
    if (!entry) continue;
    for (const tileSet of [entry.current, entry.pending]) {
      if (!tileSet || !map.getLayer(tileSet.layerId)) continue;
      try {
        map.moveLayer(tileSet.layerId);
      } catch {
        /* style changed while ordering */
      }
    }
  }
}

function ensureWmsErrorHook(map: maplibregl.Map) {
  const flagged = (map as unknown as Record<string, boolean>)[WMS_ERROR_HOOK];
  if (flagged) return;
  (map as unknown as Record<string, boolean>)[WMS_ERROR_HOOK] = true;
  map.on("error", (event) => {
    const e = event as unknown as { error?: Error; sourceId?: string; source?: { id?: string } };
    const sid = e.sourceId ?? e.source?.id ?? "";
    if (!sid.startsWith("wms-source-")) return;
    const telemetry = wmsTelemetry(map);
    telemetry.failedRasterFrames += 1;
    telemetry.lastSourceError = e.error?.message ?? "unknown WMS tile error";
    for (const [layerId, entry] of Object.entries(wmsState(map))) {
      let matched = false;
      let tolerant = false;
      for (const tileSet of [entry.current, entry.pending]) {
        if (tileSet?.sourceId === sid) {
          tileSet.tileErrorCount = (tileSet.tileErrorCount ?? 0) + 1;
          if (tileSet.tolerateTileErrors) {
            tolerant = true;
          } else {
            tileSet.failed = true;
          }
          matched = true;
        }
      }
      if (entry.pending?.sourceId === sid && !entry.pending.tolerateTileErrors) {
        entry.pending.detach?.();
        cleanupTileSet(map, entry.pending);
        entry.pending = undefined;
      }
      if (matched && !tolerant) {
        logManager.warn("wms", `WMS tile error on ${layerId}: ${telemetry.lastSourceError}`, {
          layerId,
          sourceId: sid,
        });
      }
    }
  });
}

const WMS_SYNC_LOCK = "canwxlab.wms.syncLock";

export function syncWmsLayers(options: {
  map: maplibregl.Map;
  renderPlan: RenderLayerPlan[];
  isPlaying?: boolean;
  speedMultiplier?: number;
}) {
  // Guard against overlapping calls — during rapid playback the React effect
  // can re-enter before the previous sync finishes, producing flicker.
  const lock = (options.map as unknown as Record<string, boolean>);
  if (lock[WMS_SYNC_LOCK]) return;
  lock[WMS_SYNC_LOCK] = true;
  try {
    ensureWmsErrorHook(options.map);
    const wmsLayers = options.renderPlan.filter((plan) => plan.visible && plan.rendererType === "wms-raster" && !isGeostationarySatellite(plan.id));
  const expectedLayerBaseIds = new Set(wmsLayers.map((plan) => plan.id));
  const state = wmsState(options.map);
  const telemetry = wmsTelemetry(options.map);
  telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;

  const style = options.map.getStyle();
  style.layers
    ?.filter((entry: { id: string }) => entry.id.startsWith("wms-layer-") && !isManagedWmsId(entry.id, "layer", expectedLayerBaseIds))
    .forEach((entry: { id: string }) => options.map.removeLayer(entry.id));
  Object.keys(style.sources)
    .filter((sourceId) => sourceId.startsWith("wms-source-") && !isManagedWmsId(sourceId, "source", expectedLayerBaseIds))
    .forEach((sourceId) => {
      if (options.map.getSource(sourceId)) {
        options.map.removeSource(sourceId);
      }
    });
  Object.keys(state)
    .filter((layerId) => !expectedLayerBaseIds.has(layerId))
    .forEach((layerId) => {
      cleanupTileSet(options.map, state[layerId].current);
      cleanupTileSet(options.map, state[layerId].pending);
      delete state[layerId];
  });

  wmsLayers.forEach((plan) => {
    const definition = wmsDefinitionForPlan(plan);
    if (!definition) return;

    const shouldRender = plan.visible;
    const current = state[plan.id];

    if (!shouldRender) {
      if (current) {
        cleanupTileSet(options.map, current.current);
        cleanupTileSet(options.map, current.pending);
        delete state[plan.id];
      }
      return;
    }

    const isGibs = isGibsWmtsLayer(definition);
    const gibsDate = plan.resolvedTime
      ? plan.resolvedTime.slice(0, 10)
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const source = isGibs
      ? buildMapLibreWmtsSource({
          tileUrl: buildGibsWmtsTileUrl({
            baseUrl: definition.wmsBaseUrl,
            product: definition.wmsLayerName ?? "",
            date: gibsDate,
            tileMatrixSet: typeof plan.source.metadata.gibs_tile_matrix === "string"
              ? plan.source.metadata.gibs_tile_matrix
              : undefined,
            format: typeof plan.source.metadata.gibs_image_format === "string"
              ? plan.source.metadata.gibs_image_format
              : undefined,
          }),
          minZoom: definition.minZoom ?? 0,
          maxZoom: definition.maxZoom ?? 9,
          sourceTileSize: 256,
        })
      : buildMapLibreWmsSource(definition, {
          time: plan.resolvedTime ?? undefined,
          requestTileSize: options.isPlaying && !isSatelliteLike(plan) ? WMS_PLAYBACK_REQUEST_TILE_SIZE : WMS_SETTLED_REQUEST_TILE_SIZE,
          sourceTileSize: 256,
        });
    const url = source.tiles[0];
    const currentTile = current?.current;
    const pendingTile = current?.pending;

    if (currentTile?.url === url) {
      if (options.map.getSource(currentTile.sourceId) && options.map.getLayer(currentTile.layerId)) {
        setRasterLayerPaint(options.map, currentTile.layerId, plan);
        if (pendingTile && pendingTile.url !== url && !options.isPlaying) {
          cleanupTileSet(options.map, pendingTile);
          current.pending = undefined;
        }
        return;
      }
      cleanupTileSet(options.map, currentTile);
      current.current = undefined;
    }

    if (pendingTile?.url === url) {
      if (options.map.getSource(pendingTile.sourceId) && options.map.getLayer(pendingTile.layerId)) {
        watchPendingWms(options.map, plan.id, pendingTile, plan, options.isPlaying);
        return;
      }
      cleanupTileSet(options.map, pendingTile);
      current.pending = undefined;
    }

    const throttleMs = playbackThrottleMs(options.speedMultiplier ?? 1);
    if (
      options.isPlaying &&
      current?.current &&
      !current.pending &&
      performance.now() - current.current.requestedAt < throttleMs
    ) {
      return;
    }

    if (current?.current && current.pending && options.isPlaying) {
      return;
    }

    if (current?.pending) {
      cleanupTileSet(options.map, current.pending);
      current.pending = undefined;
    }

    const sourceId = `wms-source-${plan.id}-${hashUrl(url)}`;
    const mapLayerId = `wms-layer-${plan.id}-${hashUrl(url)}`;

    try {
      if (!options.map.getSource(sourceId)) {
        options.map.addSource(sourceId, source as any);
      }
      if (!options.map.getLayer(mapLayerId)) {
        options.map.addLayer({
          id: mapLayerId,
          type: "raster",
          source: sourceId,
          paint: { ...WMS_RASTER_PAINT, "raster-opacity": current?.current ? WMS_PENDING_OPACITY : plan.opacity },
        });
      }
    } catch (error) {
      telemetry.failedRasterFrames += 1;
      telemetry.lastSourceError = error instanceof Error ? error.message : "failed to add WMS source";
      logManager.warn("wms", `Failed to add WMS source for ${plan.id}: ${telemetry.lastSourceError}`, {
        layerId: plan.id,
      });
      return;
    }
    const nextTileSet: WmsTileSetState = {
      url,
      sourceId,
      layerId: mapLayerId,
      requestedAt: performance.now(),
      tolerateTileErrors: true,
    };
    if (!state[plan.id]) state[plan.id] = {};
    if (state[plan.id].current) {
      state[plan.id].pending = nextTileSet;
      telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;
      watchPendingWms(options.map, plan.id, nextTileSet, plan, options.isPlaying);
    } else {
      state[plan.id].current = nextTileSet;
      setRasterLayerPaint(options.map, mapLayerId, plan);
    }
  });

    reorderWmsLayers(
      options.map,
      wmsLayers.map((plan) => plan.id),
    );
    telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;
  } finally {
    lock[WMS_SYNC_LOCK] = false;
  }
}
