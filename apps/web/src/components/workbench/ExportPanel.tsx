import { useState } from "react";
import { DraggablePanel } from "../DraggablePanel";
import { isWebCodecsSupported } from "../../lib/export/videoSink";

export type ExportFormat = "gif" | "webm" | "mp4";
export type ExportResolution = "480" | "720" | "full";

export interface ExportConfig {
  format: ExportFormat;
  fps: number;
  resolution: ExportResolution;
  dither: boolean;
  globalPalette: boolean;
  startFrame: number;
  endFrame: number;
  /** Animation seconds of output per timeline hour. */
  outputSecondsPerHour: number;
}

export interface ExportPanelProps {
  onClose: () => void;
  totalFrames: number;
  /** Timeline frame interval in ms (for duration/size estimates). */
  frameIntervalMs: number;
  onExport: (config: ExportConfig) => void;
  onCancel: () => void;
  /** Progress: null = idle, [current, total] = in progress. */
  progress: [number, number] | null;
  /** Area selection state owned by the app (map overlay). */
  areaSelected: boolean;
  onToggleAreaSelect: () => void;
  onClearArea: () => void;
}

const BYTES_PER_PIXEL_PER_FRAME: Record<ExportFormat, number> = {
  gif: 0.35,
  webm: 0.08,
  mp4: 0.10,
};

const RESOLUTION_WIDTHS: Record<ExportResolution, number | null> = {
  "480": 854,
  "720": 1280,
  full: null,
};

export function estimateExportBytes(config: {
  format: ExportFormat;
  fps: number;
  resolution: ExportResolution;
  durationSec: number;
  fullWidth?: number;
  fullHeight?: number;
}): number {
  const width = RESOLUTION_WIDTHS[config.resolution] ?? config.fullWidth ?? 1920;
  const height = config.resolution === "full"
    ? config.fullHeight ?? 1080
    : Math.round(width * 9 / 16);
  return Math.round(width * height * config.fps * config.durationSec * BYTES_PER_PIXEL_PER_FRAME[config.format]);
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function ExportPanel({
  onClose,
  totalFrames,
  frameIntervalMs,
  onExport,
  onCancel,
  progress,
  areaSelected,
  onToggleAreaSelect,
  onClearArea,
}: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("gif");
  const [fps, setFps] = useState(10);
  const [resolution, setResolution] = useState<ExportResolution>("720");
  const [dither, setDither] = useState(true);
  const [globalPalette, setGlobalPalette] = useState(true);
  const [outputSecondsPerHour, setOutputSecondsPerHour] = useState(10);
  const [startFrame, setStartFrame] = useState(0);
  const [endFrame, setEndFrame] = useState(Math.min(totalFrames - 1, 47));

  const webCodecsOk = isWebCodecsSupported();
  const isExporting = progress !== null;

  const spanHours = ((endFrame - startFrame) * frameIntervalMs) / 3_600_000;
  const durationSec = Math.max(0.1, spanHours * outputSecondsPerHour);
  const effectiveFps = format === "gif" ? Math.min(fps, 15) : fps;
  const estBytes = estimateExportBytes({ format, fps: effectiveFps, resolution, durationSec });

  const clampStart = (v: number) => setStartFrame(Math.max(0, Math.min(endFrame - 1, v)));
  const clampEnd = (v: number) => setEndFrame(Math.max(startFrame + 1, Math.min(totalFrames - 1, v)));

  return (
    <DraggablePanel
      title="Export animation"
      subtitle="Area + time range → GIF / WebM / MP4"
      onClose={onClose}
      storageKey="gif-export"
      width={360}
      defaultPosition={{ x: 160, y: 100 }}
      ariaLabel="Animation export panel"
    >
      <div className="wb-gif-export">
        {isExporting ? (
          <div className="wb-gif-progress">
            <div className="wb-gif-progress-label">
              Capturing frame {progress[0]} of {progress[1]}…
            </div>
            <progress className="wb-gif-progress-bar" value={progress[0]} max={progress[1]} />
            <button
              type="button"
              className="wb-btn-secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={onCancel}
            >
              Cancel export
            </button>
          </div>
        ) : (
          <>
            <div className="wb-gif-field">
              <label>Format</label>
              <div role="radiogroup" aria-label="Export format" className="wb-export-format-group">
                {(["gif", "webm", "mp4"] as ExportFormat[]).map((f) => {
                  const disabled = f !== "gif" && !webCodecsOk;
                  return (
                    <label key={f} title={disabled ? "Requires WebCodecs (unavailable in this browser)" : undefined}>
                      <input
                        type="radio"
                        name="export-format"
                        value={f}
                        checked={format === f}
                        disabled={disabled}
                        onChange={() => setFormat(f)}
                      />
                      {f.toUpperCase()}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="wb-gif-field">
              <label>Start frame</label>
              <input type="number" min={0} max={totalFrames - 2} value={startFrame}
                onChange={(e) => clampStart(Number(e.target.value))} />
              <input type="range" min={0} max={totalFrames - 2} value={startFrame}
                onChange={(e) => clampStart(Number(e.target.value))} />
            </div>

            <div className="wb-gif-field">
              <label>End frame</label>
              <input type="number" min={1} max={totalFrames - 1} value={endFrame}
                onChange={(e) => clampEnd(Number(e.target.value))} />
              <input type="range" min={1} max={totalFrames - 1} value={endFrame}
                onChange={(e) => clampEnd(Number(e.target.value))} />
            </div>

            <div className="wb-gif-field">
              <label>Frame rate</label>
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                <option value={5}>5 fps</option>
                <option value={10}>10 fps</option>
                <option value={15}>15 fps</option>
                <option value={30} disabled={format === "gif"}>30 fps (video only)</option>
              </select>
            </div>

            <div className="wb-gif-field">
              <label>Resolution</label>
              <select value={resolution} onChange={(e) => setResolution(e.target.value as ExportResolution)}>
                <option value="480">480p</option>
                <option value="720">720p</option>
                <option value="full">Full window</option>
              </select>
            </div>

            <div className="wb-gif-field">
              <label>Timelapse speed</label>
              <select value={outputSecondsPerHour} onChange={(e) => setOutputSecondsPerHour(Number(e.target.value))}>
                <option value={5}>5 s of video per hour</option>
                <option value={10}>10 s of video per hour</option>
                <option value={20}>20 s of video per hour</option>
              </select>
            </div>

            {format === "gif" && (
              <div className="wb-gif-field wb-export-gif-options">
                <label>
                  <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} />
                  Floyd–Steinberg dithering
                </label>
                <label>
                  <input type="checkbox" checked={globalPalette} onChange={(e) => setGlobalPalette(e.target.checked)} />
                  Global palette (no flicker)
                </label>
              </div>
            )}

            <div className="wb-gif-field">
              <label>Area</label>
              <div className="wb-export-area-controls">
                <button type="button" className="wb-btn-secondary" onClick={onToggleAreaSelect}>
                  {areaSelected ? "Reselect area" : "Select area on map"}
                </button>
                {areaSelected && (
                  <button type="button" className="wb-btn-secondary" onClick={onClearArea}>
                    Clear (use full view)
                  </button>
                )}
              </div>
            </div>

            <div className="wb-gif-summary">
              <span>{durationSec.toFixed(1)}s at {effectiveFps} fps</span>
              <span data-testid="export-size-estimate">~{formatBytes(estBytes)}</span>
              <span className="wb-gif-summary-hint">
                {areaSelected ? "Exporting selected area" : "Exporting full view"}
              </span>
            </div>

            <button
              type="button"
              className="wb-btn-primary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => onExport({
                format,
                fps: effectiveFps,
                resolution,
                dither,
                globalPalette,
                startFrame,
                endFrame,
                outputSecondsPerHour,
              })}
            >
              Export {format.toUpperCase()}
            </button>
          </>
        )}
      </div>
    </DraggablePanel>
  );
}
