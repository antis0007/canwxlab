/** Client for the server-side shared motion field (/api/motion/field).
 *
 * The server computes dense optical flow ONCE per frame pair from a
 * continuous IR product and serves it in the exact RGBA packing the morph
 * shader reads (rg = flow UV, b = confidence, a = occlusion). The same field
 * drives every displayed product — including categorical colormaps that
 * defeat client-side flow estimation. Raw bytes: no image decode, straight
 * to texture upload.
 */

import { API_BASE_URL } from "../../../lib/api";
import { logManager } from "../../../lib/logging";

export interface ServerMotionField {
  width: number;
  height: number;
  data: Uint8Array;
}

export function motionSatelliteFor(layerId: string): "goes-east" | "goes-west" | null {
  const normalized = layerId.toLowerCase();
  if (normalized.includes("goes_east") || normalized.includes("goes-east")) return "goes-east";
  if (normalized.includes("goes_west") || normalized.includes("goes-west")) return "goes-west";
  return null;
}

export function motionFieldUrl(opts: {
  satellite: "goes-east" | "goes-west";
  mercBounds: [number, number, number, number];
  t0Ms: number;
  t1Ms: number;
  size?: number;
}): string {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  const bbox = opts.mercBounds.map((v) => v.toFixed(1)).join(",");
  const params = new URLSearchParams({
    satellite: opts.satellite,
    bbox,
    t0: new Date(opts.t0Ms).toISOString().replace(/\.\d{3}Z$/, "Z"),
    t1: new Date(opts.t1Ms).toISOString().replace(/\.\d{3}Z$/, "Z"),
    size: String(opts.size ?? 256),
  });
  return `${base}/api/motion/field?${params.toString()}`;
}

const inFlight = new Map<string, Promise<ServerMotionField | null>>();

/** Fetch a motion field; deduplicates concurrent requests per pair URL.
 * Returns null on any failure — callers keep their client-side fallback. */
export function fetchMotionField(url: string, signal?: AbortSignal): Promise<ServerMotionField | null> {
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = (async (): Promise<ServerMotionField | null> => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok) return null;
      const width = Number(response.headers.get("X-Motion-Width"));
      const height = Number(response.headers.get("X-Motion-Height"));
      const buffer = await response.arrayBuffer();
      if (!Number.isFinite(width) || !Number.isFinite(height) || buffer.byteLength !== width * height * 4) {
        return null;
      }
      return { width, height, data: new Uint8Array(buffer) };
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        logManager.warn("satellite", "Server motion field fetch failed", {
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
