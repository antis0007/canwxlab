/** Playback controller for server-synthesized interpolated frames.
 *
 * Owns one keyframe interval at a time: fetches its manifest, decodes the
 * synthesized PNGs to GPU textures, and answers `frameAt(timelineMs)` with the
 * nearest synthesized frame. The composite binds that frame statically for the
 * satellite slot (prev == next, phase 0), so playback is a real flip-book of
 * synthesized frames — no shader morph, no cross-fade. When nothing is ready it
 * returns null and the caller keeps the morph.
 *
 * Scheduling (pair-change detection, nearest-frame lookup) is pure and tested;
 * fetch + decode are injected so the controller is exercised without network
 * or GPU.
 */

import type { FrameTexture } from "./frameStore";
import {
  fetchInterpManifest,
  interpManifestUrl,
  type InterpManifest,
} from "./interpFrames";

export interface InterpPair {
  layerId: string;
  mercBounds: [number, number, number, number];
  t0Ms: number;
  t1Ms: number;
  size?: number;
  depth?: number;
}

export interface InterpFrameTexture {
  tMs: number;
  texture: FrameTexture;
  mercBounds: [number, number, number, number];
}

export interface InterpPlaybackOptions {
  decode: (url: string, signal: AbortSignal) => Promise<FrameTexture>;
  fetchManifest?: (url: string, signal?: AbortSignal) => Promise<InterpManifest | null>;
  onChange?: () => void;
}

export function pairKeyOf(pair: InterpPair): string {
  const bbox = pair.mercBounds.map((v) => v.toFixed(1)).join(",");
  return `${pair.layerId}|${bbox}|${pair.t0Ms}-${pair.t1Ms}|${pair.size ?? 512}|${pair.depth ?? 4}`;
}

/** Nearest synthesized frame to `timelineMs`, or null if the list is empty.
 * Frames must be sorted ascending by tMs. O(log n) binary search. */
export function nearestFrame(
  frames: InterpFrameTexture[],
  timelineMs: number,
): InterpFrameTexture | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].tMs < timelineMs) lo = mid + 1;
    else hi = mid;
  }
  const cand = frames[lo];
  const prev = lo > 0 ? frames[lo - 1] : null;
  if (prev && Math.abs(prev.tMs - timelineMs) <= Math.abs(cand.tMs - timelineMs)) return prev;
  return cand;
}

export class InterpPlayback {
  private pairKey: string | null = null;
  private pair: InterpPair | null = null;
  private frames: InterpFrameTexture[] = [];
  private controller: AbortController | null = null;
  private readyFlag = false;
  private fetchManifest: NonNullable<InterpPlaybackOptions["fetchManifest"]>;

  constructor(private options: InterpPlaybackOptions) {
    this.fetchManifest = options.fetchManifest ?? fetchInterpManifest;
  }

  /** Point the controller at a keyframe interval. A no-op if unchanged; on a
   * new interval it aborts the old load and starts fetching the new one. */
  update(pair: InterpPair): void {
    const key = pairKeyOf(pair);
    if (key === this.pairKey) return;
    this.reset();
    this.pairKey = key;
    this.pair = pair;
    void this.load(pair, key);
  }

  /** True once at least one synthesized frame is decoded for the current pair. */
  ready(): boolean {
    return this.readyFlag;
  }

  frameAt(timelineMs: number): InterpFrameTexture | null {
    if (!this.pair) return null;
    if (timelineMs < this.pair.t0Ms || timelineMs > this.pair.t1Ms) return null;
    return nearestFrame(this.frames, timelineMs);
  }

  dispose(): void {
    this.reset();
  }

  private reset(): void {
    this.controller?.abort();
    this.controller = null;
    for (const f of this.frames) f.texture.destroy();
    this.frames = [];
    this.pairKey = null;
    this.pair = null;
    this.readyFlag = false;
  }

  private async load(pair: InterpPair, key: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const url = interpManifestUrl(pair);
    const manifest = await this.fetchManifest(url, controller.signal);
    if (controller.signal.aborted || this.pairKey !== key) return;
    if (!manifest || !manifest.available) return; // caller keeps the morph

    for (const frame of manifest.frames) {
      try {
        const texture = await this.options.decode(frame.url, controller.signal);
        if (controller.signal.aborted || this.pairKey !== key) {
          texture.destroy();
          return;
        }
        // Insert sorted by time so frameAt's binary search stays valid.
        const entry: InterpFrameTexture = { tMs: frame.tMs, texture, mercBounds: pair.mercBounds };
        const at = this.frames.findIndex((f) => f.tMs > entry.tMs);
        if (at < 0) this.frames.push(entry);
        else this.frames.splice(at, 0, entry);
        this.readyFlag = true;
        this.options.onChange?.();
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Skip a frame that failed to decode; the rest still play.
      }
    }
  }
}
