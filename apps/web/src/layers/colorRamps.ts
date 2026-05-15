export interface ColorStop {
  value: number;
  color: string;
}

export interface ColorRamp {
  id: string;
  label: string;
  cssGradient: string;
  stops: ColorStop[];
  recommendedVariables: string[];
}

export const colorRamps: ColorRamp[] = [
  {
    id: "temperature-blue-red",
    label: "Temperature Blue-Red",
    cssGradient: "linear-gradient(90deg, #2c7bb6 0%, #abd9e9 30%, #fee08b 65%, #d7191c 100%)",
    stops: [
      { value: -35, color: "#2c7bb6" },
      { value: -10, color: "#abd9e9" },
      { value: 10, color: "#fee08b" },
      { value: 35, color: "#d7191c" },
    ],
    recommendedVariables: ["temperature_2m", "temperature"],
  },
  {
    id: "precipitation",
    label: "Precipitation",
    cssGradient: "linear-gradient(90deg, #1f7a8c 0%, #2ec4b6 30%, #8ac926 55%, #ffca3a 75%, #ff595e 100%)",
    stops: [
      { value: 0, color: "#1f7a8c" },
      { value: 2, color: "#2ec4b6" },
      { value: 8, color: "#8ac926" },
      { value: 15, color: "#ffca3a" },
      { value: 30, color: "#ff595e" },
    ],
    recommendedVariables: ["precipitation_rate", "radar_precipitation"],
  },
  {
    id: "radar",
    label: "Radar Reflectivity",
    cssGradient: "linear-gradient(90deg, #001219 0%, #005f73 20%, #0a9396 40%, #94d2bd 60%, #ee9b00 80%, #ae2012 100%)",
    stops: [
      { value: 0, color: "#001219" },
      { value: 10, color: "#005f73" },
      { value: 20, color: "#0a9396" },
      { value: 30, color: "#94d2bd" },
      { value: 40, color: "#ee9b00" },
      { value: 50, color: "#ae2012" },
    ],
    recommendedVariables: ["radar_precipitation", "reflectivity"],
  },
  {
    id: "cloud-gray",
    label: "Cloud Gray",
    cssGradient: "linear-gradient(90deg, #0b0f14 0%, #374151 45%, #9ca3af 75%, #e5e7eb 100%)",
    stops: [
      { value: 0, color: "#0b0f14" },
      { value: 0.25, color: "#374151" },
      { value: 0.65, color: "#9ca3af" },
      { value: 1, color: "#e5e7eb" },
    ],
    recommendedVariables: ["cloud", "cloud_opacity"],
  },
  {
    id: "viridis-like",
    label: "Viridis-like",
    cssGradient: "linear-gradient(90deg, #440154 0%, #3b528b 25%, #21918c 50%, #5ec962 75%, #fde725 100%)",
    stops: [
      { value: 0, color: "#440154" },
      { value: 0.25, color: "#3b528b" },
      { value: 0.5, color: "#21918c" },
      { value: 0.75, color: "#5ec962" },
      { value: 1, color: "#fde725" },
    ],
    recommendedVariables: ["temperature", "humidity", "precipitation_rate"],
  },
  {
    id: "plasma-like",
    label: "Plasma-like",
    cssGradient: "linear-gradient(90deg, #0d0887 0%, #7e03a8 30%, #cc4778 60%, #f89441 80%, #f0f921 100%)",
    stops: [
      { value: 0, color: "#0d0887" },
      { value: 0.3, color: "#7e03a8" },
      { value: 0.6, color: "#cc4778" },
      { value: 0.8, color: "#f89441" },
      { value: 1, color: "#f0f921" },
    ],
    recommendedVariables: ["temperature", "anomaly"],
  },
  {
    id: "wind",
    label: "Wind",
    cssGradient: "linear-gradient(90deg, #0f172a 0%, #1d4ed8 35%, #38bdf8 65%, #a7f3d0 100%)",
    stops: [
      { value: 0, color: "#0f172a" },
      { value: 5, color: "#1d4ed8" },
      { value: 12, color: "#38bdf8" },
      { value: 25, color: "#a7f3d0" },
    ],
    recommendedVariables: ["wind_10m", "wind_speed_10m"],
  },
  {
    id: "anomaly-blue-red",
    label: "Anomaly Blue-Red",
    cssGradient: "linear-gradient(90deg, #313695 0%, #74add1 40%, #f7f7f7 50%, #f46d43 70%, #a50026 100%)",
    stops: [
      { value: -3, color: "#313695" },
      { value: -1, color: "#74add1" },
      { value: 0, color: "#f7f7f7" },
      { value: 1, color: "#f46d43" },
      { value: 3, color: "#a50026" },
    ],
    recommendedVariables: ["anomaly", "bias"],
  },
  {
    id: "grayscale",
    label: "Grayscale",
    cssGradient: "linear-gradient(90deg, #111827 0%, #374151 35%, #9ca3af 70%, #f9fafb 100%)",
    stops: [
      { value: 0, color: "#111827" },
      { value: 0.35, color: "#374151" },
      { value: 0.7, color: "#9ca3af" },
      { value: 1, color: "#f9fafb" },
    ],
    recommendedVariables: ["cloud", "satellite", "grayscale"],
  },
];

export const defaultRampByCategory: Record<string, string> = {
  radar: "radar",
  satellite: "cloud-gray",
  observation: "viridis-like",
  forecast: "temperature-blue-red",
  simulation: "plasma-like",
  alert: "anomaly-blue-red",
};

export function resolveRamp(rampId: string): ColorRamp {
  return colorRamps.find((ramp) => ramp.id === rampId) ?? colorRamps[0];
}
