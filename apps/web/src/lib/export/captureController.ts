/** Captures pixel-correct frames by reading the WebGL canvases inside
 * MapLibre's render event, after the requested timeline state is fully
 * renderable. Reading inside the render callback is what makes WebGL canvas
 * readback reliable without a global preserveDrawingBuffer cost; the old
 * exporter read after a blind 250 ms sleep and got blank or stale frames. */

export interface CaptureMap {
  once(event: "render", callback: () => void): void;
  triggerRepaint(): void;
}

export interface CaptureRequest {
  timelineMs: number;
  /** Resolves when every layer reports the requested time renderable
   * (e.g. satelliteLayer.whenTimeBuffered + map idle). */
  whenReady: () => Promise<void>;
}

export class CaptureController {
  constructor(private opts: {
    map: CaptureMap;
    /** Synchronous composite readback; called inside the render callback. */
    readPixels: () => ImageData;
    frameTimeoutMs?: number;
  }) {}

  async captureFrame(req: CaptureRequest): Promise<ImageData> {
    const timeout = this.opts.frameTimeoutMs ?? 15_000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        (async () => {
          await req.whenReady();
          return await new Promise<ImageData>((resolve) => {
            this.opts.map.once("render", () => resolve(this.opts.readPixels()));
            this.opts.map.triggerRepaint();
          });
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Frame capture timeout after ${timeout} ms (t=${new Date(req.timelineMs).toISOString()})`)),
            timeout,
          );
        }),
      ]);
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  }
}
