import type { AnimationPlaybackState } from "../../layers/types";

interface BottomTimelineProps {
  playback: AnimationPlaybackState;
  onSetFrame: (frame: number) => void;
  onSetLoopWindow: (start: number, end: number) => void;
}

export function BottomTimeline({ playback, onSetFrame, onSetLoopWindow }: BottomTimelineProps) {
  const tickMarks = [0, 48, 96, 144, 192, 239];

  return (
    <footer className="wb-timeline">
      <div className="wb-row-between">
        <span>Frame {playback.frame + 1}/{playback.frameCount}</span>
        <span>{new Date(playback.selectedValidTime).toLocaleString()}</span>
      </div>

      <input
        type="range"
        min={0}
        max={playback.frameCount - 1}
        value={playback.frame}
        onChange={(event) => onSetFrame(Number(event.target.value))}
      />
      <div className="wb-timeline-ticks">
        {tickMarks.map((value) => (
          <span key={value}>T+{Math.round((value * 5) / 60)}h</span>
        ))}
      </div>

      <div className="wb-loop-controls">
        <label>
          Loop Start
          <input
            type="number"
            min={0}
            max={playback.loopEnd - 1}
            value={playback.loopStart}
            onChange={(event) => onSetLoopWindow(Number(event.target.value), playback.loopEnd)}
          />
        </label>
        <label>
          Loop End
          <input
            type="number"
            min={playback.loopStart + 1}
            max={playback.frameCount - 1}
            value={playback.loopEnd}
            onChange={(event) => onSetLoopWindow(playback.loopStart, Number(event.target.value))}
          />
        </label>
      </div>
    </footer>
  );
}
