import { useEffect, useRef } from "react";
import type { SelectedEntity } from "../../types/entities";
import type { WindowManager, ManagedWindow } from "../../hooks/useWindowManager";
import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import { lookupAirline } from "../../lib/icaoAirlines";
import { aircraftColor, deadReckon } from "../../layers/renderers/osint";
import { createTracedPathLayer, createProjectedPathLayer } from "../../layers/renderers/aircraftPaths";
import { WindowShell } from "../WindowShell";

const EMERGENCY: Record<string, string> = { "7500": "HIJACK", "7600": "RADIO FAIL", "7700": "MAYDAY" };

function fmtAlt(m: number | null): string {
  if (m === null) return "On ground";
  const ft = Math.round(m * 3.28084);
  return `${ft.toLocaleString()} ft (${Math.round(m).toLocaleString()} m)`;
}

function fmtSpeed(mps: number): string {
  const kts = Math.round(mps * 1.94384);
  const kmh = Math.round(mps * 3.6);
  return `${kts} kts (${kmh} km/h)`;
}

interface Props {
  entity: SelectedEntity & { kind: "aircraft" };
  wm: WindowManager;
  win: ManagedWindow;
  liveStates: AircraftState[];
  nowMs: number;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
  onExtraLayers: (id: string, layers: unknown[]) => void;
}

const MAX_TRACE = 40;

export function AircraftDetailPanel({ entity, wm, win, liveStates, nowMs, onFlyTo, onExtraLayers }: Props) {
  const traceRef = useRef<[number, number][]>([]);
  const lastIdRef = useRef<string>("");

  // Find live state for this aircraft (may have updated since panel opened)
  const liveState = liveStates.find((s) => s.id === entity.id) ?? entity.data;
  const pos = deadReckon(liveState, nowMs);

  // Accumulate trace positions each time liveState updates
  useEffect(() => {
    if (lastIdRef.current !== entity.id) {
      traceRef.current = [];
      lastIdRef.current = entity.id;
    }
    const last = traceRef.current.length > 0 ? traceRef.current[traceRef.current.length - 1] : undefined;
    const [lon, lat] = pos;
    if (!last || Math.hypot(lon - last[0], lat - last[1]) > 0.002) {
      traceRef.current = [...traceRef.current.slice(-MAX_TRACE), [lon, lat] as [number, number]];
    }
    const color = aircraftColor(liveState);
    const traceLayers: unknown[] = [];
    const trace = createTracedPathLayer(traceRef.current, [color[0], color[1], color[2], 160]);
    if (trace) traceLayers.push(trace);
    const proj = createProjectedPathLayer(liveState, nowMs);
    if (proj) traceLayers.push(proj);
    onExtraLayers(win.id, traceLayers);
  }, [liveState, nowMs, entity.id, win.id, onExtraLayers, pos]);

  // Cleanup layers when panel closes
  useEffect(() => {
    return () => onExtraLayers(win.id, []);
  }, [win.id, onExtraLayers]);

  const airline = lookupAirline(liveState.callsign);
  const emergency = liveState.squawk ? EMERGENCY[liveState.squawk] : null;

  const flightAwareUrl = liveState.callsign
    ? `https://flightaware.com/live/flight/${liveState.callsign.trim()}`
    : null;
  const fr24Url = liveState.callsign
    ? `https://www.flightradar24.com/${liveState.callsign.trim()}`
    : null;

  return (
    <WindowShell
      id={win.id}
      title={liveState.callsign || liveState.id}
      subtitle={airline ?? undefined}
      icon="✈"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(p) => wm.move(win.id, p)}
      onResize={(s) => wm.resize(win.id, s)}
      wm={wm}
    >
      {emergency && (
        <div className="wb-ep-badge critical" style={{ display: "block", textAlign: "center", marginBottom: 8 }}>
          SQUAWK {liveState.squawk} — {emergency}
        </div>
      )}

      <div className="wb-ep-hero">
        <div className="wb-ep-hero-val" style={{ fontSize: 20 }}>{liveState.callsign || liveState.id}</div>
        {airline && <div className="wb-ep-hero-label">{airline}</div>}
        <div style={{ marginTop: 6 }}>
          <span className={`wb-ep-badge ${liveState.onGround ? "" : "live"}`}>
            {liveState.onGround ? "On Ground" : "Airborne"}
          </span>
        </div>
      </div>

      <div className="wb-ep-divider" />

      <dl className="wb-ep-grid">
        <dt>ICAO24</dt>   <dd style={{ fontFamily: "monospace" }}>{liveState.id}</dd>
        {liveState.squawk && <><dt>Squawk</dt><dd style={{ fontFamily: "monospace" }}>{liveState.squawk}</dd></>}
        <dt>Altitude</dt> <dd>{fmtAlt(liveState.altitudeM)}</dd>
        <dt>Speed</dt>    <dd>{fmtSpeed(liveState.velocityMps)}</dd>
        <dt>Heading</dt>  <dd>{Math.round(liveState.headingDeg)}°</dd>
        <dt>Position</dt> <dd>{pos[1].toFixed(3)}° / {pos[0].toFixed(3)}°</dd>
        <dt>Updated</dt>  <dd>{new Date(liveState.timeMs).toISOString().slice(11, 19)}Z</dd>
      </dl>

      <div className="wb-ep-section-label">Path</div>
      <div style={{ fontSize: 10, color: "var(--wb-muted)" }}>
        Trace: {traceRef.current.length} pts · Projection: 30 min ahead
      </div>

      <div className="wb-ep-action-row">
        <button type="button" className="wb-ep-action primary" onClick={() => onFlyTo(pos[0], pos[1], 8)}>
          Fly To
        </button>
      </div>

      <div className="wb-ep-links">
        {flightAwareUrl && <a href={flightAwareUrl} target="_blank" rel="noreferrer">FlightAware</a>}
        {fr24Url && <a href={fr24Url} target="_blank" rel="noreferrer">FlightRadar24</a>}
        <a href={`https://www.planespotters.net/flight/${liveState.callsign || liveState.id}`} target="_blank" rel="noreferrer">Planespotters</a>
      </div>
    </WindowShell>
  );
}
