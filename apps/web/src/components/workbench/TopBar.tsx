import { AnimationControls } from "./AnimationControls";
import { StatusBadge } from "./StatusBadge";

import type { AnimationPlaybackState, ViewMode } from "../../layers/types";
import type { SourceStatus } from "../../types/weather";

interface TopBarProps {
  dataMode: "mock" | "live" | "hybrid";
  timelineTime: string;
  viewMode: ViewMode;
  globeSupported: boolean;
  globeCapabilityChecked: boolean;
  onSetViewMode: (mode: ViewMode) => void;
  playback: AnimationPlaybackState;
  onTogglePlay: () => void;
  onSpeedChange: (value: number) => void;
  onResetAnimation: () => void;
  sourceHealthStatus: SourceStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
  timelineMode: string;
  onSetTimelineMode: (mode: string) => void;
}

export function TopBar({
  dataMode,
  timelineTime,
  viewMode,
  globeSupported,
  globeCapabilityChecked,
  onSetViewMode,
  playback,
  onTogglePlay,
  onSpeedChange,
  onResetAnimation,
  sourceHealthStatus,
  isRefreshing,
  onRefresh,
  timelineMode,
  onSetTimelineMode,
}: TopBarProps) {
  const now = new Date().toLocaleTimeString();
  return (
    <header className="wb-topbar">
      <div className="wb-topbar-block">
        <strong className="wb-title">CanWxLab Workbench</strong>
        <StatusBadge status={dataMode === "mock" ? "mock" : dataMode === "live" ? "live" : "fallback"} label={dataMode.toUpperCase()} />
      </div>

      <div className="wb-topbar-block">
        <span className="wb-topbar-label">Now {now}</span>
        <span className="wb-topbar-label">Valid {new Date(timelineTime).toLocaleTimeString()}</span>
        <select value={timelineMode} onChange={e => onSetTimelineMode(e.target.value)} className="wb-input" style={{ marginLeft: "8px" }}>
          <option value="live">Live</option>
          <option value="history">History</option>
          <option value="forecast">Forecast</option>
          <option value="simulation">Simulation</option>
          <option value="verification">Verification</option>
        </select>
      </div>

      <div className="wb-topbar-block">
        <div className="wb-toggle-group" role="group" aria-label="Map mode">
          <button
            type="button"
            className={viewMode === "map" ? "wb-toggle-active" : ""}
            onClick={() => onSetViewMode("map")}
          >
            Map
          </button>
          <button
            type="button"
            className={viewMode === "globe" ? "wb-toggle-active" : ""}
            onClick={() => onSetViewMode("globe")}
            disabled={!globeSupported}
            title={!globeSupported ? "Globe mode requires MapLibre globe projection support." : undefined}
          >
            Globe
          </button>
        </div>
        {globeCapabilityChecked && !globeSupported ? (
          <span className="wb-topbar-label">Globe unavailable</span>
        ) : null}
      </div>

      <AnimationControls
        playback={playback}
        onTogglePlay={onTogglePlay}
        onSpeedChange={onSpeedChange}
        onReset={onResetAnimation}
      />

      <div className="wb-topbar-block">
        <span className="wb-topbar-label">Sources</span>
        <StatusBadge status={sourceHealthStatus} />
        <button type="button" onClick={onRefresh} disabled={isRefreshing}>
          {isRefreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </header>
  );
}
