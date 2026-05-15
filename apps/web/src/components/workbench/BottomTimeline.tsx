import { useState } from "react";
import type { AnimationPlaybackState } from "../../layers/types";

interface BottomTimelineProps {
  playback: AnimationPlaybackState;
  onSetFrame: (frame: number) => void;
  onSetLoopWindow: (start: number, end: number) => void;
}

export function BottomTimeline({ playback, onSetFrame, onSetLoopWindow }: BottomTimelineProps) {
  const [expanded, setExpanded] = useState(false);
  const tickMarks = [0, 48, 96, 144, 192, 239];

  return (
    <footer 
      className={`wb-timeline ${expanded ? 'wb-timeline-expanded' : 'wb-timeline-collapsed'}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      <div className="wb-timeline-slider-container">
        <input
          type="range"
          className="wb-timeline-slider"
          min={0}
          max={playback.frameCount - 1}
          value={playback.frame}
          onChange={(event) => onSetFrame(Number(event.target.value))}
          title={`Frame ${playback.frame + 1} - ${new Date(playback.selectedValidTime).toLocaleString()}`}
        />
        <div className="wb-timeline-progress" style={{ width: `${(playback.frame / (playback.frameCount - 1)) * 100}%` }} />
      </div>

      {expanded && (
        <div className="wb-timeline-details">
          <div className="wb-row-between" style={{ marginBottom: "6px" }}>
            <span>Frame {playback.frame + 1}/{playback.frameCount}</span>
            <span>{new Date(playback.selectedValidTime).toLocaleString()}</span>
          </div>

          <div className="wb-timeline-ticks">
            {tickMarks.map((value) => (
              <span key={value}>T+{Math.round((value * 5) / 60)}h</span>
            ))}
          </div>

          <div className="wb-loop-controls" style={{ marginTop: "10px" }}>
            <label>
              Loop Start
              <input
                type="number"
                min={0}
                max={playback.loopEnd - 1}
                value={playback.loopStart}
                onChange={(event) => onSetLoopWindow(Number(event.target.value), playback.loopEnd)}
                style={{ width: "60px", marginLeft: "6px" }}
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
                style={{ width: "60px", marginLeft: "6px" }}
              />
            </label>
          </div>
        </div>
      )}
    </footer>
  );
}
