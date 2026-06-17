import type { SelectedEntity } from "../../types/entities";
import type { WindowManager } from "../../hooks/useWindowManager";
import { WindowShell } from "../WindowShell";

interface Props {
  entity: SelectedEntity & { kind: "quake" };
  wm: WindowManager;
  win: import("../../hooks/useWindowManager").ManagedWindow;
  onSeekToTime: (ms: number) => void;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
}

/** Modified Mercalli Intensity from magnitude+depth (empirical estimate only). */
function estimateMMI(mag: number, depthKm: number): string {
  const r = Math.sqrt(depthKm ** 2 + 1);
  const mmi = 1.5 * mag - 1.5 * Math.log10(r) + 0.5;
  const clamped = Math.round(Math.max(1, Math.min(12, mmi)));
  const labels = ["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
  return labels[clamped] ?? "—";
}

export function QuakeDetailPanel({ entity, wm, win, onSeekToTime, onFlyTo }: Props) {
  const q = entity.data;
  const severity = q.magnitude >= 6 ? "critical" : q.magnitude >= 4.5 ? "warning" : undefined;
  const utcTime = new Date(q.timeMs).toISOString().replace("T", " ").slice(0, 19) + "Z";
  const localTime = new Date(q.timeMs).toLocaleString();
  const mmi = estimateMMI(q.magnitude, q.depthKm);
  const usgsId = q.id.startsWith("us") || q.id.startsWith("ci") || q.id.startsWith("nc")
    ? q.id : null;

  return (
    <WindowShell
      id={win.id}
      title={`M${q.magnitude.toFixed(1)} Earthquake`}
      subtitle={q.place}
      icon="⚡"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(pos) => wm.move(win.id, pos)}
      onResize={(size) => wm.resize(win.id, size)}
      wm={wm}
    >
      {/* Hero magnitude */}
      <div className="wb-ep-hero">
        <div className={`wb-ep-hero-val wb-ep-quake-mag${severity ? ` ${severity}` : ""}`}>
          {q.magnitude.toFixed(1)}
        </div>
        <div className="wb-ep-hero-label">Magnitude</div>
        {severity && <div className="wb-ep-badge" style={{ marginTop: 4 }}>{severity}</div>}
      </div>

      <div className="wb-ep-divider" />

      <dl className="wb-ep-grid">
        <dt>Place</dt>      <dd>{q.place || "—"}</dd>
        <dt>Depth</dt>      <dd>{q.depthKm.toFixed(1)} km</dd>
        <dt>MMI est.</dt>   <dd>{mmi}</dd>
        <dt>Time (UTC)</dt> <dd>{utcTime}</dd>
        <dt>Local</dt>      <dd>{localTime}</dd>
        <dt>Lat / Lon</dt>  <dd>{q.lat.toFixed(3)}° / {q.lon.toFixed(3)}°</dd>
        <dt>Event ID</dt>   <dd style={{ fontSize: 9, fontFamily: "monospace" }}>{q.id}</dd>
      </dl>

      <div className="wb-ep-action-row">
        <button
          type="button"
          className="wb-ep-action primary"
          onClick={() => onFlyTo(entity.lon, entity.lat, 7)}
        >
          Fly To
        </button>
        <button
          type="button"
          className="wb-ep-action"
          onClick={() => onSeekToTime(q.timeMs)}
        >
          Seek Timeline
        </button>
      </div>

      <div className="wb-ep-links">
        {usgsId && (
          <a
            href={`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}/executive`}
            target="_blank" rel="noreferrer"
          >USGS Event Page</a>
        )}
        <a
          href={`https://www.emsc-csem.org/Earthquake/earthquake.php?id=${q.id}`}
          target="_blank" rel="noreferrer"
        >EMSC</a>
        <a
          href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q.place)}`}
          target="_blank" rel="noreferrer"
        >Wikipedia Region</a>
        <a
          href={`https://www.google.com/maps?q=${q.lat},${q.lon}`}
          target="_blank" rel="noreferrer"
        >Google Maps</a>
      </div>
    </WindowShell>
  );
}
