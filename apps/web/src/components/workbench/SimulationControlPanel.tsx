import { useState } from "react";
import type { SimulationRun } from "../../types/weather";

interface SimulationControlPanelProps {
  simulationRun: SimulationRun | null;
  isRunning: boolean;
  onRun: () => void;
}

export function SimulationControlPanel({ simulationRun, isRunning, onRun }: SimulationControlPanelProps) {
  const [domainSize, setDomainSize] = useState("100");
  const [resolution, setResolution] = useState("standard");
  const [duration, setDuration] = useState("6");
  const [physics, setPhysics] = useState("2d_pressure_wind");
  const [initialConditions, setInitialConditions] = useState("synthetic");

  return (
    <div className="wb-scroll-panel">
      <article className="wb-layer-card">
        <strong>Selected Location</strong>
        <p className="wb-muted" style={{ marginTop: "4px" }}>Click map to select domain center, or use a station.</p>
        <button disabled title="Not implemented">Search City</button>
      </article>

      <article className="wb-layer-card">
        <strong>Domain Configuration</strong>
        <label style={{ display: "block", marginTop: "8px" }}>
          Size (km)
          <select value={domainSize} onChange={e => setDomainSize(e.target.value)} style={{ width: "100%" }}>
            <option value="25">25 km</option>
            <option value="50">50 km</option>
            <option value="100">100 km</option>
            <option value="250">250 km</option>
            <option value="500">500 km</option>
          </select>
        </label>
        <label style={{ display: "block", marginTop: "8px" }}>
          Resolution
          <select value={resolution} onChange={e => setResolution(e.target.value)} style={{ width: "100%" }}>
            <option value="coarse">Coarse</option>
            <option value="standard">Standard</option>
            <option value="fine_exp">Fine (Experimental)</option>
          </select>
        </label>
      </article>

      <article className="wb-layer-card">
        <strong>Run Parameters</strong>
        <label style={{ display: "block", marginTop: "8px" }}>
          Duration (hours)
          <select value={duration} onChange={e => setDuration(e.target.value)} style={{ width: "100%" }}>
            <option value="1">1 hour</option>
            <option value="3">3 hours</option>
            <option value="6">6 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
            <option value="48_exp">48 hours (Experimental)</option>
          </select>
        </label>
        <label style={{ display: "block", marginTop: "8px" }}>
          Physics Preset
          <select value={physics} onChange={e => setPhysics(e.target.value)} style={{ width: "100%" }}>
            <option value="2d_pressure_wind">2D Pressure/Wind Sandbox</option>
            <option value="moisture_cloud">Moisture/Cloud Toy Model</option>
            <option value="precip_toy">Precipitation Toy Model</option>
            <option value="regional_25d" disabled>2.5D Regional Model (Future)</option>
          </select>
        </label>
        <label style={{ display: "block", marginTop: "8px" }}>
          Initial Conditions
          <select value={initialConditions} onChange={e => setInitialConditions(e.target.value)} style={{ width: "100%" }}>
            <option value="synthetic">Synthetic/Generated</option>
            <option value="eccc_forecast" disabled>ECCC Forecast-Derived</option>
            <option value="station_radar" disabled>Station/Radar Nudged</option>
          </select>
        </label>
      </article>

      <div className="wb-row-between">
        <button onClick={onRun} disabled={isRunning}>{isRunning ? "Running..." : "Run Simulation"}</button>
        <button disabled title="Not implemented">Pause / Cancel</button>
      </div>

      {simulationRun && (
        <article className="wb-layer-card">
          <div className="wb-row-between">
            <strong style={{ fontSize: 11 }}>{simulationRun.run_id}</strong>
            <span
              className="wb-chip"
              data-status={simulationRun.status}
              style={{
                color:
                  simulationRun.status === "completed"
                    ? "var(--wb-live)"
                    : simulationRun.status === "failed"
                    ? "var(--wb-err)"
                    : simulationRun.status === "running"
                    ? "var(--wb-accent)"
                    : "var(--wb-warn)",
                letterSpacing: "0.08em",
              }}
            >
              {String(simulationRun.status).toUpperCase()}
            </span>
          </div>
          <p className="wb-muted" style={{ marginTop: 3 }}>
            EXPERIMENTAL — output is not an operational forecast.
          </p>
          {simulationRun.status === "failed" && (
            <p className="wb-warning" style={{ marginTop: 3 }}>
              {String(simulationRun.provenance?.error ?? "Run failed.")}
            </p>
          )}
          {simulationRun.provenance && typeof simulationRun.provenance === "object" && (
            <p className="wb-muted" style={{ marginTop: 3 }}>
              Mode: {String((simulationRun.provenance as Record<string, unknown>).mode ?? "—")}
              {(simulationRun.provenance as Record<string, unknown>).cli_path
                ? ` · ${String((simulationRun.provenance as Record<string, unknown>).cli_path)}`
                : ""}
            </p>
          )}
          <div className="wb-row-between" style={{ marginTop: "8px" }}>
            <button disabled={simulationRun.status !== "completed"}>
              Toggle Output Layer
            </button>
            <button disabled title="Not implemented">
              Create Verification Case
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
