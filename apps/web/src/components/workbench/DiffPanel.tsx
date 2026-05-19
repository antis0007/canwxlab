import { useEffect, useState } from "react";
import type { VerificationMetric } from "../../types/weather";
import { api } from "../../lib/api";
import type { DiffOverlayPayload } from "../../layers/renderers/diffBitmap";

interface DiffPanelProps {
  metrics: VerificationMetric[];
  onDiffOverlay?: (payload: DiffOverlayPayload | null) => void;
}

interface VerificationCaseRow {
  case_id: string;
  name: string;
  fields?: Array<{ name: string; unit: string }>;
  bbox?: [number, number, number, number];
}

const DIFF_MODE_API: Record<string, string> = {
  a_minus_b: "A_MINUS_B",
  absolute_error: "ABSOLUTE_ERROR",
  percent_error: "PERCENT_ERROR",
  threshold: "THRESHOLD_EXCEEDANCE",
};

export function DiffPanel({ metrics, onDiffOverlay }: DiffPanelProps) {
  const [baseline, setBaseline] = useState("observed");
  const [comparison, setComparison] = useState("official_forecast");
  const [variable, setVariable] = useState("temperature_2m");
  const [diffMode, setDiffMode] = useState("absolute_error");
  const [showOverlay, setShowOverlay] = useState(false);
  const [opacity, setOpacity] = useState("0.7");
  const [cases, setCases] = useState<VerificationCaseRow[]>([]);
  const [selectedCase, setSelectedCase] = useState<string>("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = (await api.verificationCases()) as unknown as VerificationCaseRow[];
        setCases(rows);
        if (rows.length > 0 && !selectedCase) setSelectedCase(rows[0].case_id);
      } catch (err) {
        setFetchError(err instanceof Error ? err.message : "fetch cases failed");
      }
    })();
  // selectedCase intentionally omitted to seed only once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drive the map overlay whenever toggle/parameters change.
  useEffect(() => {
    if (!onDiffOverlay) return;
    if (!showOverlay || !selectedCase) {
      onDiffOverlay(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const apiMode = DIFF_MODE_API[diffMode] ?? "ABSOLUTE_ERROR";
        const resp = await api.verificationCaseDiff(selectedCase, variable, apiMode);
        if (cancelled) return;
        onDiffOverlay({
          caseId: selectedCase,
          field: resp.field,
          diffMode: resp.diff_mode,
          bbox: resp.bbox,
          rows: resp.rows,
          cols: resp.cols,
          grid: resp.grid,
          isGeneratedMock: resp.is_generated_mock,
          opacity: Number(opacity),
        });
        setFetchError(null);
      } catch (err) {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : "fetch diff failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onDiffOverlay, showOverlay, selectedCase, variable, diffMode, opacity]);

  return (
    <div className="wb-scroll-panel">
      <article className="wb-layer-card">
        <strong>Verification / Diff Setup</strong>

        <label style={{ display: "block", marginTop: "8px" }}>
          Verification Case
          <select
            value={selectedCase}
            onChange={(e) => setSelectedCase(e.target.value)}
            style={{ width: "100%" }}
          >
            {cases.length === 0 && <option value="">(no cases)</option>}
            {cases.map((c) => (
              <option key={c.case_id} value={c.case_id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {fetchError && (
          <p className="wb-warning" style={{ marginTop: 3 }}>{fetchError}</p>
        )}
        <p className="wb-muted" style={{ marginTop: 3 }}>
          GENERATED — overlay is a deterministic synthetic field until real
          observed/forecast archives back the case.
        </p>

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
            <option value="temperature_2m">Temperature (2 m)</option>
            <option value="precipitation" disabled>Precipitation (Placeholder)</option>
            <option value="wind_speed" disabled>Wind Speed (Placeholder)</option>
            <option value="cloud" disabled>Cloud (Placeholder)</option>
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
