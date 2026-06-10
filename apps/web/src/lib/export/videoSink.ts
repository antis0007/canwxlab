/** WebM (VP9) and MP4 (H.264) export sinks via WebCodecs VideoEncoder.
 *
 * No MediaRecorder fallback: MediaRecorder cannot produce frame-accurate
 * timestamps for stepped offline rendering. When WebCodecs is unavailable the
 * UI disables video formats and offers GIF only.
 */

import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";

import type { FrameSink, FrameSinkInit, FrameSinkResult } from "./frameSink";

export type VideoFormat = "webm" | "mp4";

export function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

const KEYFRAME_INTERVAL = 30;
const MAX_ENCODE_QUEUE = 4;

export class VideoSink implements FrameSink {
  private encoder: VideoEncoder | null = null;
  private mp4Muxer: Mp4Muxer<Mp4Target> | null = null;
  private webmMuxer: WebmMuxer<WebmTarget> | null = null;
  private mp4Target: Mp4Target | null = null;
  private webmTarget: WebmTarget | null = null;
  private frameIndex = 0;
  private width = 0;
  private height = 0;

  constructor(
    private format: VideoFormat,
    private bitrate = 8_000_000,
  ) {}

  async init(opts: FrameSinkInit): Promise<void> {
    if (!isWebCodecsSupported()) {
      throw new Error("WebCodecs VideoEncoder is not available in this browser");
    }

    // H.264 requires even dimensions; apply to both formats for consistency.
    this.width = opts.width - (opts.width % 2);
    this.height = opts.height - (opts.height % 2);
    this.frameIndex = 0;

    let output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;

    if (this.format === "mp4") {
      this.mp4Target = new Mp4Target();
      this.mp4Muxer = new Mp4Muxer({
        target: this.mp4Target,
        video: { codec: "avc", width: this.width, height: this.height },
        fastStart: "in-memory",
      });
      output = (chunk, meta) => this.mp4Muxer!.addVideoChunk(chunk, meta);
    } else {
      this.webmTarget = new WebmTarget();
      this.webmMuxer = new WebmMuxer({
        target: this.webmTarget,
        video: { codec: "V_VP9", width: this.width, height: this.height },
      });
      output = (chunk, meta) => this.webmMuxer!.addVideoChunk(chunk, meta);
    }

    this.encoder = new VideoEncoder({
      output,
      error: (err) => {
        throw err;
      },
    });

    this.encoder.configure({
      codec: this.format === "mp4" ? "avc1.42001f" : "vp09.00.10.08",
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
      framerate: opts.fps,
    });
  }

  async addFrame(frame: ImageData, timestampMs: number): Promise<void> {
    if (!this.encoder) throw new Error("VideoSink not initialized");

    const bitmap = await createImageBitmap(frame, 0, 0, this.width || frame.width, this.height || frame.height);
    const videoFrame = new VideoFrame(bitmap, { timestamp: Math.round(timestampMs * 1000) });
    try {
      this.encoder.encode(videoFrame, { keyFrame: this.frameIndex % KEYFRAME_INTERVAL === 0 });
      this.frameIndex += 1;
    } finally {
      videoFrame.close();
      bitmap.close?.();
    }

    // Backpressure: keep the encode queue shallow so memory stays bounded.
    while (this.encoder.encodeQueueSize > MAX_ENCODE_QUEUE) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  async finish(): Promise<FrameSinkResult> {
    if (!this.encoder) throw new Error("VideoSink not initialized");
    await this.encoder.flush();
    this.encoder.close();
    this.encoder = null;

    if (this.format === "mp4") {
      this.mp4Muxer!.finalize();
      return {
        blob: new Blob([this.mp4Target!.buffer], { type: "video/mp4" }),
        extension: "mp4",
      };
    }

    this.webmMuxer!.finalize();
    return {
      blob: new Blob([this.webmTarget!.buffer], { type: "video/webm" }),
      extension: "webm",
    };
  }

  cancel(): void {
    try {
      this.encoder?.close();
    } catch {
      /* already closed */
    }
    this.encoder = null;
  }
}
