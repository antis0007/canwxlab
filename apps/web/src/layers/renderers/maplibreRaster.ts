import maplibregl from "maplibre-gl";

import { buildMapLibreWmsSource, canRenderWmsLayer, toWmsLayerDefinition } from "../../lib/wms";
import type { LayerDefinition, LayerRuntimeState } from "../types";

export function syncWmsLayers(options: {
  map: maplibregl.Map;
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
}) {
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

    const source = buildMapLibreWmsSource(definition);
    if (!options.map.getSource(sourceId)) {
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
