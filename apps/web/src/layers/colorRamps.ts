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
    id: "pressure",
    label: "Mean Sea Level Pressure",
    cssGradient: "linear-gradient(90deg, #3b2f7f 0%, #2677a8 28%, #eef4f8 50%, #d78b36 72%, #8f2d24 100%)",
    stops: [
      { value: 980, color: "#3b2f7f" },
      { value: 996, color: "#2677a8" },
      { value: 1013, color: "#eef4f8" },
      { value: 1028, color: "#d78b36" },
      { value: 1045, color: "#8f2d24" },
    ],
    recommendedVariables: ["pressure_msl", "mslp", "pressure"],
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

export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  const parsed = Number.parseInt(clean, 16);
  return [(parsed >> 16) & 0xff, (parsed >> 8) & 0xff, parsed & 0xff];
}

function interpolate(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function rgbForRampValue(
  rampId: string,
  value: number,
): [number, number, number] {
  const ramp = resolveRamp(rampId);
  const stops = ramp.stops.slice().sort((a, b) => a.value - b.value);
  if (stops.length === 0) return [128, 128, 128];
  if (value <= stops[0].value) return hexToRgb(stops[0].color) ?? [128, 128, 128];
  const last = stops[stops.length - 1];
  if (value >= last.value) return hexToRgb(last.color) ?? [128, 128, 128];

  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1];
    const next = stops[i];
    if (value > next.value) continue;
    const prevRgb = hexToRgb(prev.color);
    const nextRgb = hexToRgb(next.color);
    if (!prevRgb || !nextRgb) return [128, 128, 128];
    const t = (value - prev.value) / Math.max(0.000001, next.value - prev.value);
    return [
      Math.round(interpolate(prevRgb[0], nextRgb[0], t)),
      Math.round(interpolate(prevRgb[1], nextRgb[1], t)),
      Math.round(interpolate(prevRgb[2], nextRgb[2], t)),
    ];
  }

  return hexToRgb(last.color) ?? [128, 128, 128];
}

export function valueForRampColor(
  rampId: string,
  rgb: [number, number, number],
): { value: number; distance: number; confidence: number } | null {
  const ramp = resolveRamp(rampId);
  const stops = ramp.stops.slice().sort((a, b) => a.value - b.value);
  if (stops.length < 2) return null;
  const min = stops[0].value;
  const max = stops[stops.length - 1].value;
  let bestValue = min;
  let bestDistance = Number.POSITIVE_INFINITY;
  const samples = 160;
  for (let i = 0; i <= samples; i += 1) {
    const value = min + ((max - min) * i) / samples;
    const sampled = rgbForRampValue(rampId, value);
    const distance = Math.hypot(sampled[0] - rgb[0], sampled[1] - rgb[1], sampled[2] - rgb[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = value;
    }
  }
  return {
    value: bestValue,
    distance: bestDistance,
    confidence: Math.max(0, Math.min(1, 1 - bestDistance / 160)),
  };
}
