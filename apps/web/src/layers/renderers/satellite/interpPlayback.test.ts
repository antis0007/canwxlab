import { describe, expect, it, vi } from "vitest";

import type { FrameTexture } from "./frameStore";
import type { InterpManifest } from "./interpFrames";
import { InterpPlayback, nearestFrame, pairKeyOf, type InterpFrameTexture } from "./interpPlayback";

function tex(): FrameTexture {
  return { width: 8, height: 8, destroy: vi.fn() };
}

function frame(tMs: number): InterpFrameTexture {
  return { tMs, texture: tex(), mercBounds: [0, 0, 1, 1] };
}

const PAIR = { layerId: "ir", mercBounds: [0, 0, 1, 1] as [number, number, number, number], t0Ms: 0, t1Ms: 1000 };

describe("pairKeyOf", () => {
  it("changes with interval and bbox, stable otherwise", () => {
    expect(pairKeyOf(PAIR)).toBe(pairKeyOf({ ...PAIR }));
    expect(pairKeyOf(PAIR)).not.toBe(pairKeyOf({ ...PAIR, t1Ms: 2000 }));
    expect(pairKeyOf(PAIR)).not.toBe(pairKeyOf({ ...PAIR, mercBounds: [0, 0, 2, 2] }));
  });
});

describe("nearestFrame", () => {
  const frames = [frame(0), frame(250), frame(500), frame(750)];
  it("returns null for empty input", () => {
    expect(nearestFrame([], 100)).toBeNull();
  });
  it("finds the closest frame by time, ties to the earlier", () => {
    expect(nearestFrame(frames, 240)?.tMs).toBe(250);
    expect(nearestFrame(frames, 125)?.tMs).toBe(0); // tie → earlier
    expect(nearestFrame(frames, 9999)?.tMs).toBe(750);
    expect(nearestFrame(frames, -50)?.tMs).toBe(0);
  });
});

describe("InterpPlayback", () => {
  const manifest: InterpManifest = {
    available: true,
    frames: [
      { tMs: 250, frac: 0.25, url: "u250" },
      { tMs: 500, frac: 0.5, url: "u500" },
      { tMs: 750, frac: 0.75, url: "u750" },
    ],
  };

  it("loads synthesized frames and serves the nearest within the pair", async () => {
    const decode = vi.fn(async (url: string) => ({ ...tex(), url } as FrameTexture));
    const pb = new InterpPlayback({ decode, fetchManifest: async () => manifest });
    pb.update(PAIR);
    await vi.waitFor(() => expect(pb.ready()).toBe(true));

    expect(decode).toHaveBeenCalledTimes(3);
    expect(pb.frameAt(490)?.tMs).toBe(500);
    // Outside the keyframe interval → null (caller keeps the morph).
    expect(pb.frameAt(2000)).toBeNull();
  });

  it("degrades to null when the manifest is unavailable", async () => {
    const decode = vi.fn();
    const pb = new InterpPlayback({ decode, fetchManifest: async () => ({ available: false, frames: [] }) });
    pb.update(PAIR);
    await Promise.resolve();
    expect(decode).not.toHaveBeenCalled();
    expect(pb.frameAt(500)).toBeNull();
  });

  it("aborts and destroys textures when the interval changes", async () => {
    const destroys: ReturnType<typeof vi.fn>[] = [];
    const decode = vi.fn(async () => {
      const d = vi.fn();
      destroys.push(d);
      return { width: 8, height: 8, destroy: d } as FrameTexture;
    });
    const pb = new InterpPlayback({ decode, fetchManifest: async () => manifest });
    pb.update(PAIR);
    await vi.waitFor(() => expect(pb.ready()).toBe(true));
    pb.update({ ...PAIR, t1Ms: 2000 }); // new interval → old textures freed
    expect(destroys.every((d) => d.mock.calls.length > 0)).toBe(true);
  });
});
