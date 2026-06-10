/** GIF encoder sink built on gifenc.
 *
 * Quality options beyond the old exporter:
 *  - global palette mode: one palette quantized from frames sampled across
 *    the whole animation, eliminating per-frame palette flicker;
 *  - optional Floyd-Steinberg dithering (gifenc has none built in);
 *  - fps up to 15 (delay floor 7 cs ≈ 14 fps real-world GIF minimum).
 */

import { GIFEncoder, applyPalette, quantize } from "gifenc";

import type { FrameSink, FrameSinkInit, FrameSinkResult } from "./frameSink";

export interface GifSinkOptions {
  dither?: boolean;
  palette?: "global" | "per-frame";
}

function nearestPaletteIndex(palette: number[][], r: number, g: number, b: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const p = palette[i];
    const dr = r - p[0];
    const dg = g - p[1];
    const db = b - p[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** Floyd-Steinberg error diffusion against a fixed palette. */
export function ditherToPalette(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  palette: number[][],
): Uint8Array {
  const out = new Uint8Array(width * height);
  // Working copy in float to accumulate diffused error.
  const work = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 1) work[i] = data[i];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = (y * width + x) * 4;
      const r = Math.max(0, Math.min(255, work[p]));
      const g = Math.max(0, Math.min(255, work[p + 1]));
      const b = Math.max(0, Math.min(255, work[p + 2]));
      const index = nearestPaletteIndex(palette, r, g, b);
      out[y * width + x] = index;

      const chosen = palette[index];
      const er = r - chosen[0];
      const eg = g - chosen[1];
      const eb = b - chosen[2];

      const spread = (dx: number, dy: number, factor: number) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) return;
        const np = (ny * width + nx) * 4;
        work[np] += er * factor;
        work[np + 1] += eg * factor;
        work[np + 2] += eb * factor;
      };

      spread(1, 0, 7 / 16);
      spread(-1, 1, 3 / 16);
      spread(0, 1, 5 / 16);
      spread(1, 1, 1 / 16);
    }
  }
  return out;
}

interface BufferedFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  delayCs: number;
}

const GLOBAL_PALETTE_SAMPLE_FRAMES = 8;

export class GifSink implements FrameSink {
  private frames: BufferedFrame[] = [];
  private fps = 10;
  private canceled = false;

  constructor(private options: GifSinkOptions = {}) {}

  async init(opts: FrameSinkInit): Promise<void> {
    this.fps = Math.max(1, Math.min(15, opts.fps));
    this.frames = [];
    this.canceled = false;
  }

  async addFrame(frame: ImageData): Promise<void> {
    if (this.canceled) return;
    // GIF delay is centiseconds with an effective floor of ~2cs; many viewers
    // clamp below 7cs, so the fps cap is 15.
    const delayCs = Math.max(2, Math.round(100 / this.fps));
    this.frames.push({
      data: new Uint8ClampedArray(frame.data),
      width: frame.width,
      height: frame.height,
      delayCs,
    });
  }

  async finish(): Promise<FrameSinkResult> {
    if (this.frames.length === 0) throw new Error("GIF export produced no frames");

    const useGlobal = (this.options.palette ?? "global") === "global";
    const gif = GIFEncoder();

    let globalPalette: number[][] | null = null;
    if (useGlobal) {
      // Sample frames evenly across the animation and quantize once.
      const step = Math.max(1, Math.floor(this.frames.length / GLOBAL_PALETTE_SAMPLE_FRAMES));
      const sampled = this.frames.filter((_, i) => i % step === 0).slice(0, GLOBAL_PALETTE_SAMPLE_FRAMES);
      const totalPx = sampled.reduce((sum, f) => sum + f.width * f.height, 0);
      const combined = new Uint8ClampedArray(totalPx * 4);
      let offset = 0;
      for (const frame of sampled) {
        combined.set(frame.data, offset);
        offset += frame.data.length;
      }
      globalPalette = quantize(combined, 256);
    }

    for (let i = 0; i < this.frames.length; i += 1) {
      const frame = this.frames[i];
      const palette = globalPalette ?? quantize(frame.data, 256);
      const index = this.options.dither
        ? ditherToPalette(frame.data, frame.width, frame.height, palette)
        : applyPalette(frame.data, palette);

      gif.writeFrame(index, frame.width, frame.height, {
        palette,
        delay: i === this.frames.length - 1 ? frame.delayCs * 2 : frame.delayCs,
      });
    }

    gif.finish();
    const bytes = new Uint8Array(gif.bytes());
    this.frames = [];
    return { blob: new Blob([bytes], { type: "image/gif" }), extension: "gif" };
  }

  cancel(): void {
    this.canceled = true;
    this.frames = [];
  }
}
