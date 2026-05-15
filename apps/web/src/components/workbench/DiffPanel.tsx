import { useState } from "react";
import type { VerificationMetric } from "../../types/weather";

interface DiffPanelProps {
  metrics: VerificationMetric[];
}

export function DiffPanel({ metrics }: DiffPanelProps) {
  const [baseline, setBaseline] = useState("observed");
  const [comparison, setComparison] = useState("official_forecast");
  const [variable, setVariable] = useState("temperature");
  const [diffMode, setDiffMode] = useState("absolute_error");
  const [showOverlay, setShowOverlay] = useState(false);
  const [opacity, setOpacity] = useState("0.7");

  return (
    <div className="wb-scroll-panel">
      <article className="wb-layer-card">
        <strong>Verification / Diff Setup</strong>
        
        <label style={{ display: "block", marginTop: "8px" }}>
          Baseline
          <select value={baseline} onChange={e => setBaseline(e.target.value)} style={{ width: "100%" }}>
            <option value="observed">Observed</option>
            <option value="official_forecast">Official Forecast</option>
            <option value="canwxsim">CanWxSim</option>
            <option value="plugin_forecast">Plugin Forecast</option>
          </select>
        </label>

        <label style={{ display: "block", marginTop: "8px" }}>
          Comparison
          <select value={comparison} onChange={e => setComparison(e.target.value)} style={{ width: "100%" }}>
            <option value="observed">Observed</option>
            <option value="official_forecast">Official Forecast</option>
            <option value="canwxsim">CanWxSim</option>
            <option value="plugin_forecast">Plugin Forecast</option>
          </select>
        </label>

        <label style={{ display: "block", marginTop: "8px" }}>
          Variable
          <select value={variable} onChange={e => setVariable(e.target.value)} style={{ width: "100%" }}>
            <option value="temperature">Temperature</option>
            <option value="precipitation">Precipitation</option>
            <option value="wind_speed">Wind Speed</option>
            <option value="cloud">Cloud</option>
            <option value="pressure" disabled>Pressure (Placeholder)</option>
          </select>
        </label>

        <label style={{ display: "block", marginTop: "8px" }}>
          Diff Mode
          <select value={diffMode} onChange={e => setDiffMode(e.target.value)} style={{ width: "100%" }}>
            <option value="a_minus_b">A - B</option>
            <option value="absolute_error">Absolute Error</option>
            <option value="percent_error">Percent Error</option>
            <option value="threshold">Threshold Exceedance</option>
            <option value="hit_miss" disabled>Categorical Hit/Miss</option>
          </select>
        </label>
      </article>

      <article className="wb-layer-card">
        <div className="wb-row-between">
          <strong>Diff Overlay</strong>
          <label className="wb-layer-toggle">
            <input type="checkbox" checked={showOverlay} onChange={e => setShowOverlay(e.target.checked)} />
            Show
          </label>
        </div>
        {showOverlay && (
          <label style={{ display: "block", marginTop: "8px" }}>
            Opacity
            <input type="range" min="0" max="1" step="0.1" value={opacity} onChange={e => setOpacity(e.target.value)} style={{ width: "100%" }} />
          </label>
        )}
      </article>

      <article className="wb-layer-card">
        <strong>Error Metrics Table</strong>
        {metrics.length === 0 ? (
          <p className="wb-muted">No metrics available.</p>
        ) : (
          <div style={{ marginTop: "8px" }}>
            {metrics.map(metric => (
              <div key={metric.metric_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "4px", marginBottom: "4px" }}>
                <div className="wb-row-between">
                  <span style={{ fontSize: "0.8rem", fontWeight: "bold" }}>{metric.model_name} - {metric.variable}</span>
                  <span className="wb-chip">{metric.status}</span>
                </div>
                <div className="wb-value-grid" style={{ marginTop: "4px" }}>
                  <div><span>MAE</span><strong>{metric.mae.toFixed(2)}</strong></div>
                  <div><span>RMSE</span><strong>{metric.rmse.toFixed(2)}</strong></div>
                  <div><span>Bias</span><strong>{metric.bias.toFixed(2)}</strong></div>
                  <div><span>Sample</span><strong>{metric.sample_count}</strong></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
