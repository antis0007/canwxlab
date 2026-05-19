import { describe, expect, it } from "vitest";
import { createInitialLayerState, fallbackLayers } from "./lib/layerRegistry";

describe("layer registry", () => {
  it("creates default state for every fallback layer", () => {
    const state = createInitialLayerState(fallbackLayers);
    expect(Object.keys(state)).toHaveLength(fallbackLayers.length);
    // Real ECCC layers are enabled by default; verify at least one is present.
    const enabledLayers = Object.values(state).filter((s) => s.visible);
    expect(enabledLayers.length).toBeGreaterThan(0);
  });

  it("only contains real ECCC layers (no mock entries)", () => {
    expect(fallbackLayers.every((layer) => !layer.layer_id.startsWith("mock_"))).toBe(true);
  });
});
