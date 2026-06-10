/** Production FrameStore fetch implementation: proxied WMS fetch with retry,
 * GPU texture upload, and a downsampled luma motion sample for the global
 * flow seed. */

import type { Device, Texture } from "@luma.gl/core";

import { loadImageWithRetry } from "./wmsRequest";
import type { FrameFetchRequest, FrameTexture } from "./frameStore";

export interface MotionSample {
  width: number;
  height: number;
  luma: Float32Array;
}

const MOTION_SAMPLE_DIM = 256;

const motionSamples = new WeakMap<FrameTexture, MotionSample>();

/** Motion sample for a fetched frame texture, if one was computed. */
export function getMotionSample(texture: FrameTexture): MotionSample | null {
  return motionSamples.get(texture) ?? null;
}

export function createMotionSampleFromBitmap(bitmap: ImageBitmap): MotionSample | null {
  const aspect = bitmap.width / Math.max(1, bitmap.height);
  const width = aspect >= 1 ? MOTION_SAMPLE_DIM : Math.max(32, Math.round(MOTION_SAMPLE_DIM * aspect));
  const height = aspect >= 1 ? Math.max(32, Math.round(MOTION_SAMPLE_DIM / aspect)) : MOTION_SAMPLE_DIM;

  try {
    const canvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true } as never) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;

    if (!ctx) return null;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);

    const data = ctx.getImageData(0, 0, width, height).data;
    const luma = new Float32Array(width * height);

    for (let i = 0, p = 0; i < luma.length; i += 1, p += 4) {
      const alpha = data[p + 3] / 255;
      luma[i] = alpha * (
        data[p] * 0.2126 +
        data[p + 1] * 0.7152 +
        data[p + 2] * 0.0722
      ) / 255;
    }

    return { width, height, luma };
  } catch {
    return null;
  }
}

function createSatelliteTexture(device: Device, bitmap: ImageBitmap): Texture {
  const texture = device.createTexture({
    width: bitmap.width,
    height: bitmap.height,
    format: "rgba8unorm" as never,
    sampler: {
      minFilter: "linear" as never,
      magFilter: "linear" as never,
      addressModeU: "clamp-to-edge" as never,
      addressModeV: "clamp-to-edge" as never,
    },
  });

  texture.copyExternalImage({
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    flipY: false,
  });

  return texture;
}

export interface GpuFrameTexture extends FrameTexture {
  gpuTexture: Texture;
}

export function createGpuFetchFrame(device: Device): (req: FrameFetchRequest) => Promise<FrameTexture> {
  return async (req: FrameFetchRequest): Promise<FrameTexture> => {
    const bitmap = await loadImageWithRetry(req.url, req.signal);
    try {
      const gpuTexture = createSatelliteTexture(device, bitmap);
      const frameTexture: GpuFrameTexture = {
        width: bitmap.width,
        height: bitmap.height,
        gpuTexture,
        destroy: () => gpuTexture.destroy(),
      };
      const sample = createMotionSampleFromBitmap(bitmap);
      if (sample) motionSamples.set(frameTexture, sample);
      return frameTexture;
    } finally {
      bitmap.close?.();
    }
  };
}
