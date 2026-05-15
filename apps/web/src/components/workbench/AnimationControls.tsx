import type { AnimationPlaybackState } from "../../layers/types";

interface AnimationControlsProps {
  playback: AnimationPlaybackState;
  onTogglePlay: () => void;
  onSpeedChange: (value: number) => void;
  onReset: () => void;
}

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];

export function AnimationControls({ playback, onTogglePlay, onSpeedChange, onReset }: AnimationControlsProps) {
  return (
    <div className="wb-animation-controls">
      <button type="button" className="wb-icon-btn" onClick={onTogglePlay} title={playback.isPlaying ? "Pause" : "Play"}>
        {playback.isPlaying ? "⏸" : "▶"}
      </button>
      <select
        value={playback.speedMultiplier}
        onChange={(e) => onSpeedChange(Number(e.target.value))}
        title="Playback speed"
        style={{ width: 44 }}
      >
        {SPEED_OPTIONS.map((v) => (
          <option key={v} value={v}>{v}×</option>
        ))}
      </select>
      <button type="button" className="wb-icon-btn" onClick={onReset} title="Reset animation">
        ↺
      </button>
    </div>
  );
}
