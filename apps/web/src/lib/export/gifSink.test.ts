import { describe, expect, it } from "vitest";

import { GifSink, ditherToPalette } from "./gifSink";
import { exportFrameTimes } from "./exportAnimation";

function solidFrame(r: number, g: number, b: number, size = 8): ImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  return { data, width: size, height: size, colorSpace: "srgb" } as ImageData;
}

describe("GifSink", () => {
  it("encodes frames into a non-empty GIF blob", async () => {
    const sink = new GifSink();
    await sink.init({ width: 8, height: 8, fps: 10 });
    await sink.addFrame(solidFrame(255, 0, 0), 0);
    await sink.addFrame(solidFrame(0, 255, 0), 100);
    await sink.addFrame(solidFrame(0, 0, 255), 200);
    const result = await sink.finish();

    expect(result.blob.type).toBe("image/gif");
    expect(result.extension).toBe("gif");
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("caps fps at the practical GIF maximum of 15", async () => {
    const sink = new GifSink();
    await sink.init({ width: 8, height: 8, fps: 60 });
    await sink.addFrame(solidFrame(10, 10, 10), 0);
    const result = await sink.finish();
    expect(result.blob.size).toBeGreaterThan(0);
  });

  it("cancel discards buffered frames", async () => {
    const sink = new GifSink();
    await sink.init({ width: 8, height: 8, fps: 10 });
    await sink.addFrame(solidFrame(1, 2, 3), 0);
    sink.cancel();
    await expect(sink.finish()).rejects.toThrow(/no frames/i);
  });
});

describe("ditherToPalette", () => {
  it("maps every pixel to a palette index", () => {
    const frame = solidFrame(120, 64, 200, 4);
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
      [128, 64, 196],
    ];
    const indexed = ditherToPalette(frame.data, 4, 4, palette);
    expect(indexed).toHaveLength(16);
    for (const index of indexed) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(palette.length);
    }
    // Mostly the nearest color.
    const counts = [0, 0, 0];
    for (const index of indexed) counts[index] += 1;
    expect(counts[2]).toBeGreaterThan(8);
  });
});

describe("exportFrameTimes", () => {
  it("produces fps × output-duration frames across the range", () => {
    const HOUR = 3_600_000;
    const times = exportFrameTimes({
      startMs: 0,
      endMs: 3 * HOUR,
      fps: 10,
      outputSecondsPerHour: 10,
    });
    expect(times).toHaveLength(300);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBe(3 * HOUR);
  });

  it("degenerate zero-span range yields one frame", () => {
    expect(exportFrameTimes({ startMs: 5, endMs: 5, fps: 10, outputSecondsPerHour: 10 })).toEqual([5]);
  });
});
