import { useMemo, useRef, useState } from "react";
import type { AnimationPlaybackState } from "../../layers/types";
import type { TimelineViewDays } from "../../time/timelineWindow";
import type { PlanetaryTimelineState } from "../../types/planetary";
import {
  FRAME_INTERVAL_MS,
  timelinePctFromFrame,
  TIMELINE_VIEW_DAY_OPTIONS,
} from "../../time/timelineWindow";
import { SOLAR_BAND_COLORS, solarBandForAltitudeDeg, solarElevationDeg } from "../../time/solarBands";

export { frameFromTimelinePct } from "../../time/timelineWindow";

export interface TimelineWarningRange {
  startFrame: number;
  endFrame: number;
  severity: "warning" | "error";
  label: string;
}

export interface TimelineBufferedRange {
  startMs: number;
  endMs: number;
}

/** Buffered satellite ranges → percentage bands on the timeline track. */
export function bufferedBandsForTesting(
  ranges: TimelineBufferedRange[],
  windowStartMs: number,
  frameCount: number,
): Array<{ leftPct: number; widthPct: number }> {
  const windowDurationMs = Math.max(1, (frameCount - 1) * FRAME_INTERVAL_MS);
  const bands: Array<{ leftPct: number; widthPct: number }> = [];
  for (const range of ranges) {
    const left = ((range.startMs - windowStartMs) / windowDurationMs) * 100;
    const right = ((range.endMs - windowStartMs) / windowDurationMs) * 100;
    const leftPct = Math.max(0, Math.min(100, left));
    const widthPct = Math.max(0, Math.min(100, right) - leftPct);
    if (widthPct <= 0 || !Number.isFinite(leftPct) || !Number.isFinite(widthPct)) continue;
    bands.push({ leftPct, widthPct });
  }
  return bands;
}

interface BottomTimelineProps {
  playback: AnimationPlaybackState;
  onSetFrame: (frame: number) => void;
  onSetLoopWindow: (start: number, end: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (delta: number) => void;
  onSetSpeed: (value: number) => void;
  onShiftWindowDays: (days: number) => void;
  onSetVisibleDays: (days: TimelineViewDays) => void;
  onReturnLive?: () => void;
  /** Operator-selected IANA time zone for the strip readouts. Defaults to UTC. */
  timeZone?: string;
  /** Open the GIF export panel. */
  onOpenGifExport?: () => void;
  /** Timeline spans where selected layer data is outside loadable coverage. */
  warningRanges?: TimelineWarningRange[];
  /** Buffered satellite time ranges (video-player style shading). */
  bufferedRanges?: TimelineBufferedRange[];
  timelineState: PlanetaryTimelineState;
  solarReference?: {
    latitude: number;
    longitude: number;
  };
}

/** Pin "A" or "B" comparison times on the timeline. Stored in localStorage so
 *  they survive reloads; consumers can read them from the same key. */
type AbKey = "A" | "B";
const AB_STORAGE_KEY = "canwxlab.timelineAb.v1";

function readAbState(): Record<AbKey, number | null> {
  if (typeof window === "undefined") return { A: null, B: null };
  try {
    const raw = window.localStorage.getItem(AB_STORAGE_KEY);
    if (!raw) return { A: null, B: null };
    const parsed = JSON.parse(raw) as Record<AbKey, number | null>;
    return { A: parsed.A ?? null, B: parsed.B ?? null };
  } catch {
    return { A: null, B: null };
  }
}

function writeAbState(state: Record<AbKey, number | null>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AB_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

type TickKind = "fine" | "minor" | "major";
interface Tick {
  pct: number;
  kind: TickKind;
  label?: string;
}

function pickSteps(totalMs: number): { fine: number; minor: number; major: number } {
  const H = 60 * 60 * 1000;
  const hours = totalMs / H;
  if (hours >= 48)  return { fine: 30 * 60 * 1000,  minor: 3 * H,        major: 12 * H };
  if (hours >= 12)  return { fine: 15 * 60 * 1000,  minor: 1 * H,        major: 6 * H };
  if (hours >= 4)   return { fine: 5 * 60 * 1000,   minor: 30 * 60 * 1000, major: 1 * H };
  return                 { fine: 5 * 60 * 1000,   minor: 15 * 60 * 1000, major: 30 * 60 * 1000 };
}

interface LocalClockParts {
  hour: number;
  minute: number;
  second: number;
}

const PARTS_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();
const OFFSET_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function partsFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = PARTS_FORMAT_CACHE.get(timeZone);
  if (fmt) return fmt;
  fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  PARTS_FORMAT_CACHE.set(timeZone, fmt);
  return fmt;
}

function offsetFormatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = OFFSET_FORMAT_CACHE.get(timeZone);
  if (fmt) return fmt;
  fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  });
  OFFSET_FORMAT_CACHE.set(timeZone, fmt);
  return fmt;
}

function localClockParts(ms: number, timeZone: string): LocalClockParts {
  try {
    const parts = partsFormatterFor(timeZone).formatToParts(new Date(ms));
    const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const hour = read("hour");
    return {
      hour: hour === 24 ? 0 : hour,
      minute: read("minute"),
      second: read("second"),
    };
  } catch {
    const d = new Date(ms);
    return {
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
    };
  }
}

function localClockHour(ms: number, timeZone: string): number {
  const parts = localClockParts(ms, timeZone);
  return parts.hour + parts.minute / 60 + parts.second / 3600;
}

function timeZoneOffsetMs(timeZone: string, ms: number): number {
  if (timeZone === "UTC") return 0;
  try {
    const parts = offsetFormatterFor(timeZone).formatToParts(new Date(ms));
    const value = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
    if (value === "GMT" || value === "UTC") return 0;
    const match = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? 0);
    return sign * (hours * HOUR_MS + minutes * MINUTE_MS);
  } catch {
    return 0;
  }
}

function zonedWallClockMs(ms: number, timeZone: string): number {
  return ms + timeZoneOffsetMs(timeZone, ms);
}

function zonedBoundaryToUtcMs(localBoundaryMs: number, timeZone: string): number {
  if (timeZone === "UTC") return localBoundaryMs;
  const firstOffset = timeZoneOffsetMs(timeZone, localBoundaryMs);
  const firstUtc = localBoundaryMs - firstOffset;
  const correctedOffset = timeZoneOffsetMs(timeZone, firstUtc);
  return localBoundaryMs - correctedOffset;
}

function formatMajorTickLabel(ms: number, timeZone: string): string {
  const parts = localClockParts(ms, timeZone);
  const hh = String(parts.hour).padStart(2, "0");
  const mm = String(parts.minute).padStart(2, "0");
  if (parts.hour === 0 && parts.minute === 0) {
    return new Date(ms).toLocaleDateString("en-CA", { month: "short", day: "2-digit", timeZone });
  }
  return timeZone === "UTC" ? `${hh}:${mm}Z` : `${hh}:${mm}`;
}

export function buildTicks(startMs: number, frameCount: number, timeZone = "UTC"): Tick[] {
  if (frameCount <= 1) return [];
  const totalMs = (frameCount - 1) * FRAME_INTERVAL_MS;
  const endMs = startMs + totalMs;
  const { fine, minor, major } = pickSteps(totalMs);
  const out: Tick[] = [];
  const localStart = zonedWallClockMs(startMs, timeZone);
  const firstLocalTick = Math.ceil(localStart / fine) * fine;
  const minorMinutes = Math.round(minor / MINUTE_MS);
  const majorMinutes = Math.round(major / MINUTE_MS);

  for (let local = firstLocalTick; ; local += fine) {
    const t = zonedBoundaryToUtcMs(local, timeZone);
    if (t > endMs + 1) break;
    if (t < startMs - 1) continue;

    const parts = localClockParts(t, timeZone);
    const minuteOfDay = parts.hour * 60 + parts.minute;
    const pct = ((t - startMs) / totalMs) * 100;
    if (minuteOfDay % majorMinutes === 0) {
      out.push({ pct, kind: "major", label: formatMajorTickLabel(t, timeZone) });
    } else if (minuteOfDay % minorMinutes === 0) {
      out.push({ pct, kind: "minor" });
    } else {
      out.push({ pct, kind: "fine" });
    }
  }
  return out.sort((a, b) => a.pct - b.pct);
}

export function timelineMaxFrame(playback: AnimationPlaybackState, timelineState: PlanetaryTimelineState): number {
  const endMs = timelineState.forecastEnabled ? timelineState.forecastEndMs : timelineState.liveTimeMs;
  const frame = Math.floor((endMs - timelineState.replayStartMs) / FRAME_INTERVAL_MS);
  return Math.max(0, Math.min(playback.frameCount - 1, frame));
}

export function clampTimelineInputFrame(
  frame: number,
  playback: AnimationPlaybackState,
  timelineState: PlanetaryTimelineState,
): number {
  if (!Number.isFinite(frame)) return playback.liveFrame;
  return Math.max(0, Math.min(timelineMaxFrame(playback, timelineState), frame));
}

// Blend two RGB colours by a factor k (0..1).
function lerpRgb(a: [number, number, number], b: [number, number, number], k: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * k);
  const g = Math.round(a[1] + (b[1] - a[1]) * k);
  const bl = Math.round(a[2] + (b[2] - a[2]) * k);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Key palette anchors (R, G, B) for each time-of-day phase.
// Phases are chosen so the gradient reads like a sky-colour strip: night → dawn → day → dusk → night.
const NIGHT_ANCHOR:   [number, number, number] = [18, 24, 56];   // visible navy
const TWILIGHT_ANCHOR: [number, number, number] = [130, 60, 140]; // vivid purple
const SUNRISE_ANCHOR: [number, number, number] = [245, 155, 65]; // bright amber
const MORNING_ANCHOR: [number, number, number] = [110, 170, 230]; // sky blue
const MIDDAY_ANCHOR:  [number, number, number] = [140, 200, 248]; // bright midday
const AFTERNOON_ANCHOR:[number, number, number]= [130, 180, 235]; // soft blue
const SUNSET_ANCHOR:  [number, number, number] = [240, 135, 55]; // vivid orange
const DUSK_ANCHOR:    [number, number, number] = [95, 38, 95];   // deep violet

function dayNightStops(
  startMs: number,
  frameCount: number,
  timeZone: string,
  solarReference?: { latitude: number; longitude: number },
): string {
  const totalMs = (frameCount - 1) * FRAME_INTERVAL_MS;
  const samples = 96;
  const stops: string[] = [];
  const hasSolarReference = (
    solarReference !== undefined &&
    Number.isFinite(solarReference.latitude) &&
    Number.isFinite(solarReference.longitude)
  );

  for (let i = 0; i <= samples; i += 1) {
    const t = startMs + (i / samples) * totalMs;
    if (hasSolarReference) {
      const elevation = solarElevationDeg(solarReference.latitude, solarReference.longitude, t);
      const band = solarBandForAltitudeDeg(elevation);
      stops.push(`${SOLAR_BAND_COLORS[band]} ${((i / samples) * 100).toFixed(2)}%`);
      continue;
    }

    const hour = localClockHour(t, timeZone);
    let color: string;

    if (hour < 4.5) {
      // Late night — steady deep navy
      color = lerpRgb(NIGHT_ANCHOR, NIGHT_ANCHOR, 0);
    } else if (hour < 5.5) {
      // Astronomical twilight — navy → purple
      color = lerpRgb(NIGHT_ANCHOR, TWILIGHT_ANCHOR, (hour - 4.5));
    } else if (hour < 6.5) {
      // Nautical twilight — purple → amber
      color = lerpRgb(TWILIGHT_ANCHOR, SUNRISE_ANCHOR, (hour - 5.5));
    } else if (hour < 8) {
      // Sunrise — amber glow
      color = lerpRgb(SUNRISE_ANCHOR, MORNING_ANCHOR, (hour - 6.5) / 1.5);
    } else if (hour < 11) {
      // Morning — steel blue → bright sky
      color = lerpRgb(MORNING_ANCHOR, MIDDAY_ANCHOR, (hour - 8) / 3);
    } else if (hour < 15) {
      // Midday peak — bright sky (subtle warm shift at solar noon)
      const noonBoost = Math.sin(((hour - 11) / 4) * Math.PI); // 0→1→0
      const peak: [number, number, number] = [
        MIDDAY_ANCHOR[0] + 15 * noonBoost,
        MIDDAY_ANCHOR[1] + 10 * noonBoost,
        MIDDAY_ANCHOR[2] - 15 * noonBoost,
      ];
      color = lerpRgb(MIDDAY_ANCHOR, peak, noonBoost * 0.5);
    } else if (hour < 17) {
      // Afternoon — sky → softer blue
      color = lerpRgb(MIDDAY_ANCHOR, AFTERNOON_ANCHOR, (hour - 15) / 2);
    } else if (hour < 18.5) {
      // Late afternoon → golden hour
      color = lerpRgb(AFTERNOON_ANCHOR, SUNSET_ANCHOR, (hour - 17) / 1.5);
    } else if (hour < 19.5) {
      // Sunset — burnt orange peak
      color = lerpRgb(SUNSET_ANCHOR, DUSK_ANCHOR, (hour - 18.5));
    } else if (hour < 21) {
      // Dusk — violet → navy
      color = lerpRgb(DUSK_ANCHOR, NIGHT_ANCHOR, (hour - 19.5) / 1.5);
    } else {
      // Early night — back to deep navy
      color = lerpRgb(NIGHT_ANCHOR, NIGHT_ANCHOR, 0);
    }

    stops.push(`${color} ${((i / samples) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function BottomTimeline({
  playback,
  onSetFrame,
  onTogglePlay,
  onStepFrame,
  onSetSpeed,
  onShiftWindowDays,
  onSetVisibleDays,
  onReturnLive,
  timeZone = "UTC",
  onOpenGifExport,
  warningRanges = [],
  bufferedRanges = [],
  timelineState,
  solarReference,
}: BottomTimelineProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [abState, setAbState] = useState<Record<AbKey, number | null>>(readAbState);

  const setAbAtCurrent = (key: AbKey) => {
    setAbState((prev) => {
      const next = { ...prev, [key]: playback.frame };
      writeAbState(next);
      return next;
    });
  };
  const clearAb = (key: AbKey) => {
    setAbState((prev) => {
      const next = { ...prev, [key]: null };
      writeAbState(next);
      return next;
    });
  };
  const jumpAb = (key: AbKey) => {
    const v = abState[key];
    if (v !== null && v !== undefined) onSetFrame(v);
  };

  const startMs = timelineState.replayStartMs;
  const timelineTimeZone = safeTimeZone(timeZone);

  const ticks = useMemo(
    () => buildTicks(startMs, playback.frameCount, timelineTimeZone),
    [startMs, playback.frameCount, timelineTimeZone],
  );

  const gradient = useMemo(
    () => dayNightStops(startMs, playback.frameCount, timelineTimeZone, solarReference),
    [startMs, playback.frameCount, timelineTimeZone, solarReference],
  );

  const displayMaxFrame = Math.max(1, playback.frameCount - 1);
  const boundedPlayheadFrame = Math.max(0, Math.min(displayMaxFrame, playback.playheadFrame));
  const boundedLiveFrame = Math.max(0, Math.min(displayMaxFrame, playback.liveFrame));
  const liveInWindow = playback.liveFrame >= 0 && playback.liveFrame <= displayMaxFrame;
  const progressPct = timelinePctFromFrame(boundedPlayheadFrame, playback.frameCount);
  const livePct = timelinePctFromFrame(boundedLiveFrame, playback.frameCount);
  const forecastStartPct = playback.liveFrame <= 0 ? 0 : playback.liveFrame >= displayMaxFrame ? 100 : livePct;
  const maxFrame = timelineMaxFrame(playback, timelineState);
  const maxPct = timelinePctFromFrame(maxFrame, playback.frameCount);
  const loopStartPct = timelinePctFromFrame(playback.loopStart, playback.frameCount);
  const loopEndPct = timelinePctFromFrame(playback.loopEnd, playback.frameCount);
  const displayMs = startMs + playback.playheadFrame * FRAME_INTERVAL_MS;
  const validLabel = new Date(displayMs).toLocaleString("en-CA", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timelineTimeZone,
  });

  const hoverMs = hoverPct !== null
    ? startMs + (hoverPct / 100) * (playback.frameCount - 1) * FRAME_INTERVAL_MS
    : null;
  const hoverLabel = hoverMs !== null
    ? new Date(hoverMs).toLocaleString("en-CA", {
        month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timelineTimeZone,
      }) + (timelineTimeZone === "UTC" ? "Z" : "")
    : null;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = (trackRef.current ?? stripRef.current)?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setHoverPct(Math.max(0, Math.min(100, pct)));
  };

  return (
    <footer className="wb-timeline" aria-label="Timeline scrubber">
      <div className="wb-timeline-top">
        <div className="wb-timeline-controls">
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => onShiftWindowDays(-1)}
          title="Move timeline window back one day"
          aria-label="Previous day"
        >
          -1d
        </button>
        <span className="wb-tl-window-group" role="group" aria-label="Timeline visible span">
          <span className="wb-tl-window-label">View</span>
          {TIMELINE_VIEW_DAY_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className={`wb-tl-btn wb-tl-window-btn${playback.visibleDays === days ? " is-active" : ""}`}
              onClick={() => onSetVisibleDays(days)}
              aria-pressed={playback.visibleDays === days}
              title={`Show ${days} day${days === 1 ? "" : "s"} on the timeline`}
            >
              {days}d
            </button>
          ))}
        </span>
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => onSetFrame(0)}
          title="Jump to first frame (Home)"
          aria-label="First frame"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M4.25 3.25v9.5M13 3 7 8l6 5V3Z" fill="currentColor" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => onStepFrame(-1)}
          title="Previous frame (←)"
          aria-label="Previous frame"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M11 3 5 8l6 5V3Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className={`wb-tl-btn wb-tl-play${playback.isPlaying ? " is-playing" : ""}${playback.isBuffering ? " is-buffering" : ""}`}
          onClick={onTogglePlay}
          title={playback.isBuffering ? "Buffering satellite imagery…" : playback.isPlaying ? "Pause (Space)" : "Play (Space)"}
          aria-label={playback.isPlaying ? "Pause" : "Play"}
        >
          {playback.isPlaying ? (
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <rect x="4" y="3" width="3" height="10" fill="currentColor" />
              <rect x="9" y="3" width="3" height="10" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path d="M5 3v10l8-5L5 3Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => onStepFrame(1)}
          title="Next frame (→)"
          aria-label="Next frame"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M5 3v10l6-5-6-5Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => {
            if (liveInWindow) {
              onSetFrame(playback.liveFrame);
            } else {
              onReturnLive?.();
            }
          }}
          title={liveInWindow ? "Jump to live frame (End)" : "Return timeline window to live"}
          aria-label="Live frame"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M11.75 3.25v9.5M3 3l6 5-6 5V3Z" fill="currentColor" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className="wb-tl-btn wb-tl-step"
          onClick={() => onShiftWindowDays(1)}
          title="Move timeline window forward one day"
          aria-label="Next day"
        >
          +1d
        </button>
        <select
          className="wb-tl-speed"
          value={playback.speedMultiplier}
          onChange={(e) => onSetSpeed(Number(e.target.value))}
          title="Playback speed ([ slower, ] faster)"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}x</option>
          ))}
        </select>

        <span className="wb-tl-ab-group" role="group" aria-label="A/B comparison handles">
          {(["A", "B"] as AbKey[]).map((k) => {
            const v = abState[k];
            const isSet = v !== null && v !== undefined;
            return (
              <span key={k} className="wb-tl-ab-cluster">
                <button
                  type="button"
                  className={`wb-tl-btn wb-tl-ab${isSet ? " is-set" : ""}`}
                  onClick={() => (isSet ? jumpAb(k) : setAbAtCurrent(k))}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isSet) clearAb(k);
                  }}
                  title={
                    isSet
                      ? `Jump to ${k} (frame ${(v ?? 0) + 1}). Right-click clears.`
                      : `Pin ${k} at current frame`
                  }
                >
                  {k}
                  {isSet ? `·${(v ?? 0) + 1}` : ""}
                </button>
              </span>
            );
          })}
        </span>
      </div>

      <div className="wb-tl-readout">
        <span className="wb-tl-time">{validLabel}</span>
        <span className="wb-tl-frame">
          F <span className="wb-tl-frame-num">{String(playback.frame + 1).padStart(3, "0")}</span>
          <span className="wb-tl-frame-sep">/</span>
          {String(playback.frameCount).padStart(3, "0")}
        </span>
        <span className="wb-tl-window-readout">
          {playback.visibleDays}d window
        </span>
      </div>
      </div>

      <div
        ref={stripRef}
        className="wb-tl-strip"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => { setHoverPct(null); setIsScrubbing(false); }}
        onContextMenu={(e) => {
          if (onOpenGifExport) {
            e.preventDefault();
            onOpenGifExport();
          }
        }}
      >
        <div className="wb-tl-daynight" style={{ background: gradient }} aria-hidden="true" />
        <div className="wb-tl-ticks" aria-hidden="true">
          {ticks.map((tick, i) => (
            <div
              key={i}
              className={`wb-tl-tick wb-tl-tick-${tick.kind}`}
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label && <span className="wb-tl-tick-label">{tick.label}</span>}
            </div>
          ))}
        </div>

        <div ref={trackRef} className={`wb-tl-track${isScrubbing ? " is-scrubbing" : ""}`}>
          {bufferedBandsForTesting(bufferedRanges, startMs, playback.frameCount).map((band, i) => (
            <div
              key={`buffered-${i}-${band.leftPct}`}
              data-testid="timeline-buffered-band"
              className="wb-tl-buffered-band"
              style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%` }}
              aria-hidden="true"
            />
          ))}
          {warningRanges.map((range, i) => {
            const maxFrame = Math.max(1, playback.frameCount - 1);
            const startFrame = Math.max(0, Math.min(maxFrame, range.startFrame));
            const endFrame = Math.max(startFrame, Math.min(maxFrame, range.endFrame));
            const left = (startFrame / maxFrame) * 100;
            const width = ((endFrame - startFrame) / maxFrame) * 100;
            if (width <= 0) return null;
            return (
              <div
                key={`${range.label}-${i}-${startFrame}-${endFrame}`}
                className={`wb-tl-warning-range wb-tl-warning-range-${range.severity}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={range.label}
                aria-hidden="true"
              />
            );
          })}
          <div
            className="wb-tl-loop"
            style={{ left: `${loopStartPct}%`, width: `${Math.max(0, loopEndPct - loopStartPct)}%` }}
            aria-hidden="true"
          />
          <div className="wb-tl-progress" style={{ width: `${progressPct}%` }} aria-hidden="true" />
          <div
            className={timelineState.forecastEnabled ? "wb-tl-forecast-open" : "wb-tl-forecast-locked"}
            style={{ left: `${forecastStartPct}%`, width: `${Math.max(0, 100 - forecastStartPct)}%` }}
            title={timelineState.forecastEnabled ? "Forecast horizon unlocked" : "Forecast horizon locked"}
            aria-hidden="true"
          />
          <div
            className="wb-tl-live-marker"
            style={{ left: `${livePct}%` }}
            title="Live now"
            aria-hidden="true"
          />
          <div
            className="wb-tl-max-marker"
            style={{ left: `${maxPct}%` }}
            title={timelineState.forecastEnabled ? "Forecast horizon" : "Forecast locked at live time"}
            aria-hidden="true"
          />

          {hoverPct !== null && (
            <>
              <div className="wb-tl-hover-line" style={{ left: `${hoverPct}%` }} aria-hidden="true" />
              <div className="wb-tl-hover-dot" style={{ left: `${hoverPct}%` }} aria-hidden="true" />
              {hoverLabel && (
                <div
                  className="wb-tl-hover-tip"
                  style={{ left: `${hoverPct}%` }}
                  aria-hidden="true"
                >
                  {hoverLabel}
                </div>
              )}
            </>
          )}

          {(["A", "B"] as AbKey[]).map((k) => {
            const frame = abState[k];
            if (frame === null || frame === undefined) return null;
            const pct = timelinePctFromFrame(frame, playback.frameCount);
            return (
              <div
                key={k}
                className="wb-tl-ab-marker"
                data-handle={k}
                style={{ left: `${pct}%` }}
                title={`${k} pinned at frame ${frame + 1}`}
                aria-hidden="true"
              >
                <span className="wb-tl-ab-marker-label">{k}</span>
              </div>
            );
          })}

          <div className="wb-tl-cursor" style={{ left: `${progressPct}%` }} aria-hidden="true">
            <div className="wb-tl-cursor-handle" />
          </div>

          <input
            type="range"
            className="wb-tl-slider"
            step="any"
            min={0}
            max={displayMaxFrame}
            value={boundedPlayheadFrame}
            onPointerDown={() => setIsScrubbing(true)}
            onPointerUp={() => setIsScrubbing(false)}
            onInput={(event) => onSetFrame(clampTimelineInputFrame(Number(event.currentTarget.value), playback, timelineState))}
            onChange={(event) => onSetFrame(clampTimelineInputFrame(Number(event.target.value), playback, timelineState))}
            aria-label={`Frame ${playback.frame + 1} of ${playback.frameCount}`}
            title={`${validLabel}  ·  frame ${playback.frame + 1}/${playback.frameCount}`}
          />
        </div>
      </div>
    </footer>
  );
}
