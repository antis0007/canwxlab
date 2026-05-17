import { StatusBadge } from "./StatusBadge";
import { TimeZoneSelector } from "./TimeZoneSelector";

import type { AnimationPlaybackState, ViewMode } from "../../layers/types";
import type { SourceStatus } from "../../types/weather";
import { formatInZone } from "../../lib/timezone";

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
  isResettingExperience?: boolean;
  onFreshStart: () => void;
  timelineMode: string;
  onSetTimelineMode: (mode: string) => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  /** Operator-selected IANA time zone. Drives the VALID + NOW readouts. */
  timeZone: string;
  onSetTimeZone: (zone: string) => void;
  /** Open the City Picker quick-jump panel. */
  onOpenCityPicker: () => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

const TIMELINE_MODES = [
  { value: "live",         label: "LIVE" },
  { value: "history",      label: "HIST" },
  { value: "forecast",     label: "FCST" },
  { value: "simulation",   label: "SIM" },
  { value: "verification", label: "VRFY" },
];

function fmtTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "--:--:--";
  return formatInZone(ms, { timeZone, withSeconds: true });
}

export function TopBar({
  dataMode,
  timelineTime,
  viewMode,
  globeSupported,
  onSetViewMode,
  playback,
  onTogglePlay,
  onSpeedChange,
  onResetAnimation,
  sourceHealthStatus,
  isRefreshing,
  onRefresh,
  isResettingExperience,
  onFreshStart,
  timelineMode,
  onSetTimelineMode,
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelOpen,
  rightPanelOpen,
  timeZone,
  onSetTimeZone,
  onOpenCityPicker,
}: TopBarProps) {
  const nowStr = fmtTime(new Date().toISOString(), timeZone);
  const validStr = fmtTime(timelineTime, timeZone);
  const dataBadgeStatus = dataMode === "live" ? "live" : dataMode === "hybrid" ? "fallback" : "mock";

  return (
    <header className="wb-topbar">
      {/* Identity + left panel toggle */}
      <div className="wb-topbar-group">
        <button
          type="button"
          className={`wb-panel-toggle ${leftPanelOpen ? "is-open" : ""}`}
          onClick={onToggleLeftPanel}
          title={leftPanelOpen ? "Hide layers panel" : "Show layers panel"}
        >
          ☰ LAYERS
        </button>
        <span className="wb-title">CanWxLab</span>
        <StatusBadge status={dataBadgeStatus} label={dataMode.toUpperCase()} />
      </div>

      {/* Playback controls */}
      <div className="wb-topbar-group">
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onTogglePlay}
          title={playback.isPlaying ? "Pause" : "Play"}
        >
          {playback.isPlaying ? "⏸" : "▶"}
        </button>
        <select
          value={playback.speedMultiplier}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          title="Playback speed"
          style={{ width: 46 }}
        >
          {SPEED_OPTIONS.map((v) => (
            <option key={v} value={v}>{v}×</option>
          ))}
        </select>
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onResetAnimation}
          title="Reset to frame 0"
        >
          ↺
        </button>
      </div>

      {/* Time display + mode */}
      <div className="wb-topbar-group">
        <span className="wb-topbar-label">NOW</span>
        <span className="wb-topbar-label" style={{ color: "var(--wb-text)" }}>{nowStr}</span>
        <span className="wb-topbar-label" style={{ opacity: 0.3 }}>│</span>
        <span className="wb-topbar-label">VALID</span>
        <span className="wb-topbar-label" style={{ color: "var(--wb-accent)" }}>{validStr}</span>
        <TimeZoneSelector value={timeZone} onChange={onSetTimeZone} refMs={Date.parse(timelineTime) || Date.now()} />
        <select
          value={timelineMode}
          onChange={(e) => onSetTimelineMode(e.target.value)}
          style={{ marginLeft: 4 }}
          title="Timeline mode"
        >
          {TIMELINE_MODES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button
          type="button"
          className="wb-panel-toggle"
          onClick={onOpenCityPicker}
          title="Open city quick-jump picker"
        >
          CITIES
        </button>
      </div>

      {/* Map projection */}
      <div className="wb-topbar-group">
        <div className="wb-toggle-group" role="group" aria-label="Map projection">
          <button
            type="button"
            className={viewMode === "map" ? "wb-toggle-active" : ""}
            onClick={() => onSetViewMode("map")}
          >
            MAP
          </button>
          <button
            type="button"
            className={viewMode === "globe" ? "wb-toggle-active" : ""}
            onClick={() => onSetViewMode("globe")}
            disabled={!globeSupported}
            title={!globeSupported ? "Globe projection not supported" : "Switch to globe view"}
          >
            GLOBE
          </button>
        </div>
      </div>

      {/* Sources + inspector */}
      <div className="wb-topbar-group wb-topbar-group--right">
        <span className="wb-topbar-label">SRC</span>
        <StatusBadge status={sourceHealthStatus} />
        <button
          type="button"
          className="wb-danger-mini"
          onClick={onFreshStart}
          disabled={isResettingExperience}
          title="Clear local settings, browser caches, and API cache"
        >
          {isResettingExperience ? "CLR" : "RESET"}
        </button>
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onRefresh}
          disabled={isRefreshing}
          title={isRefreshing ? "Refreshing…" : "Refresh data sources"}
        >
          {isRefreshing ? "…" : "↺"}
        </button>
        <button
          type="button"
          className={`wb-panel-toggle ${rightPanelOpen ? "is-open" : ""}`}
          onClick={onToggleRightPanel}
          title={rightPanelOpen ? "Hide inspector" : "Show inspector"}
        >
          INSP ⊞
        </button>
      </div>
    </header>
  );
}
