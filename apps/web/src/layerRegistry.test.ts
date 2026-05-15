import { describe, expect, it } from "vitest";
import { createInitialLayerState, fallbackLayers, sampleLayerValues } from "./lib/layerRegistry";

describe("layer registry", () => {
  it("creates default state for every fallback layer", () => {
    const state = createInitialLayerState(fallbackLayers);
    expect(Object.keys(state)).toHaveLength(fallbackLayers.length);
    expect(state.mock_temperature.visible).toBe(true);
  });

  it("samples deterministic inspector values", () => {
    const values = sampleLayerValues(-113.5, 53.5);
    expect(values.some((item) => item.label === "Mock temperature")).toBe(true);
  });
});
