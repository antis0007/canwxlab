import { describe, expect, it, vi } from "vitest";

import { CaptureController } from "./captureController";

function fakeMap() {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    once: (event: string, callback: () => void) => {
      (handlers[event] ??= []).push(callback);
    },
    triggerRepaint: vi.fn(),
    fire: (event: string) => {
      (handlers[event] ?? []).splice(0).forEach((callback) => callback());
    },
  };
}

function imageData(): ImageData {
  return { width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4), colorSpace: "srgb" } as ImageData;
}

describe("CaptureController", () => {
  it("resolves capture only after render fires post-readiness", async () => {
    const map = fakeMap();
    const readPixels = vi.fn(() => imageData());
    const ctrl = new CaptureController({ map, readPixels });
    const whenReady = vi.fn(async () => {});

    const pending = ctrl.captureFrame({ timelineMs: 0, whenReady });
    await Promise.resolve();
    await Promise.resolve();
    expect(whenReady).toHaveBeenCalled();
    expect(readPixels).not.toHaveBeenCalled();

    map.fire("render");
    const frame = await pending;
    expect(readPixels).toHaveBeenCalledTimes(1);
    expect(frame.width).toBe(8);
    expect(map.triggerRepaint).toHaveBeenCalled();
  });

  it("rejects on per-frame timeout", async () => {
    const map = fakeMap();
    const ctrl = new CaptureController({
      map,
      readPixels: () => imageData(),
      frameTimeoutMs: 10,
    });
    await expect(
      ctrl.captureFrame({ timelineMs: 0, whenReady: () => new Promise(() => {}) }),
    ).rejects.toThrow(/timeout/i);
  });
});
