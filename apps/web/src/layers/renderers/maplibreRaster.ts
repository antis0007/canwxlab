import maplibregl from "maplibre-gl";

import { buildMapLibreWmsSource, canRenderWmsLayer, toWmsLayerDefinition } from "../../lib/wms";
import type { LayerDefinition, LayerRuntimeState } from "../types";
import { parseWmsTimeDimension, resolveWmsTimeForTimeline } from "../../time/wmsTime";
import { logManager } from "../../lib/logging";

const WMS_ERROR_HOOK = "canwxlab.wms.errorHook";

function ensureWmsErrorHook(map: maplibregl.Map) {
  const flagged = (map as unknown as Record<string, boolean>)[WMS_ERROR_HOOK];
  if (flagged) return;
  (map as unknown as Record<string, boolean>)[WMS_ERROR_HOOK] = true;
  map.on("error", (event) => {
    const e = event as unknown as { error?: Error; sourceId?: string; source?: { id?: string } };
    const sid = e.sourceId ?? e.source?.id ?? "";
    if (!sid.startsWith("wms-source-")) return;
    const layerId = sid.replace("wms-source-", "");
    logManager.warn("wms", `WMS tile error on ${layerId}: ${e.error?.message ?? "unknown"}`, {
      layerId,
      sourceId: sid,
    });
  });
}

export function syncWmsLayers(options: {
  map: maplibregl.Map;
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  globalTimeMs: number;
}) {
  ensureWmsErrorHook(options.map);
  const wmsLayers = options.layers.filter((layer) => layer.rendererType === "wms-raster");
  const expectedSourceIds = new Set(wmsLayers.map((layer) => `wms-source-${layer.id}`));
  const expectedLayerIds = new Set(wmsLayers.map((layer) => `wms-layer-${layer.id}`));

  const style = options.map.getStyle();
  style.layers
    ?.filter((entry) => entry.id.startsWith("wms-layer-") && !expectedLayerIds.has(entry.id))
    .forEach((entry) => options.map.removeLayer(entry.id));
  Object.keys(style.sources)
    .filter((sourceId) => sourceId.startsWith("wms-source-") && !expectedSourceIds.has(sourceId))
    .forEach((sourceId) => {
      if (options.map.getSource(sourceId)) {
        options.map.removeSource(sourceId);
      }
    });

  wmsLayers.forEach((layer) => {
    const definition = toWmsLayerDefinition({
      layer_id: layer.id,
      title: layer.title,
      status: layer.status,
      wms_base_url: layer.wmsBaseUrl,
      wms_layer_name: layer.wmsLayerName,
      styles: layer.styles ?? ["default"],
      time_dimension_supported: layer.animation.frameCount > 1,
      min_zoom: undefined,
      max_zoom: undefined,
      name: layer.title,
      kind: "raster",
      variable: layer.variable ?? "",
      unit: layer.unit ?? "",
      source_id: layer.sourceId,
      adapter: "layer-engine",
      service_type: "wms",
      last_updated: null,
      last_successful_fetch: null,
      last_attempted_fetch: null,
      retrieved_at: null,
      expires_at: null,
      attribution: "",
      message: layer.message ?? "",
      error_type: null,
      default_opacity: layer.defaultOpacity,
      color_ramps: [],
      is_live: layer.status === "live",
      is_experimental: layer.isExperimental,
      metadata: {},
    } as any);
    if (!definition) return;

    const sourceId = `wms-source-${layer.id}`;
    const mapLayerId = `wms-layer-${layer.id}`;
    const runtime = options.runtimeState[layer.id];
    const shouldRender = runtime?.enabled && canRenderWmsLayer(definition);

    if (!shouldRender) {
      if (options.map.getLayer(mapLayerId)) options.map.removeLayer(mapLayerId);
      if (options.map.getSource(sourceId)) options.map.removeSource(sourceId);
      return;
    }

    let timeParam: string | undefined;
    if (layer.metadata?.time_extent) {
      const times = parseWmsTimeDimension(layer.metadata.time_extent as string);
      const policy = runtime?.wmsTimePolicy ?? 'global';
      const fixedTime = runtime?.wmsFixedTime;
      const resolved = resolveWmsTimeForTimeline(options.globalTimeMs, times, policy, fixedTime);
      if (resolved) timeParam = resolved;
    }

    const source = buildMapLibreWmsSource(definition, { time: timeParam });
    const existingSource = options.map.getSource(sourceId) as any;
    
    if (existingSource && existingSource.tiles && existingSource.tiles[0] !== source.tiles[0]) {
      // Update tiles directly to avoid WebGL memory leak from constant layer destruction
      existingSource.tiles = source.tiles;
      const sourceCache = (options.map.style as any).sourceCaches[sourceId];
      if (sourceCache) {
        sourceCache.clearTiles();
        sourceCache.update(options.map.transform);
      }
    } else if (!existingSource) {
      options.map.addSource(sourceId, source as any);
    }

    if (!options.map.getLayer(mapLayerId)) {
      options.map.addLayer({
        id: mapLayerId,
        type: "raster",
        source: sourceId,
        paint: { "raster-opacity": runtime.opacity },
      });
    } else {
      options.map.setPaintProperty(mapLayerId, "raster-opacity", runtime.opacity);
    }
  });
}
