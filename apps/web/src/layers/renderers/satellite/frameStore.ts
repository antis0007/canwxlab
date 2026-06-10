/** Time-indexed satellite frame ring buffer with snapped-grid fetching.
 *
 * Replaces the viewport-anchored preload queue in satelliteComposite.ts.
 * Frames are keyed by (snapped grid cell, timeMs). Pans inside a grid cell
 * reuse the buffer; zoom-band changes start a new sequence while the old one
 * remains drawable until the new one has a usable pair.
 */

import { logManager } from "../../../lib/logging";
import { formatWmsUtcSecond } from "../../../time/wmsTime";
import { mergeBufferedRanges, snapFetchBounds, type BufferedRange } from "./frameGrid";
import {
  MAX_IN_FLIGHT_PER_SATELLITE,
  MAX_RETAINED_FRAMES,
  planEviction,
  planPrefetch,
} from "./framePlan";
import {
  buildProxiedWmsUrl,
  FAILED_URL_COOLDOWN_MS,
  replaceTemplateTime,
} from "./wmsRequest";

export interface FrameTexture {
  width: number;
  height: number;
  destroy: () => void;
}

export interface StoredFrame {
  timeMs: number;
  gridKey: string;
  mercBounds: [number, number, number, number];
  texture: FrameTexture;
  width: number;
  height: number;
  /** Global motion seed [u, v, confidence, 0] filled asynchronously by the
   *  motion-sample worker; null until estimated. */
  globalFlow: [number, number, number, number] | null;
}

export interface FrameFetchRequest {
  timeMs: number;
  url: string;
  mercBounds: [number, number, number, number];
  texSize: [number, number];
  signal: AbortSignal;
}

export interface FrameStoreOptions {
  satelliteId: string;
  wmsUrlTemplate: string;
  availableTimesMs: number[];
  frameIntervalMs: number;
  /** Injected fetch → decoded GPU texture. Production impl wraps
   *  loadImageWithRetry + createSatelliteTexture (frameStoreFactory). */
  fetchFrame: (req: FrameFetchRequest) => Promise<FrameTexture>;
  onChange?: () => void;
}

export interface FrameStoreUpdateInput {
  viewBounds: [number, number, number, number];
  playheadMs: number;
  loopStartMs: number;
  loopEndMs: number;
  texSize: [number, number];
}

interface Waiter {
  timeMs: number;
  resolve: () => void;
}

function frameMapKey(gridKey: string, timeMs: number): string {
  return `${gridKey}@${timeMs}`;
}

export class FrameStore {
  private frames = new Map<string, StoredFrame>();
  private inFlight = new Map<string, AbortController>();
  private failedTimes = new Map<number, number>();
  private waiters: Waiter[] = [];
  private currentGridKey: string | null = null;
  private previousGridKey: string | null = null;
  private lastUpdate: FrameStoreUpdateInput | null = null;
  private destroyed = false;

  constructor(private options: FrameStoreOptions) {}

  update(input: FrameStoreUpdateInput): void {
    if (this.destroyed) return;
    this.lastUpdate = input;

    const snapped = snapFetchBounds(input.viewBounds);
    const gridKey = `${snapped.map((v) => v.toFixed(0)).join(",")}|${input.texSize[0]}x${input.texSize[1]}`;

    if (gridKey !== this.currentGridKey) {
      // Keep old frames as drawable fallback; abort fetches for the old grid.
      if (this.currentGridKey !== null) {
        this.previousGridKey = this.currentGridKey;
        for (const [key, controller] of Array.from(this.inFlight)) {
          if (!key.startsWith(gridKey)) {
            controller.abort();
            this.inFlight.delete(key);
          }
        }
      }
      this.currentGridKey = gridKey;
    }

    const buffered = this.framesForGrid(gridKey).map((f) => f.timeMs);
    const now = Date.now();
    const wanted = planPrefetch({
      availableTimesMs: this.options.availableTimesMs,
      bufferedTimesMs: buffered,
      playheadMs: input.playheadMs,
      loopStartMs: input.loopStartMs,
      loopEndMs: input.loopEndMs,
    }).filter((t) => {
      const failedAt = this.failedTimes.get(t);
      return failedAt === undefined || now - failedAt >= FAILED_URL_COOLDOWN_MS;
    });

    for (const timeMs of wanted) {
      if (this.inFlight.size >= MAX_IN_FLIGHT_PER_SATELLITE) break;
      const key = frameMapKey(gridKey, timeMs);
      if (this.inFlight.has(key) || this.frames.has(key)) continue;
      this.startFetch(key, gridKey, timeMs, snapped, input.texSize);
    }

    this.evict(input.playheadMs);
  }

  private startFetch(
    key: string,
    gridKey: string,
    timeMs: number,
    mercBounds: [number, number, number, number],
    texSize: [number, number],
  ): void {
    const template = replaceTemplateTime(this.options.wmsUrlTemplate, formatWmsUtcSecond(timeMs));
    const url = buildProxiedWmsUrl(template, mercBounds, texSize[0], texSize[1]);
    if (!url) {
      this.failedTimes.set(timeMs, Date.now());
      logManager.warn("satellite", "Invalid WMS template for proxied fetch", {
        id: this.options.satelliteId,
      });
      return;
    }

    const controller = new AbortController();
    this.inFlight.set(key, controller);

    this.options
      .fetchFrame({ timeMs, url, mercBounds, texSize, signal: controller.signal })
      .then((texture) => {
        this.inFlight.delete(key);
        if (this.destroyed || controller.signal.aborted) {
          texture.destroy();
          return;
        }
        this.frames.set(key, {
          timeMs,
          gridKey,
          mercBounds,
          texture,
          width: texture.width,
          height: texture.height,
          globalFlow: null,
        });
        this.failedTimes.delete(timeMs);
        this.notifyWaiters();
        this.options.onChange?.();
        // Keep filling the buffer without waiting for the next draw call.
        if (this.lastUpdate) this.update(this.lastUpdate);
      })
      .catch((err: unknown) => {
        this.inFlight.delete(key);
        if (err instanceof DOMException && err.name === "AbortError") return;
        this.failedTimes.set(timeMs, Date.now());
        logManager.warn("satellite", "Frame fetch failed", {
          id: this.options.satelliteId,
          time: new Date(timeMs).toISOString(),
          error: err instanceof Error ? err.message : String(err),
        });
        this.options.onChange?.();
        if (this.lastUpdate && !this.destroyed) this.update(this.lastUpdate);
      });
  }

  private evict(playheadMs: number): void {
    const all = Array.from(this.frames.values());
    if (all.length <= MAX_RETAINED_FRAMES) return;

    const candidates = all.map((frame) => ({
      timeMs: frame.timeMs,
      // Protect the active grid's frames; old-grid frames go first because we
      // sort eviction by playhead distance within the unprotected set.
      protected: frame.gridKey === this.currentGridKey
        && Math.abs(frame.timeMs - playheadMs) <= this.options.frameIntervalMs * 2,
      frame,
    }));

    const evictTimes = new Set(planEviction(candidates, playheadMs));
    if (evictTimes.size === 0) return;

    // planEviction works on times; evict old-grid duplicates first for a time.
    let remaining = all.length - MAX_RETAINED_FRAMES;
    const sortedVictims = candidates
      .filter((c) => !c.protected && evictTimes.has(c.timeMs))
      .sort((a, b) => {
        const aOld = a.frame.gridKey !== this.currentGridKey ? 0 : 1;
        const bOld = b.frame.gridKey !== this.currentGridKey ? 0 : 1;
        if (aOld !== bOld) return aOld - bOld;
        return Math.abs(b.timeMs - playheadMs) - Math.abs(a.timeMs - playheadMs);
      });

    for (const victim of sortedVictims) {
      if (remaining <= 0) break;
      const key = frameMapKey(victim.frame.gridKey, victim.frame.timeMs);
      victim.frame.texture.destroy();
      this.frames.delete(key);
      remaining -= 1;
    }
  }

  private framesForGrid(gridKey: string | null): StoredFrame[] {
    if (!gridKey) return [];
    const out: StoredFrame[] = [];
    for (const frame of this.frames.values()) {
      if (frame.gridKey === gridKey) out.push(frame);
    }
    return out.sort((a, b) => a.timeMs - b.timeMs);
  }

  getBufferedRanges(): BufferedRange[] {
    return mergeBufferedRanges(
      this.framesForGrid(this.currentGridKey).map((f) => f.timeMs),
      this.options.frameIntervalMs,
    );
  }

  private isTimeBuffered(timeMs: number): boolean {
    const ranges = this.getBufferedRanges();
    return ranges.some((r) => timeMs >= r.startMs - this.options.frameIntervalMs && timeMs <= r.endMs + this.options.frameIntervalMs / 2);
  }

  whenTimeBuffered(timeMs: number): Promise<void> {
    if (this.isTimeBuffered(timeMs)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push({ timeMs, resolve });
    });
  }

  private notifyWaiters(): void {
    if (this.waiters.length === 0) return;
    const still: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (this.isTimeBuffered(waiter.timeMs)) {
        waiter.resolve();
      } else {
        still.push(waiter);
      }
    }
    this.waiters = still;
  }

  framesAt(timelineMs: number): { prev: StoredFrame; next: StoredFrame } | null {
    let frames = this.framesForGrid(this.currentGridKey);
    if (frames.length < 2 && this.previousGridKey) {
      const fallback = this.framesForGrid(this.previousGridKey);
      if (fallback.length > frames.length) frames = fallback;
    }
    if (frames.length === 0) return null;
    if (frames.length === 1) return { prev: frames[0], next: frames[0] };

    if (timelineMs <= frames[0].timeMs) return { prev: frames[0], next: frames[1] };
    if (timelineMs >= frames[frames.length - 1].timeMs) {
      return { prev: frames[frames.length - 2], next: frames[frames.length - 1] };
    }

    let lo = 0;
    let hi = frames.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].timeMs <= timelineMs) lo = mid;
      else hi = mid;
    }
    return { prev: frames[lo], next: frames[hi] };
  }

  /** Frames of the active grid in time order (for flow-pair scheduling). */
  activeFrames(): StoredFrame[] {
    return this.framesForGrid(this.currentGridKey);
  }

  activeGridKey(): string | null {
    return this.currentGridKey;
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  setTemplate(template: string, availableTimesMs: number[]): void {
    // Frames are keyed by time; overlapping times across template refreshes
    // stay valid, so the buffer is intentionally NOT cleared.
    this.options.wmsUrlTemplate = template;
    this.options.availableTimesMs = availableTimesMs;
    if (this.lastUpdate) this.update(this.lastUpdate);
  }

  destroy(): void {
    this.destroyed = true;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear();
    for (const frame of this.frames.values()) frame.texture.destroy();
    this.frames.clear();
    this.waiters = [];
  }
}
