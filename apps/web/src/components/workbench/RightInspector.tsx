import { LegendPanel } from "./LegendPanel";
import { StatusBadge } from "./StatusBadge";

import type { LayerDefinition, LayerDiagnostics, RendererFeatureValue } from "../../layers/types";
import type { DataSource } from "../../types/weather";

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
}: RightInspectorProps) {
  const activeSource = activeLayer
    ? sources.find((source) => source.source_id === activeLayer.sourceId)
    : null;

  return (
    <aside className="wb-right-panel">
      <section className="wb-panel-block">
        <h3>Inspector</h3>
        <p className="wb-muted">Frame {animationFrame + 1} | Valid {new Date(selectedValidTime).toLocaleString()}</p>
        {longitude !== null && latitude !== null ? (
          <>
            <p className="wb-muted">Lon {longitude.toFixed(4)} | Lat {latitude.toFixed(4)}</p>
            {nearestStation && <p className="wb-muted">Nearest station: {nearestStation}</p>}
            {activeAlert && <p className="wb-muted">Active alert: {activeAlert}</p>}
            <div className="wb-value-grid">
              {values.map((value) => (
                <div key={value.label}>
                  <span>{value.label}</span>
                  <strong>{value.value} {value.unit}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="wb-muted">Click the map to inspect layers.</p>
        )}
      </section>

      <section className="wb-panel-block">
        <h3>Legend</h3>
        <LegendPanel activeLayer={activeLayer} />
      </section>

      <section className="wb-panel-block">
        <h3>Sources</h3>
        {activeLayer && (
          <p className="wb-muted">
            Active layer source: {activeSource?.name ?? activeLayer.sourceId}
            {activeSource?.retrieved_at ? ` | Retrieved ${new Date(activeSource.retrieved_at).toLocaleTimeString()}` : ""}
          </p>
        )}
        <div className="wb-source-list">
          {sources.map((source) => (
            <div key={source.source_id} className="wb-source-row">
              <span>{source.name}</span>
              <StatusBadge status={source.status} />
            </div>
          ))}
        </div>
        {activeLayer?.wmsLayerName && (
          <div style={{ marginTop: "8px" }}>
            <p className="wb-muted">WMS Info:</p>
            <p className="wb-muted" style={{ fontSize: "0.75rem" }}>URL: {activeLayer.wmsBaseUrl}</p>
            <p className="wb-muted" style={{ fontSize: "0.75rem" }}>Layer: {activeLayer.wmsLayerName}</p>
          </div>
        )}
      </section>

      <section className="wb-panel-block">
        <h3>Rendering Diagnostics</h3>
        <div className="wb-value-grid">
          <div><span>FPS</span><strong>{diagnostics.fps.toFixed(1)}</strong></div>
          <div><span>Active layers</span><strong>{diagnostics.activeLayerCount}</strong></div>
          <div><span>Animated layers</span><strong>{diagnostics.animatedLayerCount}</strong></div>
          <div><span>Deck layers</span><strong>{diagnostics.deckLayerCount}</strong></div>
          <div><span>Mode</span><strong>{diagnostics.mapMode}</strong></div>
          <div><span>Refresh</span><strong>{diagnostics.lastDataRefreshAt ? new Date(diagnostics.lastDataRefreshAt).toLocaleTimeString() : "n/a"}</strong></div>
        </div>
        {diagnostics.warnings.length > 0 && (
          <ul className="wb-warnings">
            {diagnostics.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        )}
      </section>

      <section className="wb-panel-block">
        <h3>Console</h3>
        <div style={{ maxHeight: "150px", overflowY: "auto", background: "rgba(0,0,0,0.3)", padding: "4px", borderRadius: "4px", fontSize: "0.75rem", fontFamily: "monospace" }}>
          <div className="wb-muted">[system] Workbench initialized</div>
          <div className="wb-muted">[wms] Discovered layers</div>
          {activeLayer && <div className="wb-muted">[layer] Inspector active: {activeLayer.title}</div>}
        </div>
      </section>
    </aside>
  );
}
