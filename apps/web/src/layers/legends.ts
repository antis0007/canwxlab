import { resolveRamp } from "./colorRamps";
import type { LayerLegend } from "./types";

export function legendFromRamp(title: string, unit: string | undefined, rampId: string): LayerLegend {
  const ramp = resolveRamp(rampId);
  return {
    title,
    unit,
    gradient: ramp.cssGradient,
    stops: ramp.stops.map((stop) => ({
      value: stop.value,
      color: stop.color,
      label: `${stop.value}`,
    })),
  };
}

export function alertLegend(): LayerLegend {
  return {
    title: "Alert Severity",
    unit: "category",
    gradient: "linear-gradient(90deg, #7ee4c2 0%, #ffd166 50%, #ef476f 100%)",
    stops: [
      { value: 1, color: "#7ee4c2", label: "Minor" },
      { value: 2, color: "#ffd166", label: "Moderate" },
      { value: 3, color: "#ef476f", label: "Severe" },
    ],
  };
}
