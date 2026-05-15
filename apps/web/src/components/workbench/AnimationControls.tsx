import type { AnimationPlaybackState } from "../../layers/types";

interface AnimationControlsProps {
  playback: AnimationPlaybackState;
  onTogglePlay: () => void;
  onSpeedChange: (value: number) => void;
  onReset: () => void;
}

export function AnimationControls({
  playback,
  onTogglePlay,
  onSpeedChange,
  onReset,
}: AnimationControlsProps) {
  return (
    <div className="wb-animation-controls">
      <button type="button" onClick={onTogglePlay}>
        {playback.isPlaying ? "Pause" : "Play"}
      </button>
      <label>
        Speed
        <select
          value={playback.speedMultiplier}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        >
          {[0.5, 1, 1.5, 2, 3].map((value) => (
            <option key={value} value={value}>
              {value}x
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onReset}>Reset</button>
    </div>
  );
}
