import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LayerControl } from "./LayerControl";
import { SourceStatusPanel } from "./SourceStatusPanel";
import { fallbackLayers, fallbackSources } from "../lib/layerRegistry";
import type { LayerControlState } from "../lib/layerRegistry";

function layerStateFor(ids: string[]): Record<string, LayerControlState> {
  return Object.fromEntries(
    ids.map((id) => [id, { visible: true, opacity: 0.6, colorRamp: "default" }])
  );
}

describe("status components", () => {
  it("renders layer badges for all statuses", () => {
    const layers = [
      { ...fallbackLayers[0], layer_id: "layer-live", status: "live" as const, name: "Live layer" },
      { ...fallbackLayers[1], layer_id: "layer-derived", status: "derived" as const, name: "Derived layer" },
      { ...fallbackLayers[2], layer_id: "layer-stale", status: "stale" as const, name: "Stale layer" },
      { ...fallbackLayers[3], layer_id: "layer-fallback", status: "fallback" as const, name: "Fallback layer" },
      { ...fallbackLayers[4], layer_id: "layer-unavailable", status: "unavailable" as const, name: "Unavailable layer" }
    ];

    const html = renderToStaticMarkup(
      <LayerControl
        layers={layers}
        layerState={layerStateFor(layers.map((layer) => layer.layer_id))}
        onChange={() => undefined}
      />
    );

    expect(html).toContain("status-live");
    expect(html).toContain("status-derived");
    expect(html).toContain("status-stale");
    expect(html).toContain("status-fallback");
    expect(html).toContain("status-unavailable");
  });

  it("renders source health statuses", () => {
    const sources = [
      { ...fallbackSources[0], source_id: "source-live", status: "live" as const, name: "Live source" },
      { ...fallbackSources[0], source_id: "source-derived", status: "derived" as const, name: "Derived source" },
      {
        ...fallbackSources[0],
        source_id: "source-stale",
        status: "stale" as const,
        name: "Stale source",
        message: "Using stale cache"
      },
      {
        ...fallbackSources[0],
        source_id: "source-unavailable",
        status: "unavailable" as const,
        name: "Unavailable source",
        message: "Unavailable"
      }
    ];

    const html = renderToStaticMarkup(
      <SourceStatusPanel
        sources={sources}
        apiError={null}
        onRefresh={() => undefined}
        isRefreshing={false}
      />
    );

    expect(html).toContain("Source Health");
    expect(html).toContain("status-live");
    expect(html).toContain("status-derived");
    expect(html).toContain("status-stale");
    expect(html).toContain("status-unavailable");
    expect(html).toContain("Refresh");
  });
});
