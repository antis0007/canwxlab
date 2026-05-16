import { useMemo, useRef, useState } from "react";
import type { AnimationPlaybackState } from "../../layers/types";

interface BottomTimelineProps {
  playback: AnimationPlaybackState;
  onSetFrame: (frame: number) => void;
  onSetLoopWindow: (start: number, end: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (delta: number) => void;
  onSetSpeed: (value: number) => void;
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
const FRAME_INTERVAL_MS = 5 * 60 * 1000;

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

function buildTicks(startMs: number, frameCount: number): Tick[] {
  if (frameCount <= 1) return [];
  const totalMs = (frameCount - 1) * FRAME_INTERVAL_MS;
  const endMs = startMs + totalMs;
  const { fine, minor, major } = pickSteps(totalMs);
  const out: Tick[] = [];

  for (let t = Math.ceil(startMs / fine) * fine; t <= endMs; t += fine) {
    if (t % minor === 0) continue;
    out.push({ pct: ((t - startMs) / totalMs) * 100, kind: "fine" });
  }
  for (let t = Math.ceil(startMs / minor) * minor; t <= endMs; t += minor) {
    if (t % major === 0) continue;
    out.push({ pct: ((t - startMs) / totalMs) * 100, kind: "minor" });
  }
  for (let t = Math.ceil(startMs / major) * major; t <= endMs; t += major) {
    const d = new Date(t);
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mm = String(d.getUTCMinutes()).padStart(2, "0");
    const day = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
      ? d.toLocaleDateString("en-CA", { month: "short", day: "2-digit", timeZone: "UTC" })
      : `${hh}:${mm}Z`;
    out.push({ pct: ((t - startMs) / totalMs) * 100, kind: "major", label: day });
  }
  return out;
}

// Smooth daylight curve: 0 = deep night, 1 = noon. Cosine-based, no banding.
function daylight(hour: number): number {
  // hour: 0..24, peak at 13 (slightly offset to feel right)
  const x = ((hour - 13) / 24) * Math.PI * 2;
  return Math.max(0, 0.5 + 0.5 * Math.cos(x));
}

function dayNightStops(startMs: number, frameCount: number): string {
  const totalMs = (frameCount - 1) * FRAME_INTERVAL_MS;
  const samples = 48;
  const stops: string[] = [];
  // Palette: deep midnight indigo -> twilight magenta -> dawn amber -> day blue -> sunset orange -> dusk -> night
  for (let i = 0; i <= samples; i += 1) {
    const t = startMs + (i / samples) * totalMs;
    const d = new Date(t);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const lum = daylight(hour);
    let r: number, g: number, b: number;
    if (hour < 5 || hour >= 21) {
      // Deep night — desaturated indigo
      r = 14;  g = 18;  b = 38;
    } else if (hour < 7) {
      // Astronomical -> civil twilight: indigo to magenta
      const k = (hour - 5) / 2;
      r = 14 + k * (124 - 14);
      g = 18 + k * (64 - 18);
      b = 38 + k * (110 - 38);
    } else if (hour < 9) {
      // Sunrise: magenta -> amber -> pale blue
      const k = (hour - 7) / 2;
      r = 124 + k * (255 - 124);
      g = 64  + k * (170 - 64);
      b = 110 + k * (110 - 110);
    } else if (hour < 17) {
      // Daylight: midday saturated blue
      const k = Math.min(1, Math.max(0, (hour - 9) / 4));
      const dayR = 110 + (lum * 30);
      const dayG = 180 + (lum * 20);
      const dayB = 240;
      r = 255 - k * (255 - dayR);
      g = 170 + k * (dayG - 170);
      b = 110 + k * (dayB - 110);
    } else if (hour < 19) {
      // Sunset: blue -> deep orange
      const k = (hour - 17) / 2;
      r = 140 + k * (240 - 140);
      g = 200 - k * (200 - 110);
      b = 240 - k * (240 - 70);
    } else {
      // Dusk: orange -> deep indigo
      const k = (hour - 19) / 2;
      r = 240 - k * (240 - 14);
      g = 110 - k * (110 - 18);
      b = 70  + k * (38 - 70);
    }
    stops.push(`rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}) ${((i / samples) * 100).toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function BottomTimeline({
  playback,
  onSetFrame,
  onTogglePlay,
  onStepFrame,
  onSetSpeed,
}: BottomTimelineProps) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
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

  const startMs = useMemo(() => {
    const d = new Date(playback.selectedValidTime);
    d.setUTCMinutes(d.getUTCMinutes() - playback.frame * 5);
    return d.getTime();
  }, [playback.selectedValidTime, playback.frame]);

  const ticks = useMemo(
    () => buildTicks(startMs, playback.frameCount),
    [startMs, playback.frameCount],
  );

  const gradient = useMemo(
    () => dayNightStops(startMs, playback.frameCount),
    [startMs, playback.frameCount],
  );

  const progressPct = (playback.frame / Math.max(1, playback.frameCount - 1)) * 100;
  const loopStartPct = (playback.loopStart / Math.max(1, playback.frameCount - 1)) * 100;
  const loopEndPct = (playback.loopEnd / Math.max(1, playback.frameCount - 1)) * 100;
  const validLabel = new Date(playback.selectedValidTime).toLocaleString("en-CA", {
    year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
  });

  const hoverMs = hoverPct !== null
    ? startMs + (hoverPct / 100) * (playback.frameCount - 1) * FRAME_INTERVAL_MS
    : null;
  const hoverLabel = hoverMs !== null
    ? new Date(hoverMs).toLocaleString("en-CA", {
        month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC",
      }) + "Z"
    : null;

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stripRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setHoverPct(Math.max(0, Math.min(100, pct)));
  };

  return (
    <footer className="wb-timeline" aria-label="Timeline scrubber">
      <div className="wb-timeline-controls">
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
          className={`wb-tl-btn wb-tl-play${playback.isPlaying ? " is-playing" : ""}`}
          onClick={onTogglePlay}
          title={playback.isPlaying ? "Pause (Space)" : "Play (Space)"}
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
          onClick={() => onSetFrame(playback.frameCount - 1)}
          title="Jump to latest (End)"
          aria-label="Latest frame"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M11.75 3.25v9.5M3 3l6 5-6 5V3Z" fill="currentColor" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
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

      <div
        ref={stripRef}
        className="wb-tl-strip"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverPct(null)}
      >
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

        <div className="wb-tl-track">
          <div
            className="wb-tl-loop"
            style={{ left: `${loopStartPct}%`, width: `${Math.max(0, loopEndPct - loopStartPct)}%` }}
            aria-hidden="true"
          />
          <div className="wb-tl-progress" style={{ width: `${progressPct}%` }} aria-hidden="true" />

          {/* Thin day/night band — smaller than the main track */}
          <div className="wb-tl-daynight" style={{ background: gradient }} aria-hidden="true" />

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
            const pct = (frame / Math.max(1, playback.frameCount - 1)) * 100;
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
            min={0}
            max={playback.frameCount - 1}
            value={playback.frame}
            onChange={(event) => onSetFrame(Number(event.target.value))}
            aria-label={`Frame ${playback.frame + 1} of ${playback.frameCount}`}
            title={`${validLabel}  ·  frame ${playback.frame + 1}/${playback.frameCount}`}
          />
        </div>
      </div>

      <div className="wb-tl-readout">
        <span className="wb-tl-time">{validLabel}</span>
        <span className="wb-tl-frame">
          F <span className="wb-tl-frame-num">{String(playback.frame + 1).padStart(3, "0")}</span>
          <span className="wb-tl-frame-sep">/</span>
          {String(playback.frameCount).padStart(3, "0")}
        </span>
      </div>
    </footer>
  );
}
