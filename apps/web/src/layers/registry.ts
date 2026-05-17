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

function categoryFromLayer(layer: WeatherLayer): LayerCategory {
  const product = layer.metadata?.intended_product_type;
  if (product === "radar") return "radar";
  if (product === "satellite") return "satellite";
  if (product === "alert") return "alert";
  if (product === "observation") return "observation";

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
  if (rendererType === "deck-grid" || rendererType === "deck-particles") {
    return {
      supportsMap: true,
      supportsGlobe: false,
      supportsAnimation: true,
      supportsPicking: true,
      supportsShader: true,
      supportsWms: false,
      supportsCustomColorRamp: false,
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
  if (layer.service_type === "wms") return "wms-raster";
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

function categoryDefaultVisibility(layer: WeatherLayer, dataMode: DataMode): boolean {
  if (dataMode === "mock") {
    return [
      "mock_temperature",
      "mock_alerts",
      "mock_stations",
      "demo_radar_animation",
      "demo_wind_particles",
      "eccc_radar_1km_rrai",
      "eccc_goes_east_cloud_type",
    ].includes(layer.layer_id);
  }
  // Live / hybrid: turn on a useful default stack so the map is not blank.
  return [
    "eccc_radar_1km_rrai",
    "eccc_gdps_p_msl",
    "eccc_goes_east_cloud_type",
    "eccc_weather_alerts",
    "eccc_climate_stations",
  ].includes(layer.layer_id);
}

export type DataMode = "mock" | "live" | "hybrid";

function backendLayerToDefinition(layer: WeatherLayer, zIndex: number, dataMode: DataMode): LayerDefinition {
  const category = categoryFromLayer(layer);
  const rendererType = rendererFromLayer(layer);
  const colourRamp = rampForLayer(category, layer);
  const isMockStatus = layer.status === "mock" || layer.status === "fallback";
  const titleBase = layer.title ?? layer.name;
  const displayTitle = isMockStatus && !/^\[MOCK\]|^\[DEMO\]/i.test(titleBase) ? `[MOCK] ${titleBase}` : titleBase;
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
    isBuiltIn: true,
    isPlugin: false,
    isExperimental: layer.is_experimental,
    defaultVisible: categoryDefaultVisibility(layer, dataMode),
    defaultOpacity: layer.default_opacity,
    zIndex,
    colourRamp,
    legend,
    rendererType,
    capabilities: capabilitiesForRenderer(rendererType),
    animation: {
      frameCount: 240,
      frameIntervalSeconds: 300,
      loop: true,
      currentFrame: 0,
    },
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
    metadata: layer.metadata,
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
    status: plugin.status === "installed" ? "mock" : "unavailable",
    isBuiltIn: plugin.is_builtin,
    isPlugin: true,
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
    animation: {
      frameCount: 1,
      frameIntervalSeconds: 0,
      loop: false,
      currentFrame: 0,
    },
    controls: defaultLayerControls,
    pluginId: plugin.id,
    message:
      plugin.status === "installed"
        ? "Plugin manifest discovered. Runtime execution is not enabled in this phase."
        : `Plugin status: ${plugin.status}`,
    metadata: {},
  };
}

function demoLayers(baseIndex: number, dataMode: DataMode): LayerDefinition[] {
  const visibleByDefault = dataMode === "mock";
  const layers: LayerDefinition[] = [
    {
      id: "demo_temperature_field",
      title: "[MOCK] Demo Temperature Field",
      description: "Animated mock temperature field for local visual iteration.",
      category: "forecast",
      sourceId: "mock_canwxlab",
      status: "mock",
      isBuiltIn: true,
      isPlugin: false,
      isExperimental: false,
      defaultVisible: visibleByDefault,
      defaultOpacity: 0.66,
      zIndex: baseIndex,
      colourRamp: "temperature-blue-red",
      legend: legendFromRamp("Temperature", "degC", "temperature-blue-red"),
      rendererType: "deck-grid",
      capabilities: capabilitiesForRenderer("deck-grid"),
      animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
      controls: { ...defaultLayerControls, min: -35, max: 35, smoothing: 0.6 },
      variable: "temperature_2m",
      unit: "degC",
      message: "MOCK/DEMO",
      metadata: {},
    },
    {
      id: "demo_radar_animation",
      title: "[MOCK] Demo Radar Precipitation",
      description: "Animated mock precipitation blobs resembling radar echoes.",
      category: "radar",
      sourceId: "mock_canwxlab",
      status: "mock",
      isBuiltIn: true,
      isPlugin: false,
      isExperimental: false,
      defaultVisible: visibleByDefault,
      defaultOpacity: 0.62,
      zIndex: baseIndex + 1,
      colourRamp: "radar",
      legend: legendFromRamp("Radar", "mm/h", "radar"),
      rendererType: "deck-grid",
      capabilities: capabilitiesForRenderer("deck-grid"),
      animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
      controls: {
        ...defaultLayerControls,
        min: 0,
        max: 14,
        precipitationIntensity: 1.15,
      },
      variable: "precipitation_rate",
      unit: "mm/h",
      message: "MOCK/DEMO",
      metadata: {},
    },
    {
      id: "demo_pressure_msl",
      title: "[MOCK] Demo Mean Sea Level Pressure",
      description: "Animated mock MSLP analysis field for pressure-pattern inspection.",
      category: "forecast",
      sourceId: "mock_canwxlab",
      status: "mock",
      isBuiltIn: true,
      isPlugin: false,
      isExperimental: false,
      defaultVisible: visibleByDefault,
      defaultOpacity: 0.42,
      zIndex: baseIndex + 2,
      colourRamp: "pressure",
      legend: legendFromRamp("MSLP", "hPa", "pressure"),
      rendererType: "deck-grid",
      capabilities: capabilitiesForRenderer("deck-grid"),
      animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
      controls: { ...defaultLayerControls, min: 980, max: 1045, smoothing: 0.7, contourInterval: 4 },
      variable: "pressure_msl",
      unit: "hPa",
      message: "MOCK/DEMO",
      metadata: {},
    },
    {
      id: "demo_wind_particles",
      title: "[MOCK] Demo Wind Particles",
      description: "Animated wind particle paths from deterministic mock vector field.",
      category: "forecast",
      sourceId: "mock_canwxlab",
      status: "mock",
      isBuiltIn: true,
      isPlugin: false,
      isExperimental: false,
      defaultVisible: visibleByDefault,
      defaultOpacity: 0.84,
      zIndex: baseIndex + 3,
      colourRamp: "wind",
      legend: legendFromRamp("Wind", "m/s", "wind"),
      rendererType: "deck-particles",
      capabilities: capabilitiesForRenderer("deck-particles"),
      animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
      controls: { ...defaultLayerControls, particleCount: 2200, windScale: 1.1 },
      variable: "wind_10m",
      unit: "m/s",
      message: "MOCK/DEMO",
      metadata: {},
    },
    {
      id: "demo_clouds",
      title: "[MOCK] Demo Cloud Overlay",
      description: "Animated semi-transparent cloud texture using deterministic noise.",
      category: "satellite",
      sourceId: "mock_canwxlab",
      status: "mock",
      isBuiltIn: true,
      isPlugin: false,
      isExperimental: false,
      defaultVisible: visibleByDefault,
      defaultOpacity: 0.46,
      zIndex: baseIndex + 4,
      colourRamp: "cloud-gray",
      legend: legendFromRamp("Cloud Opacity", "0-1", "cloud-gray"),
      rendererType: "deck-grid",
      capabilities: capabilitiesForRenderer("deck-grid"),
      animation: { frameCount: 240, frameIntervalSeconds: 300, loop: true, currentFrame: 0 },
      controls: { ...defaultLayerControls, min: 0, max: 1, cloudOpacity: 0.7 },
      variable: "cloud_opacity",
      unit: "ratio",
      message: "MOCK/DEMO",
      metadata: {},
    },
  ];
  return layers;
}

export function buildLayerDefinitions(input: {
  backendLayers: WeatherLayer[];
  plugins: PluginCatalogItem[];
  pluginEnabled: Record<string, boolean>;
  dataMode?: DataMode;
}): LayerDefinition[] {
  const dataMode: DataMode = input.dataMode ?? "mock";
  const backendInput = dataMode === "mock"
    ? input.backendLayers
    : input.backendLayers.filter((layer) => layer.status !== "mock" && !layer.layer_id.startsWith("mock_"));
  const backend = backendInput.map((layer, index) => backendLayerToDefinition(layer, index + 100, dataMode));
  const demos = dataMode === "mock" ? demoLayers(10, dataMode) : [];

  const pluginLayers = input.plugins
    .filter((plugin) => input.pluginEnabled[plugin.id] ?? plugin.enabled_default)
    .map((plugin, index) => pluginToLayer(plugin, index + 300));

  const mergedById = new Map<string, LayerDefinition>();
  [...demos, ...backend, ...pluginLayers].forEach((layer) => {
    mergedById.set(layer.id, layer);
  });

  return [...mergedById.values()].sort((a, b) => a.zIndex - b.zIndex);
}
