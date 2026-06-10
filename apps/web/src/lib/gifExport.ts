// GIF export engine: captures map canvas frames across an animation range
// and encodes them as an animated GIF using gifenc.
//
// The capture pipeline:
//   1. Readback the MapLibre canvas via drawImage() → getImageData()
//   2. Composite any overlay canvases (deck.gl, starfield, etc.) on top
//   3. Quantize to 256-color palette per frame (avoids inter-frame palette drift)
//   4. Encode as GIF with configurable delay and resolution
//
// We use per-frame palettes (not a global palette) because satellite/radar
// frames can have very different color distributions as clouds and storms move.

import { GIFEncoder, quantize, applyPalette } from "gifenc";

export interface GifExportOptions {
  /** The MapLibre canvas element to capture frames from (basemap + WMS rasters). */
  canvas: HTMLCanvasElement;
  /** Additional canvases to composite on top of the MapLibre canvas in DOM order.
   *  deck.gl overlays (stations, alerts, satellite composite) render to a
   *  separate canvas with interleaved:false — pass them here. */
  overlayCanvases?: HTMLCanvasElement[];
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
  /** Extra delay in ms after rAF to allow WMS tiles to finish loading.
   *  Default: 250ms. Increase if tiles appear blank in the output. */
  renderDelayMs?: number;
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

export function captureComposite(
  baseCanvas: HTMLCanvasElement,
  overlayCanvases: HTMLCanvasElement[],
  crop: { x: number; y: number; width: number; height: number },
  outWidth: number,
  outHeight: number,
): ImageData {
  const offscreen = document.createElement("canvas");
  offscreen.width = crop.width;
  offscreen.height = crop.height;
  const ctx = offscreen.getContext("2d")!;

  // Layer 1: MapLibre canvas (basemap + WMS raster tiles)
  ctx.drawImage(
    baseCanvas,
    crop.x, crop.y, crop.width, crop.height,
    0, 0, crop.width, crop.height,
  );

  // Layer 2+: overlay canvases (deck.gl, etc.) composited on top.
  // They are positioned absolutely over the MapLibre canvas at the same
  // offset within the container, so use the same crop coordinates.
  for (const overlay of overlayCanvases) {
    if (overlay.width === 0 || overlay.height === 0) continue;
    ctx.drawImage(
      overlay,
      crop.x, crop.y, crop.width, crop.height,
      0, 0, crop.width, crop.height,
    );
  }

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
    overlayCanvases = [],
    startFrame,
    endFrame,
    onRequestFrame,
    frameDelay = 20,
    renderDelayMs = 250,
    onProgress,
  } = options;

  const crop = options.crop ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const outWidth = options.width ?? crop.width;
  const outHeight = options.height ?? crop.height;

  const totalCaptureFrames = endFrame - startFrame + 1;
  const gif = GIFEncoder();

  for (let i = 0; i < totalCaptureFrames; i += 1) {
    const frameIndex = startFrame + i;

    // Tell the consumer to advance to this frame and wait for React re-render
    await onRequestFrame(frameIndex);

    // rAF × 2 allows MapLibre to process the new WMS tile URLs and kick off
    // fetches, and deck.gl to sync its view state.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // Extra delay so in-flight WMS tiles have time to download, decode, and
    // promote to the raster layer. 250ms is a reasonable floor; increase if
    // tiles appear blank.
    if (renderDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, renderDelayMs));
    }

    // Capture and encode
    const imageData = captureComposite(canvas, overlayCanvases, crop, outWidth, outHeight);
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
