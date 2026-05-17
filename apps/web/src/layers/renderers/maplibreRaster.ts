import maplibregl from "maplibre-gl";

import { buildMapLibreWmsSource, type WmsLayerDefinition } from "../../lib/wms";
import type { RenderLayerPlan } from "../types";
import { logManager } from "../../lib/logging";

const WMS_ERROR_HOOK = "canwxlab.wms.errorHook";
const WMS_LAYER_STATE = "canwxlab.wms.layerState";
const WMS_TELEMETRY = "canwxlab.wms.telemetry";
const WMS_PLAYBACK_REQUEST_TILE_SIZE = 384;
const WMS_SETTLED_REQUEST_TILE_SIZE = 512;
const WMS_PENDING_OPACITY = 0.001;
const WMS_PROMOTE_TIMEOUT_MS = 2500;
const WMS_RASTER_PAINT = {
  "raster-opacity": 1,
  "raster-resampling": "linear",
  "raster-fade-duration": 0,
} as const;

interface WmsTileSetState {
  url: string;
  sourceId: string;
  layerId: string;
  requestedAt: number;
  failed?: boolean;
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

function scheduleWmsCleanup(map: maplibregl.Map, layerId: string, sourceId: string) {
  const cleanup = () => removeWmsLayerAndSource(map, layerId, sourceId);
  const timeout = window.setTimeout(cleanup, 4000);
  map.once("idle", () => {
    window.clearTimeout(timeout);
    cleanup();
  });
}

function setRasterLayerOpacity(map: maplibregl.Map, layerId: string, opacity: number) {
  if (!map.getLayer(layerId)) return;
  map.setPaintProperty(layerId, "raster-opacity", opacity);
  map.setPaintProperty(layerId, "raster-resampling", "linear");
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

function promotePendingWms(map: maplibregl.Map, layerBaseId: string, opacity: number) {
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
  setRasterLayerOpacity(map, pending.layerId, opacity);
  wmsTelemetry(map).promotedRasterFrames += 1;

  const previous = state.current;
  state.current = pending;
  state.pending = undefined;
  if (previous && previous.sourceId !== pending.sourceId) {
    previous.detach?.();
    setRasterLayerOpacity(map, previous.layerId, 0);
    scheduleWmsCleanup(map, previous.layerId, previous.sourceId);
  }
}

function watchPendingWms(map: maplibregl.Map, layerBaseId: string, tileSet: WmsTileSetState, opacity: number) {
  if (tileSet.detach) return;
  let timeout = 0;
  let detached = false;

  const detach = () => {
    if (detached) return;
    detached = true;
    if (timeout) window.clearTimeout(timeout);
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
    if (loaded || performance.now() - tileSet.requestedAt > WMS_PROMOTE_TIMEOUT_MS) {
      detach();
      promotePendingWms(map, layerBaseId, opacity);
    }
  };

  const onSourceData = (event: maplibregl.MapSourceDataEvent) => {
    if (event.sourceId === tileSet.sourceId) check();
  };

  map.on("sourcedata", onSourceData);
  map.on("idle", check);
  timeout = window.setTimeout(check, WMS_PROMOTE_TIMEOUT_MS);
  tileSet.detach = detach;
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
      for (const tileSet of [entry.current, entry.pending]) {
        if (tileSet?.sourceId === sid) {
          tileSet.failed = true;
          matched = true;
        }
      }
      if (entry.pending?.sourceId === sid) {
        entry.pending.detach?.();
        cleanupTileSet(map, entry.pending);
        entry.pending = undefined;
      }
      if (matched) {
        logManager.warn("wms", `WMS tile error on ${layerId}: ${telemetry.lastSourceError}`, {
          layerId,
          sourceId: sid,
        });
      }
    }
  });
}

export function syncWmsLayers(options: {
  map: maplibregl.Map;
  renderPlan: RenderLayerPlan[];
  isPlaying?: boolean;
}) {
  ensureWmsErrorHook(options.map);
  const wmsLayers = options.renderPlan.filter((plan) => plan.visible && plan.rendererType === "wms-raster");
  const expectedLayerBaseIds = new Set(wmsLayers.map((plan) => plan.id));
  const state = wmsState(options.map);
  const telemetry = wmsTelemetry(options.map);
  telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;

  const style = options.map.getStyle();
  style.layers
    ?.filter((entry) => entry.id.startsWith("wms-layer-") && !isManagedWmsId(entry.id, "layer", expectedLayerBaseIds))
    .forEach((entry) => options.map.removeLayer(entry.id));
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

    const source = buildMapLibreWmsSource(definition, {
      time: plan.resolvedTime ?? undefined,
      requestTileSize: options.isPlaying && !isSatelliteLike(plan) ? WMS_PLAYBACK_REQUEST_TILE_SIZE : WMS_SETTLED_REQUEST_TILE_SIZE,
      sourceTileSize: 256,
    });
    const url = source.tiles[0];
    const currentTile = current?.current;
    const pendingTile = current?.pending;

    if (currentTile?.url === url) {
      if (options.map.getSource(currentTile.sourceId) && options.map.getLayer(currentTile.layerId)) {
        setRasterLayerOpacity(options.map, currentTile.layerId, plan.opacity);
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
        watchPendingWms(options.map, plan.id, pendingTile, plan.opacity);
        return;
      }
      cleanupTileSet(options.map, pendingTile);
      current.pending = undefined;
    }

    if (
      options.isPlaying &&
      current?.current &&
      !current.pending &&
      performance.now() - current.current.requestedAt < 900
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
    };
    if (!state[plan.id]) state[plan.id] = {};
    if (state[plan.id].current) {
      state[plan.id].pending = nextTileSet;
      telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;
      watchPendingWms(options.map, plan.id, nextTileSet, plan.opacity);
    } else {
      state[plan.id].current = nextTileSet;
      setRasterLayerOpacity(options.map, mapLayerId, plan.opacity);
    }
  });

  reorderWmsLayers(
    options.map,
    wmsLayers.map((plan) => plan.id),
  );
  telemetry.pendingRasterFrames = Object.values(state).filter((entry) => entry.pending).length;
}
