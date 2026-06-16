/** Client for server-synthesized interpolated frames (/api/v1/interp).
 *
 * The server pre-renders intermediate frames between two satellite keyframes
 * (forward-splat now, neural FILM/RIFE later) and returns a manifest of frame
 * times + image URLs. Playing those real frames is how cloud motion becomes
 * seamless video without cross-fading. When the manifest reports
 * `available: false` (no backend, or synthesis failed) the caller keeps the
 * existing shader morph — honest degradation, never a hard failure.
 */

import { API_BASE_URL } from "../../../lib/api";
import { logManager } from "../../../lib/logging";

export interface InterpFrame {
  /** Absolute timestamp of this synthesized frame, ms. */
  tMs: number;
  /** Position within the keyframe interval, (0,1). */
  frac: number;
  /** Absolute image URL for the synthesized PNG. */
  url: string;
}

export interface InterpManifest {
  available: boolean;
  frames: InterpFrame[];
}

function apiBase(): string {
  return API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
}

/** Extract the WMS LAYERS value from a GetMap URL template — the layer name the
 * interp endpoint must fetch to synthesize the displayed product. Null if the
 * template has no LAYERS parameter. */
export function wmsLayerName(template: string): string | null {
  const match = /[?&]layers=([^&]+)/i.exec(template);
  if (!match) return null;
  const value = decodeURIComponent(match[1]).split(",")[0].trim();
  return value || null;
}

function isoUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function interpManifestUrl(opts: {
  layerId: string;
  mercBounds: [number, number, number, number];
  t0Ms: number;
  t1Ms: number;
  size?: number;
  depth?: number;
}): string {
  const bbox = opts.mercBounds.map((v) => v.toFixed(1)).join(",");
  const params = new URLSearchParams({
    layer: opts.layerId,
    bbox,
    t0: isoUtc(opts.t0Ms),
    t1: isoUtc(opts.t1Ms),
    size: String(opts.size ?? 512),
    depth: String(opts.depth ?? 4),
  });
  return `${apiBase()}/api/v1/interp/manifest?${params.toString()}`;
}

/** Resolve a possibly-relative frame URL from the manifest to absolute. */
export function resolveFrameUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  return `${apiBase()}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function parseInterpManifest(body: unknown): InterpManifest {
  const obj = body as { available?: unknown; frames?: unknown };
  if (!obj || obj.available !== true || !Array.isArray(obj.frames)) {
    return { available: false, frames: [] };
  }
  const frames: InterpFrame[] = [];
  for (const raw of obj.frames as Array<{ tMs?: unknown; frac?: unknown; url?: unknown }>) {
    const tMs = Number(raw?.tMs);
    const frac = Number(raw?.frac);
    if (!Number.isFinite(tMs) || !Number.isFinite(frac) || typeof raw?.url !== "string") continue;
    frames.push({ tMs, frac, url: resolveFrameUrl(raw.url) });
  }
  frames.sort((a, b) => a.tMs - b.tMs);
  return { available: frames.length > 0, frames };
}

const inFlight = new Map<string, Promise<InterpManifest | null>>();

/** Fetch + parse an interp manifest; dedupes concurrent requests per URL.
 * Returns null on transport failure (caller falls back to the morph). */
export function fetchInterpManifest(url: string, signal?: AbortSignal): Promise<InterpManifest | null> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = (async (): Promise<InterpManifest | null> => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) return null;
      return parseInterpManifest(await response.json());
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        logManager.warn("satellite", "Interp manifest fetch failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, promise);
  return promise;
}
