import { useState } from "react";
import { DraggablePanel } from "../DraggablePanel";

export interface GifExportPanelProps {
  onClose: () => void;
  /** Total frames in the timeline (0-indexed, so frameCount-1 is last). */
  totalFrames: number;
  /** Called to start the export with the selected range. */
  onExport: (range: { startFrame: number; endFrame: number; frameDelay: number }) => void;
  /** Progress state: null = idle, [current, total] = in progress. */
  progress: [number, number] | null;
}

export function GifExportPanel({
  onClose,
  totalFrames,
  onExport,
  progress,
}: GifExportPanelProps) {
  const [startFrame, setStartFrame] = useState(0);
  const [endFrame, setEndFrame] = useState(Math.min(totalFrames - 1, 47));
  const [fps, setFps] = useState(5);

  const frameDelay = Math.round(100 / fps); // centiseconds per frame
  const frameCount = Math.max(1, endFrame - startFrame + 1);
  const durationSec = frameCount / fps;
  const isExporting = progress !== null;

  const clampStart = (v: number) => {
    const s = Math.max(0, Math.min(endFrame - 1, v));
    setStartFrame(s);
  };
  const clampEnd = (v: number) => {
    const e = Math.max(startFrame + 1, Math.min(totalFrames - 1, v));
    setEndFrame(e);
  };

  return (
    <DraggablePanel
      title="Export GIF"
      subtitle="Select time range → capture → download"
      onClose={onClose}
      storageKey="gif-export"
      width={340}
      defaultPosition={{ x: 160, y: 100 }}
      ariaLabel="GIF export panel"
    >
      <div className="wb-gif-export">
        {isExporting ? (
          <div className="wb-gif-progress">
            <div className="wb-gif-progress-label">
              Capturing frame {progress[0]} of {progress[1]}…
            </div>
            <progress
              className="wb-gif-progress-bar"
              value={progress[0]}
              max={progress[1]}
            />
          </div>
        ) : (
          <>
            <div className="wb-gif-field">
              <label>Start frame</label>
              <input
                type="number"
                min={0}
                max={totalFrames - 2}
                value={startFrame}
                onChange={(e) => clampStart(Number(e.target.value))}
              />
              <input
                type="range"
                min={0}
                max={totalFrames - 2}
                value={startFrame}
                onChange={(e) => clampStart(Number(e.target.value))}
              />
            </div>

            <div className="wb-gif-field">
              <label>End frame</label>
              <input
                type="number"
                min={1}
                max={totalFrames - 1}
                value={endFrame}
                onChange={(e) => clampEnd(Number(e.target.value))}
              />
              <input
                type="range"
                min={1}
                max={totalFrames - 1}
                value={endFrame}
                onChange={(e) => clampEnd(Number(e.target.value))}
              />
            </div>

            <div className="wb-gif-field">
              <label>Frame rate</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
              >
                <option value={2}>2 fps (slow)</option>
                <option value={5}>5 fps</option>
                <option value={10}>10 fps</option>
                <option value={15}>15 fps (smooth)</option>
              </select>
            </div>

            <div className="wb-gif-summary">
              <span>{frameCount} frames</span>
              <span>{durationSec.toFixed(1)}s at {fps} fps</span>
              <span className="wb-gif-summary-hint">
                Shift+drag on map to set crop region
              </span>
            </div>

            <button
              type="button"
              className="wb-btn-primary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => onExport({ startFrame, endFrame, frameDelay })}
            >
              Capture &amp; Export GIF
            </button>
          </>
        )}
      </div>
    </DraggablePanel>
  );
}
