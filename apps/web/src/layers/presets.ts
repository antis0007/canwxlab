export interface LayerPreset {
  id: string;
  name: string;
  description: string;
  layers: string[];
}

export const builtInPresets: LayerPreset[] = [
  {
    id: "radar_ops",
    name: "Radar Ops",
    description: "Focus on precipitation radar and active alerts.",
    layers: ["mock_radar", "demo_radar_animation", "mock_alerts", "mock_stations"],
  },
  {
    id: "satellite_ops",
    name: "Satellite Ops",
    description: "Satellite cloud cover and temperature analysis.",
    layers: ["demo_clouds", "demo_temperature_field", "mock_temperature"],
  },
  {
    id: "forecast_verification",
    name: "Forecast Verification",
    description: "Forecast vs observations for skill assessment.",
    layers: ["mock_temperature", "mock_stations", "demo_temperature_field"],
  },
  {
    id: "simulation_debug",
    name: "Simulation Debug",
    description: "Simulation output and diagnostics.",
    layers: ["demo_wind_particles", "demo_radar_animation", "demo_temperature_field"],
  },
  {
    id: "minimal_live",
    name: "Minimal Live Map",
    description: "Clean base layer with current alerts and observations.",
    layers: ["mock_alerts", "mock_stations"],
  },
  {
    id: "all_diagnostics",
    name: "All Diagnostics",
    description: "Enable all available layers for full diagnostic view.",
    layers: [
      "mock_radar",
      "demo_radar_animation",
      "mock_alerts",
      "mock_stations",
      "demo_clouds",
      "demo_temperature_field",
      "mock_temperature",
      "demo_wind_particles",
    ],
  },
];
