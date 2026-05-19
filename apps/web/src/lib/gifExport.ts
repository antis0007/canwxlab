// GIF export engine: captures map canvas frames across an animation range
// and encodes them as an animated GIF using gifenc.
//
// The capture pipeline:
//   1. Readback the MapLibre canvas via drawImage() → getImageData()
//   2. Quantize to 256-color palette per frame (avoids inter-frame palette drift)
//   3. Encode as GIF with configurable delay and resolution
//
// We use per-frame palettes (not a global palette) because satellite/radar
// frames can have very different color distributions as clouds and storms move.

import { GIFEncoder, quantize, applyPalette } from "gifenc";

export interface GifExportOptions {
  /** The canvas element to capture frames from. */
  canvas: HTMLCanvasElement;
  /** Total number of animation frames available in the timeline. */
  totalFrames: number;
  /** First frame to capture (inclusive). */
  startFrame: number;
  /** Last frame to capture (inclusive). */
  endFrame: number;
  /**
   * Called before each frame capture with the frame index being requested.
   * The consumer should advance playback to this frame and resolve when
   * rendering is complete (WMS layers promoted, deck.gl synced).
   */
  onRequestFrame: (frame: number) => Promise<void>;
  /** GIF frame delay in centiseconds (1 = 10ms). Default: 20 (200ms = 5fps). */
  frameDelay?: number;
  /** Output width in pixels. Default: canvas width. */
  width?: number;
  /** Output height in pixels. Default: canvas height. */
  height?: number;
  /** Crop region in canvas coordinates. Default: full canvas. */
  crop?: { x: number; y: number; width: number; height: number };
  /** Progress callback: (currentFrame, totalFrames). */
  onProgress?: (current: number, total: number) => void;
}

export interface GifExportResult {
  /** The encoded GIF as a Blob ready for download. */
  blob: Blob;
  /** Frame count in the output. */
  frameCount: number;
  /** Output dimensions. */
  width: number;
  height: number;
}

function captureCanvas(
  canvas: HTMLCanvasElement,
  crop: { x: number; y: number; width: number; height: number },
  outWidth: number,
  outHeight: number,
): ImageData {
  const offscreen = document.createElement("canvas");
  offscreen.width = crop.width;
  offscreen.height = crop.height;
  const ctx = offscreen.getContext("2d")!;
  ctx.drawImage(
    canvas,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, crop.width, crop.height,
  );

  // Scale down if requested
  if (outWidth !== crop.width || outHeight !== crop.height) {
    const scaled = document.createElement("canvas");
    scaled.width = outWidth;
    scaled.height = outHeight;
    const sctx = scaled.getContext("2d")!;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(offscreen, 0, 0, outWidth, outHeight);
    return sctx.getImageData(0, 0, outWidth, outHeight);
  }

  return ctx.getImageData(0, 0, crop.width, crop.height);
}

export async function exportGif(options: GifExportOptions): Promise<GifExportResult> {
  const {
    canvas,
    startFrame,
    endFrame,
    onRequestFrame,
    frameDelay = 20,
    onProgress,
  } = options;

  const crop = options.crop ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const outWidth = options.width ?? crop.width;
  const outHeight = options.height ?? crop.height;

  const totalCaptureFrames = endFrame - startFrame + 1;
  const gif = GIFEncoder();

  for (let i = 0; i < totalCaptureFrames; i += 1) {
    const frameIndex = startFrame + i;

    // Tell the consumer to advance to this frame and wait for render
    await onRequestFrame(frameIndex);

    // Small extra delay so WMS double-buffer promotion and deck.gl sync
    // have time to land on screen before we capture.
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Capture
    const imageData = captureCanvas(canvas, crop, outWidth, outHeight);
    const palette = quantize(imageData.data, 256);
    const index = applyPalette(imageData.data, palette, 256);

    gif.writeFrame(index, outWidth, outHeight, {
      palette,
      delay: i === totalCaptureFrames - 1 ? frameDelay * 2 : frameDelay,
    });

    onProgress?.(i + 1, totalCaptureFrames);
  }

  gif.finish();
  const bytes = new Uint8Array(gif.bytes());
  const blob = new Blob([bytes], { type: "image/gif" });

  return {
    blob,
    frameCount: totalCaptureFrames,
    width: outWidth,
    height: outHeight,
  };
}

export function downloadGif(blob: Blob, filename: string) {
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
