import { LegendPanel } from "./LegendPanel";
import { StatusBadge } from "./StatusBadge";

import type { LayerDefinition, LayerDiagnostics, RendererFeatureValue, LayerRuntimeState } from "../../layers/types";
import type { DataSource } from "../../types/weather";
import { parseWmsTimeDimension, resolveWmsTimeForTimeline } from "../../time/wmsTime";

interface RightInspectorProps {
  longitude: number | null;
  latitude: number | null;
  values: RendererFeatureValue[];
  activeLayer: LayerDefinition | null;
  sources: DataSource[];
  diagnostics: LayerDiagnostics;
  nearestStation: string | null;
  activeAlert: string | null;
  animationFrame: number;
  selectedValidTime: string;
  runtimeState: Record<string, LayerRuntimeState>;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <summary className="wb-section-header" style={{ listStyle: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {label}
      <span className="wb-section-chevron">▶</span>
    </summary>
  );
}

export function RightInspector({
  longitude,
  latitude,
  values,
  activeLayer,
  sources,
  diagnostics,
  nearestStation,
  activeAlert,
  animationFrame,
  selectedValidTime,
  runtimeState,
}: RightInspectorProps) {
  const activeSource = activeLayer
    ? sources.find((s) => s.source_id === activeLayer.sourceId)
    : null;

  const validTimeMs = new Date(selectedValidTime).getTime();

  return (
    <aside className="wb-right-panel">

      {/* Inspector */}
      <details className="wb-section" open>
        <SectionHeader label="Inspector" />
        <div className="wb-section-body">
          <p className="wb-muted" style={{ margin: "0 0 4px" }}>
            Frame {animationFrame + 1} · {new Date(selectedValidTime).toLocaleTimeString()}
          </p>
          {longitude !== null && latitude !== null ? (
            <>
              <p className="wb-muted" style={{ margin: "0 0 4px", fontFamily: "monospace" }}>
                {longitude.toFixed(4)}, {latitude.toFixed(4)}
              </p>
              {nearestStation && (
                <p className="wb-muted" style={{ margin: "0 0 2px" }}>⊙ {nearestStation}</p>
              )}
              {activeAlert && (
                <p style={{ margin: "0 0 2px", fontSize: 10, color: "var(--wb-warn)" }}>⚠ {activeAlert}</p>
              )}
              {values.length > 0 && (
                <div className="wb-value-grid" style={{ marginTop: 4 }}>
                  {values.map((v) => (
                    <div key={v.label}>
                      <span>{v.label}</span>
                      <strong>{v.value} <span style={{ color: "var(--wb-muted)" }}>{v.unit}</span></strong>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="wb-muted" style={{ margin: 0 }}>Click map to inspect.</p>
          )}
        </div>
      </details>

      {/* Legend */}
      <details className="wb-section" open>
        <SectionHeader label="Legend" />
        <div className="wb-section-body">
          {activeLayer ? (
            <LegendPanel activeLayer={activeLayer} />
          ) : (
            <p className="wb-muted" style={{ margin: 0 }}>No active layer selected.</p>
          )}
        </div>
      </details>

      {/* Sources */}
      <details className="wb-section" open>
        <SectionHeader label="Sources" />
        <div className="wb-section-body">
          {activeLayer && (
            <p className="wb-muted" style={{ margin: "0 0 6px" }}>
              Active: {activeSource?.name ?? activeLayer.sourceId}
              {activeSource?.retrieved_at
                ? ` · ${new Date(activeSource.retrieved_at).toLocaleTimeString()}`
                : ""}
            </p>
          )}
          <div className="wb-source-list">
            {sources.map((source) => (
              <div key={source.source_id} className="wb-source-row">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source.name}</span>
                <StatusBadge status={source.status} />
              </div>
            ))}
          </div>
          {activeLayer?.wmsLayerName && (
            <div style={{ marginTop: 6, fontSize: 10 }}>
              <p className="wb-muted" style={{ margin: "2px 0", wordBreak: "break-all" }}>Layer: {activeLayer.wmsLayerName}</p>
              {!!activeLayer.metadata?.time_extent && (
                <p className="wb-muted" style={{ margin: "2px 0" }}>
                  Time: {resolveWmsTimeForTimeline(
                    validTimeMs,
                    parseWmsTimeDimension(activeLayer.metadata.time_extent as string),
                    runtimeState[activeLayer.id]?.wmsTimePolicy ?? "global",
                    runtimeState[activeLayer.id]?.wmsFixedTime,
                  ) || "—"}
                </p>
              )}
            </div>
          )}
        </div>
      </details>

      {/* Diagnostics */}
      <details className="wb-section">
        <SectionHeader label="Diagnostics" />
        <div className="wb-section-body">
          <div className="wb-value-grid">
            <div><span>FPS</span><strong>{diagnostics.fps.toFixed(1)}</strong></div>
            <div><span>Layers</span><strong>{diagnostics.activeLayerCount}</strong></div>
            <div><span>Animated</span><strong>{diagnostics.animatedLayerCount}</strong></div>
            <div><span>Deck</span><strong>{diagnostics.deckLayerCount}</strong></div>
            <div><span>Mode</span><strong>{diagnostics.mapMode}</strong></div>
            <div>
              <span>Refresh</span>
              <strong>{diagnostics.lastDataRefreshAt ? new Date(diagnostics.lastDataRefreshAt).toLocaleTimeString() : "—"}</strong>
            </div>
          </div>
          {diagnostics.warnings.length > 0 && (
            <ul className="wb-warnings">
              {diagnostics.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      </details>

    </aside>
  );
}
