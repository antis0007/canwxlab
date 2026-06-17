import type { WindowManager } from "../hooks/useWindowManager";

interface WindowTrayProps {
  wm: WindowManager;
}

export function WindowTray({ wm }: WindowTrayProps) {
  const minimized = wm.windows.filter((w) => w.minimized);
  if (minimized.length === 0) return null;

  return (
    <div className="wb-tray" role="toolbar" aria-label="Minimized panels">
      {minimized.map((w) => {
        const label = w.entity.kind === "quake"
          ? `M${(w.entity.data as { magnitude: number }).magnitude?.toFixed(1) ?? "?"}`
          : w.entity.kind === "aircraft"
            ? (w.entity.data as { callsign?: string }).callsign || w.entity.id
            : w.entity.kind === "place"
              ? (w.entity.data as { name?: string }).name || w.entity.id
              : w.entity.id;

        const icon =
          w.kind === "quake" ? "⚡" :
          w.kind === "aircraft" ? "✈" :
          w.kind === "place" ? "◈" : "★";

        const truncated = label.length > 18 ? label.slice(0, 17) + "…" : label;

        return (
          <div key={w.id} className="wb-tray-chip">
            <button
              type="button"
              className="wb-tray-chip-btn"
              onClick={() => { wm.restore(w.id); wm.bringToFront(w.id); }}
              title={`Restore: ${label}`}
            >
              <span className="wb-tray-chip-icon">{icon}</span>
              <span className="wb-tray-chip-label">{truncated}</span>
            </button>
            <button
              type="button"
              className="wb-tray-chip-close"
              onClick={() => wm.close(w.id)}
              title="Close"
              aria-label={`Close ${label}`}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
