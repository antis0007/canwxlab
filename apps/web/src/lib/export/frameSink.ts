/** Pluggable animation frame encoder. GIF, WebM, and MP4 sinks implement
 * this; the export orchestrator only sees the interface. */

export interface FrameSinkInit {
  width: number;
  height: number;
  fps: number;
}

export interface FrameSinkResult {
  blob: Blob;
  extension: string;
}

export interface FrameSink {
  init(opts: FrameSinkInit): Promise<void>;
  addFrame(frame: ImageData, timestampMs: number): Promise<void>;
  finish(): Promise<FrameSinkResult>;
  cancel(): void;
}
