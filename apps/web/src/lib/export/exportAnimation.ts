/** Export orchestrator: steps the timeline at the output frame rate, captures
 * each frame through the CaptureController (render-callback readback after a
 * real readiness signal), and feeds a pluggable FrameSink encoder. */

import type { CaptureController } from "./captureController";
import type { FrameSink, FrameSinkResult } from "./frameSink";

export interface ExportAnimationOptions {
  sink: FrameSink;
  capture: CaptureController;
  /** Inclusive timeline range to export. */
  startMs: number;
  endMs: number;
  /** Output frame rate. */
  fps: number;
  /** Animation seconds of output per timeline hour. Determines how many
   * output frames cover the range: e.g. 10 s/h over 3 h at 10 fps = 300. */
  outputSecondsPerHour: number;
  width: number;
  height: number;
  /** Advance app state to the timeline instant; capture readiness is awaited
   * separately by the controller's whenReady. */
  seekTo: (timelineMs: number) => void;
  whenReady: (timelineMs: number) => Promise<void>;
  /** Crop + scale the captured frame before encoding. */
  readFrame?: never;
  onProgress?: (current: number, total: number) => void;
  signal?: AbortSignal;
}

export function exportFrameTimes(opts: {
  startMs: number;
  endMs: number;
  fps: number;
  outputSecondsPerHour: number;
}): number[] {
  const spanMs = Math.max(0, opts.endMs - opts.startMs);
  if (spanMs === 0) return [opts.startMs];
  const outputSeconds = (spanMs / 3_600_000) * Math.max(0.1, opts.outputSecondsPerHour);
  const frameCount = Math.max(2, Math.round(outputSeconds * opts.fps));
  const step = spanMs / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, i) => Math.round(opts.startMs + i * step));
}

export async function exportAnimation(options: ExportAnimationOptions): Promise<FrameSinkResult> {
  const times = exportFrameTimes(options);
  await options.sink.init({ width: options.width, height: options.height, fps: options.fps });

  try {
    for (let i = 0; i < times.length; i += 1) {
      if (options.signal?.aborted) {
        options.sink.cancel();
        throw new DOMException("Export canceled", "AbortError");
      }

      const timelineMs = times[i];
      options.seekTo(timelineMs);
      const frame = await options.capture.captureFrame({
        timelineMs,
        whenReady: () => options.whenReady(timelineMs),
      });
      await options.sink.addFrame(frame, (i / options.fps) * 1000);
      options.onProgress?.(i + 1, times.length);
    }

    return await options.sink.finish();
  } catch (err) {
    options.sink.cancel();
    throw err;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
