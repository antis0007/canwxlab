import { afterEach, describe, expect, it, vi } from "vitest";

import { VideoSink, isWebCodecsSupported } from "./videoSink";

interface MockEncoderInstance {
  configure: ReturnType<typeof vi.fn>;
  encode: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  encodeQueueSize: number;
}

function installWebCodecsMocks() {
  const instances: MockEncoderInstance[] = [];

  class MockVideoEncoder {
    configure = vi.fn();
    encode = vi.fn();
    flush = vi.fn(async () => {});
    close = vi.fn();
    encodeQueueSize = 0;

    constructor(_opts: unknown) {
      instances.push(this as unknown as MockEncoderInstance);
    }
  }

  class MockVideoFrame {
    timestamp: number;
    constructor(_src: unknown, opts: { timestamp: number }) {
      this.timestamp = opts.timestamp;
    }
    close() {}
  }

  vi.stubGlobal("VideoEncoder", MockVideoEncoder);
  vi.stubGlobal("VideoFrame", MockVideoFrame);
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
  return instances;
}

function solidFrame(size = 8): ImageData {
  return {
    data: new Uint8ClampedArray(size * size * 4),
    width: size,
    height: size,
    colorSpace: "srgb",
  } as ImageData;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isWebCodecsSupported", () => {
  it("is false without VideoEncoder global", () => {
    expect(isWebCodecsSupported()).toBe(false);
  });

  it("is true with mocked globals", () => {
    installWebCodecsMocks();
    expect(isWebCodecsSupported()).toBe(true);
  });
});

describe("VideoSink", () => {
  it("configures VP9 for webm and H.264 for mp4 with even dimensions", async () => {
    const instances = installWebCodecsMocks();

    const webm = new VideoSink("webm");
    await webm.init({ width: 641, height: 481, fps: 10 });
    expect(instances[0].configure).toHaveBeenCalledWith(expect.objectContaining({
      codec: "vp09.00.10.08",
      width: 640,
      height: 480,
      framerate: 10,
    }));

    const mp4 = new VideoSink("mp4");
    await mp4.init({ width: 640, height: 480, fps: 15 });
    expect(instances[1].configure).toHaveBeenCalledWith(expect.objectContaining({
      codec: "avc1.42001f",
      framerate: 15,
    }));
  });

  it("encodes frames with microsecond timestamps and periodic keyframes", async () => {
    const instances = installWebCodecsMocks();
    const sink = new VideoSink("webm");
    await sink.init({ width: 8, height: 8, fps: 10 });

    await sink.addFrame(solidFrame(), 0);
    await sink.addFrame(solidFrame(), 100);

    const calls = instances[0].encode.mock.calls;
    expect(calls).toHaveLength(2);
    expect((calls[0][0] as { timestamp: number }).timestamp).toBe(0);
    expect((calls[1][0] as { timestamp: number }).timestamp).toBe(100_000);
    expect(calls[0][1]).toEqual({ keyFrame: true });
    expect(calls[1][1]).toEqual({ keyFrame: false });
  });

  it("throws a clear error without WebCodecs", async () => {
    const sink = new VideoSink("webm");
    await expect(sink.init({ width: 8, height: 8, fps: 10 })).rejects.toThrow(/WebCodecs/);
  });
});
