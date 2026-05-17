import { buildWmsGetMapTemplate, canRenderWmsLayer, toWmsLayerDefinition } from "../lib/wms";
import { parseWmsTimeDimension, resolveWmsTimeForTimeline } from "../time/wmsTime";
import type {
  LayerDefinition,
  LayerRuntimeState,
  RenderBlendMode,
  RendererKind,
  RenderLayerPlan,
  RenderLayerType,
  RenderTimePolicy,
  ViewMode,
  WmsTimePolicy,
} from "./types";

export function rendererKindForViewMode(viewMode: ViewMode): RendererKind {
  return viewMode === "globe" ? "maplibre-globe" : "maplibre-2d";
}

export function normalizeWmsTimePolicy(policy: WmsTimePolicy | undefined): RenderTimePolicy {
  if (policy === "fixed") return "fixed";
  if (policy === "timeline") return "timeline";
  // Historical `global` meant timeline-following, but WMS defaults now resolve
  // to latest unless the operator explicitly opts into timeline/fixed.
  return "latest";
}

function rendererTypeForLayer(layer: LayerDefinition): RenderLayerType {
  if (layer.rendererType === "wms-raster") return "wms-raster";
  if (layer.rendererType === "deck-scatter" || layer.rendererType === "deck-polygon" || layer.rendererType === "deck-line") {
    return "deck-vector";
  }
  if (layer.rendererType === "maplibre-raster") return "native-raster";
  if (layer.rendererType === "custom-canvas") return "shader-raster";
  return "deck-grid";
}

function normalizeBlendMode(value: unknown): RenderBlendMode {
  if (value === "screen" || value === "multiply" || value === "max" || value === "alpha") return value;
  if (value === "add" || value === "additive") return "add";
  return "normal";
}

function priorityForLayer(layer: LayerDefinition): number {
  if (layer.category === "alert") return 1000;
  if (layer.category === "observation") return 900;
  if (layer.category === "radar") return 800;
  if (layer.category === "satellite") return 700;
  if (layer.category === "forecast") return 600;
  return 500;
}

function resolveWmsTime(layer: LayerDefinition, runtime: LayerRuntimeState | undefined, globalTimeMs: number): {
  policy: RenderTimePolicy;
  resolvedTime: string | null;
} {
  const policy = normalizeWmsTimePolicy(runtime?.wmsTimePolicy);
  const extent = typeof layer.metadata?.time_extent === "string" ? layer.metadata.time_extent : null;
  if (!extent) return { policy, resolvedTime: null };
  const times = parseWmsTimeDimension(extent);
  const resolvedTime = resolveWmsTimeForTimeline(
    globalTimeMs,
    times,
    policy,
    runtime?.wmsFixedTime,
  );
  return { policy, resolvedTime };
}

export function buildRenderPlan(input: {
  layers: LayerDefinition[];
  runtimeState: Record<string, LayerRuntimeState>;
  globalTimeMs: number;
  viewMode: ViewMode;
}): RenderLayerPlan[] {
  const rendererKind = rendererKindForViewMode(input.viewMode);

  return input.layers
    .map((layer, index): RenderLayerPlan | null => {
      const runtime = input.runtimeState[layer.id];
      const visible = Boolean(runtime?.enabled);
      const rendererType = rendererTypeForLayer(layer);
      const { policy, resolvedTime } = layer.rendererType === "wms-raster"
        ? resolveWmsTime(layer, runtime, input.globalTimeMs)
        : { policy: "timeline" as const, resolvedTime: null };

      let urlTemplate: string | undefined;
      if (layer.rendererType === "wms-raster") {
        const definition = toWmsLayerDefinition({
          layer_id: layer.id,
          title: layer.title,
          status: layer.status,
          wms_base_url: layer.wmsBaseUrl,
          wms_layer_name: layer.wmsLayerName,
          styles: layer.styles ?? [],
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
          metadata: layer.metadata ?? {},
        } as any);
        if (!definition || !canRenderWmsLayer(definition)) return null;
        urlTemplate = buildWmsGetMapTemplate(definition, { time: resolvedTime ?? undefined });
      }

      return {
        id: layer.id,
        rendererType,
        order: index,
        opacity: runtime?.opacity ?? layer.defaultOpacity,
        visible,
        timePolicy: policy,
        resolvedTime,
        source: {
          kind: layer.rendererType === "wms-raster" ? "wms" : layer.rendererType.startsWith("deck") ? "deck" : "native",
          layerId: layer.id,
          sourceId: layer.sourceId,
          status: layer.status,
          title: layer.title,
          urlTemplate,
          wmsBaseUrl: layer.wmsBaseUrl,
          wmsLayerName: layer.wmsLayerName,
          styles: layer.styles ?? [],
          timeExtent: typeof layer.metadata?.time_extent === "string" ? layer.metadata.time_extent : null,
          variable: layer.variable,
          unit: layer.unit,
          metadata: {
            ...layer.metadata,
            rendererKind,
          },
        },
        blendMode: normalizeBlendMode(runtime?.controls.blendMode),
        priority: priorityForLayer(layer),
      };
    })
    .filter((plan): plan is RenderLayerPlan => Boolean(plan))
    .sort((a, b) => a.order - b.order);
}
