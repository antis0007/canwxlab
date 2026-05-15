import { useMemo } from "react";
import type { AnimationPlaybackState } from "../../layers/types";

interface BottomTimelineProps {
  playback: AnimationPlaybackState;
  onSetFrame: (frame: number) => void;
  onSetLoopWindow: (start: number, end: number) => void;
  onTogglePlay: () => void;
  onStepFrame: (delta: number) => void;
  onSetSpeed: (value: number) => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

function dayNightGradient(startMs: number, frameCount: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = startMs + (i / 24) * (frameCount - 1) * 5 * 60 * 1000;
    const d = new Date(t);
    const hour = d.getHours() + d.getMinutes() / 60;
    let color: string;
    if (hour < 5) color = "#0a1228";
    else if (hour < 7) color = "#3a3260";
    else if (hour < 9) color = "#f08648";
    else if (hour < 17) color = "#4eb6ff";
    else if (hour < 19) color = "#d96030";
    else if (hour < 21) color = "#3a3260";
    else color = "#0a1228";
    stops.push(`${color} ${(i / 24) * 100}%`);
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
  const startMs = useMemo(() => {
    const d = new Date(playback.selectedValidTime);
    d.setUTCMinutes(d.getUTCMinutes() - playback.frame * 5);
    return d.getTime();
  }, [playback.selectedValidTime, playback.frame]);

  const gradient = useMemo(
    () => dayNightGradient(startMs, playback.frameCount),
    [startMs, playback.frameCount],
  );

  const progressPct = (playback.frame / Math.max(1, playback.frameCount - 1)) * 100;
  const loopStartPct = (playback.loopStart / Math.max(1, playback.frameCount - 1)) * 100;
  const loopEndPct = (playback.loopEnd / Math.max(1, playback.frameCount - 1)) * 100;
  const validLabel = new Date(playback.selectedValidTime).toLocaleString("en-CA", {
    month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });

  return (
    <footer className="wb-timeline" aria-label="Timeline scrubber">
      <div className="wb-timeline-controls">
        <button
          type="button"
          className="wb-timeline-play"
          onClick={onTogglePlay}
          title={playback.isPlaying ? "Pause (Space)" : "Play (Space)"}
          aria-label={playback.isPlaying ? "Pause" : "Play"}
        >
          {playback.isPlaying ? "⏸" : "▶"}
        </button>
        <button
          type="button"
          className="wb-timeline-step"
          onClick={() => onStepFrame(-1)}
          title="Previous frame (←)"
          aria-label="Previous frame"
        >
          ⏮
        </button>
        <button
          type="button"
          className="wb-timeline-step"
          onClick={() => onStepFrame(1)}
          title="Next frame (→)"
          aria-label="Next frame"
        >
          ⏭
        </button>
        <select
          className="wb-timeline-speed"
          value={playback.speedMultiplier}
          onChange={(e) => onSetSpeed(Number(e.target.value))}
          title="Playback speed ([ slower, ] faster)"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </div>

      <div className="wb-timeline-strip">
        <div className="wb-timeline-daynight" style={{ background: gradient }} aria-hidden="true">
          <div className="wb-timeline-daynight-marker" style={{ left: `${progressPct}%` }} />
        </div>
        <div className="wb-timeline-track">
          <div
            className="wb-timeline-loop-window"
            style={{ left: `${loopStartPct}%`, width: `${Math.max(0, loopEndPct - loopStartPct)}%` }}
          />
          <div className="wb-timeline-progress" style={{ width: `${progressPct}%` }} />
          <input
            type="range"
            className="wb-timeline-slider"
            min={0}
            max={playback.frameCount - 1}
            value={playback.frame}
            onChange={(event) => onSetFrame(Number(event.target.value))}
            aria-label={`Frame ${playback.frame + 1} of ${playback.frameCount}`}
            title={`${validLabel}  ·  frame ${playback.frame + 1}/${playback.frameCount}`}
          />
        </div>
      </div>

      <div className="wb-timeline-readout">
        <span className="wb-timeline-time">{validLabel}</span>
        <span className="wb-muted wb-num">{playback.frame + 1}/{playback.frameCount}</span>
      </div>
    </footer>
  );
}
