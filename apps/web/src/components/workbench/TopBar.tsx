import { StatusBadge } from "./StatusBadge";
import { TimeZoneSelector } from "./TimeZoneSelector";

import type { AnimationPlaybackState, ViewMode } from "../../layers/types";
import type { PlanetaryTimelineState } from "../../types/planetary";
import type { SourceStatus } from "../../types/weather";
import { formatInZone } from "../../lib/timezone";

interface TopBarProps {
  timelineTime: string;
  viewMode: ViewMode;
  globeSupported: boolean;
  globeCapabilityChecked: boolean;
  onSetViewMode: (mode: ViewMode) => void;
  playback: AnimationPlaybackState;
  timelineState: PlanetaryTimelineState;
  onTogglePlay: () => void;
  onSpeedChange: (value: number) => void;
  onResetAnimation: () => void;
  onReturnLive: () => void;
  onSetForecastEnabled: (enabled: boolean) => void;
  sourceHealthStatus: SourceStatus;
  isRefreshing: boolean;
  onRefresh: () => void;
  isResettingExperience?: boolean;
  onFreshStart: () => void;
  onToggleLeftPanel: () => void;
  onToggleRightPanel: () => void;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  /** Operator-selected IANA time zone. Drives the VALID + NOW readouts. */
  timeZone: string;
  onSetTimeZone: (zone: string) => void;
  /** Open the City Picker quick-jump panel. */
  onOpenCityPicker: () => void;
  /** Toggle the Hourly Forecast floating panel. */
  onToggleHourlyForecast: () => void;
  hourlyForecastOpen: boolean;
  terminatorVisible: boolean;
  terminatorIntensity: number;
  onSetTerminatorVisible: (visible: boolean) => void;
  onSetTerminatorIntensity: (intensity: number) => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

function fmtTime(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "--:--:--";
  return formatInZone(ms, { timeZone, withSeconds: true });
}

export function TopBar({
  timelineTime,
  viewMode,
  globeSupported,
  onSetViewMode,
  playback,
  timelineState,
  onTogglePlay,
  onSpeedChange,
  onResetAnimation,
  onReturnLive,
  onSetForecastEnabled,
  sourceHealthStatus,
  isRefreshing,
  onRefresh,
  isResettingExperience,
  onFreshStart,
  onToggleLeftPanel,
  onToggleRightPanel,
  leftPanelOpen,
  rightPanelOpen,
  timeZone,
  onSetTimeZone,
  onOpenCityPicker,
  onToggleHourlyForecast,
  hourlyForecastOpen,
  terminatorVisible,
  terminatorIntensity,
  onSetTerminatorVisible,
  onSetTerminatorIntensity,
}: TopBarProps) {
  const nowStr = fmtTime(new Date().toISOString(), timeZone);
  const validStr = fmtTime(timelineTime, timeZone);
  const modeLabel = timelineState.mode.toUpperCase();

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
      </div>

      {/* Playback controls */}
      <div className="wb-topbar-group wb-topbar-group--playback">
        <button
          type="button"
          className="wb-icon-btn"
          onClick={onTogglePlay}
          title={playback.isPlaying ? "Pause" : "Play"}
        >
          {playback.isPlaying ? "⏸" : "▶"}
        </button>
        <select
          className="wb-speed-select"
          value={playback.speedMultiplier}
          onChange={(e) => onSpeedChange(Number(e.target.value))}
          title="Playback speed"
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
      <div className="wb-topbar-group wb-topbar-group--time">
        <span className="wb-topbar-label">NOW</span>
        <span className="wb-topbar-label wb-topbar-value">{nowStr}</span>
        <span className="wb-topbar-label" style={{ opacity: 0.3 }}>│</span>
        <span className="wb-topbar-label">VALID</span>
        <span className="wb-topbar-label wb-topbar-value wb-topbar-value--accent">{validStr}</span>
        <TimeZoneSelector value={timeZone} onChange={onSetTimeZone} refMs={Date.parse(timelineTime) || Date.now()} />
        <span className={`wb-mode-pill wb-mode-pill-${timelineState.mode}`}>{modeLabel}</span>
        <span className="wb-mode-pill wb-mode-pill-window">{playback.visibleDays}D</span>
        <button
          type="button"
          className={`wb-live-pill ${timelineState.isTrackingLive ? "is-live" : ""}`}
          onClick={onReturnLive}
          title="Return to current observed/live state"
        >
          <span className="wb-live-dot" aria-hidden="true" />
          LIVE
        </button>
        <label className={`wb-forecast-toggle ${timelineState.forecastEnabled ? "is-on" : ""}`} title="Unlock forecast horizon">
          <input
            type="checkbox"
            checked={timelineState.forecastEnabled}
            onChange={(event) => onSetForecastEnabled(event.target.checked)}
          />
          <span>FCST</span>
        </label>
        <button
          type="button"
          className="wb-panel-toggle"
          onClick={onOpenCityPicker}
          title="Open city quick-jump picker"
        >
          CITIES
        </button>
        <button
          type="button"
          className={`wb-panel-toggle ${hourlyForecastOpen ? "is-open" : ""}`}
          onClick={onToggleHourlyForecast}
          title="Toggle hourly forecast panel"
        >
          HOURLY
        </button>
      </div>

      {/* Map projection */}
      <div className="wb-topbar-group wb-topbar-group--projection">
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

      {/* Day/night overlay */}
      <div className="wb-topbar-group wb-terminator-controls wb-topbar-group--terminator">
        <label className="wb-topbar-check" title="Show day/night terminator overlay">
          <input
            type="checkbox"
            checked={terminatorVisible}
            onChange={(event) => onSetTerminatorVisible(event.target.checked)}
          />
          <span>NIGHT</span>
        </label>
        <span className="wb-topbar-label">DARK</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={terminatorIntensity}
          onChange={(event) => onSetTerminatorIntensity(Number(event.target.value))}
          disabled={!terminatorVisible}
          title="Terminator darkness"
          aria-label="Terminator darkness"
        />
        <output className="wb-topbar-label">{Math.round(terminatorIntensity * 100)}%</output>
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
