import type { PluginCatalogItem, WeatherLayer } from "../types/weather";

import { defaultRampByCategory } from "./colorRamps";
import { alertLegend, legendFromRamp } from "./legends";
import {
  defaultLayerControls,
  type LayerCategory,
  type LayerDefinition,
  type LayerRendererCapabilities,
  type LayerRendererType,
} from "./types";

const VALID_CATEGORY_HINTS = new Set<LayerCategory>(["base", "radar", "satellite", "alert", "observation", "forecast", "simulation", "infrastructure", "diagnostic", "plugin", "experimental"]);

function categoryFromLayer(layer: WeatherLayer): LayerCategory {
  const product = layer.metadata?.intended_product_type;
  if (product === "radar") return "radar";
  if (product === "satellite") return "satellite";
  if (product === "alert") return "alert";
  if (product === "observation") return "observation";

  const hint = layer.metadata?.category_hint;
  if (typeof hint === "string" && VALID_CATEGORY_HINTS.has(hint as LayerCategory)) {
    return hint as LayerCategory;
  }

  if (layer.variable.includes("alert")) return "alert";
  if (layer.variable.includes("station") || layer.variable.includes("observation")) return "observation";
  if (layer.variable.includes("radar") || layer.layer_id.includes("radar")) return "radar";
  if (layer.variable.includes("goes") || layer.variable.includes("satellite")) return "satellite";
  if (layer.kind === "simulation") return "simulation";
  if (layer.is_experimental) return "experimental";
  return "forecast";
}

function capabilitiesForRenderer(rendererType: LayerRendererType): LayerRendererCapabilities {
  if (rendererType === "wms-raster") {
    return {
      supportsMap: true,
      supportsGlobe: true,
      supportsAnimation: true,
      supportsPicking: false,
      supportsShader: false,
      supportsWms: true,
      supportsCustomColorRamp: false,
      supportsOpacity: true,
    };
  }
  if (rendererType === "deck-grid" || rendererType === "deck-particles" || rendererType === "deck-power-grid") {
    return {
      supportsMap: true,
      supportsGlobe: false,
      supportsAnimation: true,
      supportsPicking: rendererType !== "deck-power-grid",
      supportsShader: true,
      supportsWms: false,
      supportsCustomColorRamp: rendererType === "deck-power-grid",
      supportsOpacity: true,
    };
  }

  return {
    supportsMap: true,
    supportsGlobe: true,
    supportsAnimation: true,
    supportsPicking: true,
    supportsShader: rendererType.startsWith("deck"),
    supportsWms: false,
    supportsCustomColorRamp: true,
    supportsOpacity: true,
  };
}

function rendererFromLayer(layer: WeatherLayer): LayerRendererType {
  if (layer.service_type === "wms" || layer.service_type === "wmts") return "wms-raster";
  if (layer.variable.includes("alert")) return "deck-polygon";
  if (layer.variable.includes("station") || layer.variable.includes("observation")) return "deck-scatter";
  return "deck-grid";
}

function rampForLayer(category: LayerCategory, layer: WeatherLayer): string {
  if (layer.color_ramps.length > 0) {
    return layer.color_ramps[0];
  }
  return defaultRampByCategory[category] ?? "viridis-like";
}

function categoryDefaultVisibility(layer: WeatherLayer): boolean {
  return [
    "eccc_radar_1km_rrai",
    "eccc_gdps_p_msl",
    "eccc_goes_east_cloud_type",
    "eccc_weather_alerts",
    "eccc_climate_stations",
  ].includes(layer.layer_id);
}

export type DataMode = "mock" | "live" | "hybrid";

function backendLayerToDefinition(layer: WeatherLayer, zIndex: number): LayerDefinition {
  const category = categoryFromLayer(layer);
  const rendererType = rendererFromLayer(layer);
  const colourRamp = rampForLayer(category, layer);
  const displayTitle = layer.title ?? layer.name;
  const legend = layer.variable.includes("alert")
    ? alertLegend()
    : legendFromRamp(displayTitle, layer.unit, colourRamp);

  return {
    id: layer.layer_id,
    title: displayTitle,
    description: layer.description,
    category,
    sourceId: layer.source_id,
    status: layer.status,
    isExperimental: layer.is_experimental,
    defaultVisible: categoryDefaultVisibility(layer),
    defaultOpacity: layer.default_opacity,
    zIndex,
    colourRamp,
    legend,
    rendererType,
    capabilities: capabilitiesForRenderer(rendererType),
    animation: { frameCount: 240 },
    controls: {
      ...defaultLayerControls,
      precipitationIntensity: category === "radar" ? 1 : defaultLayerControls.precipitationIntensity,
      cloudOpacity: category === "satellite" ? 0.8 : defaultLayerControls.cloudOpacity,
      particleCount: category === "observation" ? 1200 : defaultLayerControls.particleCount,
    },
    serviceType: layer.service_type,
    variable: layer.variable,
    unit: layer.unit,
    message: layer.message,
    wmsBaseUrl: layer.wms_base_url,
    wmsLayerName: layer.wms_layer_name,
    styles: layer.styles,
    metadata: {
      ...layer.metadata,
      legend_url: layer.legend_url,
    },
  };
}

function pluginToLayer(plugin: PluginCatalogItem, zIndex: number): LayerDefinition {
  const colourRamp = "viridis-like";
  return {
    id: `plugin:${plugin.id}`,
    title: plugin.name,
    description: plugin.description,
    category: plugin.plugin_type === "diagnostic" ? "diagnostic" : "plugin",
    sourceId: plugin.id,
    status: plugin.status === "installed" ? "derived" : "unavailable",
    isExperimental: plugin.safety_level !== "core",
    defaultVisible: false,
    defaultOpacity: 0.8,
    zIndex,
    colourRamp,
    legend: legendFromRamp(plugin.name, undefined, colourRamp),
    rendererType: "custom-canvas",
    capabilities: {
      supportsMap: true,
      supportsGlobe: false,
      supportsAnimation: false,
      supportsPicking: false,
      supportsShader: false,
      supportsWms: false,
      supportsCustomColorRamp: true,
      supportsOpacity: true,
    },
    animation: { frameCount: 1 },
    controls: defaultLayerControls,
    pluginId: plugin.id,
    message:
      plugin.status === "installed"
        ? "Plugin manifest discovered. Runtime execution is not enabled in this phase."
        : `Plugin status: ${plugin.status}`,
    metadata: {},
  };
}

function powerGridLayerDefinition(zIndex: number): LayerDefinition {
  const colourRamp = "electric-cyan";
  return {
    id: "energy.power_grid_flow",
    title: "Power Grid Flow + Outage Zones",
    description:
      "Generated electrical-grid visual aid with transmission corridors, flowing arc shader, particles, and warning/dead outage zones. Outage geometry is placeholder until live utility outage adapters are connected.",
    category: "infrastructure",
    sourceId: "generated_power_grid_vfx",
    status: "derived",
    isExperimental: true,
    defaultVisible: false,
    defaultOpacity: 0.86,
    zIndex,
    colourRamp,
    legend: {
      title: "Power grid flow",
      unit: "status",
      gradient: "linear-gradient(90deg, #082f49 0%, #0891b2 34%, #67e8f9 68%, #ecfeff 100%)",
      stops: [
        { value: 0, color: "#67e8f9", label: "energized" },
        { value: 1, color: "#facc15", label: "warning" },
        { value: 2, color: "#ef4444", label: "dead zone" },
      ],
    },
    rendererType: "deck-power-grid",
    capabilities: capabilitiesForRenderer("deck-power-grid"),
    animation: { frameCount: 240 },
    controls: {
      ...defaultLayerControls,
      particleCount: 2800,
      windScale: 1.1,
      smoothing: 0.34,
      precipitationIntensity: 1.25,
      cloudOpacity: 0.78,
      contourInterval: 3,
      blendMode: "add",
    },
    serviceType: "generated",
    variable: "power_grid_flow",
    unit: "status",
    message: "Generated visualization scaffold; not a live outage feed.",
    metadata: {
      category_hint: "infrastructure",
      intended_product_type: "power_grid",
      source_kind: "generated_visual_context",
      privacy_class: "derived_estimate",
      live_outage_feed_connected: false,
    },
  };
}

export function buildLayerDefinitions(input: {
  backendLayers: WeatherLayer[];
  plugins: PluginCatalogItem[];
  pluginEnabled: Record<string, boolean>;
  dataMode?: DataMode;
}): LayerDefinition[] {
  const liveLayers = input.backendLayers.filter(
    (layer) => layer.status !== "mock" && !layer.layer_id.startsWith("mock_"),
  );
  const backend = liveLayers.map((layer, index) => backendLayerToDefinition(layer, index + 100));

  const pluginLayers = input.plugins
    .filter((plugin) => input.pluginEnabled[plugin.id] ?? plugin.enabled_default)
    .map((plugin, index) => pluginToLayer(plugin, index + 300));

  const generatedLayers = [powerGridLayerDefinition(260)];

  const mergedById = new Map<string, LayerDefinition>();
  [...backend, ...generatedLayers, ...pluginLayers].forEach((layer) => {
    mergedById.set(layer.id, layer);
  });

  return [...mergedById.values()].sort((a, b) => a.zIndex - b.zIndex);
}
