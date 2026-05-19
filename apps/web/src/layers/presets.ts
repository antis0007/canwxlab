import type { LayerCategory } from "./types";

export interface LayerPreset {
  id: string;
  name: string;
  description: string;
  /** Layer categories to ENABLE (all others are disabled). */
  categories: LayerCategory[];
  /** Per-category opacity overrides. When set, layers in this category get this
   *  opacity instead of their layer default. 1.0 = fully opaque. */
  categoryOpacity?: Partial<Record<LayerCategory, number>>;
  /** Cap the number of layers enabled per category (first N by zIndex, highest first).
   *  Prevents saturating the view with dozens of nearly identical satellite products. */
  maxPerCategory?: number;
}

/**
 * Category-based presets. They match layers by semantic role rather than
 * hardcoded IDs, so they survive backend layer-name changes. When a category
 * has no layers in the current backend response, the preset just enables
 * zero layers for that slot — it never references a missing ID.
 */
export const builtInPresets: LayerPreset[] = [
  {
    id: "radar_ops",
    name: "Radar Ops",
    description: "Radar, pressure, alerts, observations — high opacity.",
    categories: ["radar", "forecast", "alert", "observation"],
    categoryOpacity: { radar: 0.85, forecast: 0.7, alert: 1.0, observation: 0.8 },
  },
  {
    id: "satellite_ops",
    name: "Satellite Ops",
    description: "Top 2 satellite layers only — prevents overwhelming the view with redundant products.",
    categories: ["satellite"],
    categoryOpacity: { satellite: 1.0 },
    maxPerCategory: 2,
  },
  {
    id: "forecast_verification",
    name: "Forecast Verification",
    description: "Forecast fields vs station observations at moderate opacity.",
    categories: ["forecast", "observation", "diagnostic"],
    categoryOpacity: { forecast: 0.75, observation: 0.85, diagnostic: 0.6 },
  },
  {
    id: "simulation_debug",
    name: "Simulation Debug",
    description: "Model output and particle diagnostics.",
    categories: ["simulation", "diagnostic"],
    categoryOpacity: { simulation: 0.9, diagnostic: 0.7 },
  },
  {
    id: "minimal_live",
    name: "Minimal Live",
    description: "Only alerts and observations — clean base view.",
    categories: ["alert", "observation"],
    categoryOpacity: { alert: 1.0, observation: 0.84 },
  },
  {
    id: "all_live",
    name: "All Live",
    description: "Every live layer currently available from the backend.",
    categories: ["radar", "satellite", "forecast", "alert", "observation", "diagnostic"],
    categoryOpacity: { radar: 0.8, satellite: 0.9, forecast: 0.72, alert: 0.9, observation: 0.78, diagnostic: 0.56 },
  },
  {
    id: "none",
    name: "None",
    description: "Disable all layers — clean globe/map only.",
    categories: [],
  },
];
