import type { SimulationRun } from "../types/weather";

interface SimulationPanelProps {
  run: SimulationRun | null;
  isRunning: boolean;
  onRun: () => void;
}

export function SimulationPanel({ run, isRunning, onRun }: SimulationPanelProps) {
  return (
    <section className="panel-section compact-section">
      <div className="section-heading">
        <span>Simulation</span>
        <small>CanWxSim</small>
      </div>
      <p className="muted">Runs a mock API-backed demo now; Rust engine integration is intentionally a worker boundary.</p>
      <button className="primary-button" disabled={isRunning} onClick={onRun}>
        {isRunning ? "Starting run..." : "Run sample simulation"}
      </button>
      {run && (
        <div className="simulation-result">
          <div className="value-row"><span>Run</span><strong>{run.run_id}</strong></div>
          <div className="value-row"><span>Status</span><strong>{run.status}</strong></div>
          {run.diagnostics && (
            <>
              <div className="value-row"><span>Steps</span><strong>{run.diagnostics.steps_completed}</strong></div>
              <div className="value-row"><span>Max wind</span><strong>{run.diagnostics.max_wind_speed.toFixed(1)} m/s</strong></div>
              <div className="value-row"><span>Water budget error</span><strong>{run.diagnostics.water_budget_error.toFixed(3)}</strong></div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
