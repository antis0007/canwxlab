import type { WeatherLayer } from "../types/weather";
import type { LayerControlState } from "../lib/layerRegistry";

interface LayerControlProps {
  layers: WeatherLayer[];
  layerState: Record<string, LayerControlState>;
  onChange: (layerId: string, next: LayerControlState) => void;
}

export function LayerControl({ layers, layerState, onChange }: LayerControlProps) {
  return (
    <section className="panel-section">
      <div className="section-heading">
        <span>Layers</span>
        <small>{layers.length}</small>
      </div>
      <div className="layer-list">
        {layers.map((layer) => {
          const state = layerState[layer.layer_id] ?? {
            visible: false,
            opacity: layer.default_opacity,
            colorRamp: layer.color_ramps[0] ?? "default"
          };
          return (
            <article key={layer.layer_id} className="layer-card">
              <label className="layer-title">
                <input
                  type="checkbox"
                  checked={state.visible}
                  disabled={layer.status === "unavailable"}
                  onChange={(event) => onChange(layer.layer_id, { ...state, visible: event.target.checked })}
                />
                <span>{layer.name}</span>
                <em className={`status-pill status-${layer.status}`}>{layer.status}</em>
                {layer.is_experimental && <em className="status-pill status-experimental">experimental</em>}
              </label>
              <p>{layer.description}</p>
              {layer.status === "unavailable" && (
                <p className="warning-text">Unavailable: {layer.message || "Live configuration needed."}</p>
              )}
              {layer.service_type === "wms" && !layer.wms_layer_name && (
                <p className="muted">WMS layer name not yet verified from capabilities.</p>
              )}
              <div className="control-row">
                <span>Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={state.opacity}
                  onChange={(event) => onChange(layer.layer_id, { ...state, opacity: Number(event.target.value) })}
                />
                <output>{Math.round(state.opacity * 100)}%</output>
              </div>
              <div className="control-row">
                <span>Ramp</span>
                <select
                  value={state.colorRamp}
                  onChange={(event) => onChange(layer.layer_id, { ...state, colorRamp: event.target.value })}
                >
                  {layer.color_ramps.map((ramp) => <option key={ramp}>{ramp}</option>)}
                </select>
              </div>
              <dl className="metadata-grid">
                <div><dt>Variable</dt><dd>{layer.variable}</dd></div>
                <div><dt>Unit</dt><dd>{layer.unit}</dd></div>
                <div><dt>Source</dt><dd>{layer.source_id}</dd></div>
                <div><dt>Service</dt><dd>{layer.service_type}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
