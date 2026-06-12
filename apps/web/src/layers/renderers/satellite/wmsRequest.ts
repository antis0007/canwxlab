/** WMS URL construction and image loading for satellite frames.
 *
 * Extracted from satelliteComposite.ts so the FrameStore can build proxied
 * requests without depending on the deck.gl layer module.
 */

import { API_BASE_URL } from "../../../lib/api";
import { cachedGetImageBlob } from "../../../lib/localCache";

export const RETRY_DELAYS_MS = [500, 1500, 4500];
export const FAILED_URL_COOLDOWN_MS = 5 * 60 * 1000;

export function parseUrl(value: string): URL {
  const fallbackBase = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return new URL(value, fallbackBase);
}

export function templateTimeMs(template: string | null): number | null {
  if (!template) return null;

  try {
    const parsed = parseUrl(template);
    const raw = parsed.searchParams.get("TIME") ?? parsed.searchParams.get("time");
    if (!raw) return null;

    const value = Date.parse(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    const match = /[?&]time=([^&]+)/i.exec(template);
    if (!match) return null;

    const value = Date.parse(decodeURIComponent(match[1]));
    return Number.isFinite(value) ? value : null;
  }
}

export function replaceTemplateTime(template: string, isoTime: string): string {
  try {
    const parsed = parseUrl(template);

    if (parsed.searchParams.has("TIME")) {
      parsed.searchParams.set("TIME", isoTime);
    } else if (parsed.searchParams.has("time")) {
      parsed.searchParams.set("time", isoTime);
    }

    return parsed.toString().replace(/%7Bbbox-epsg-3857%7D/gi, "{bbox-epsg-3857}");
  } catch {
    return template.replace(/([?&]time=)[^&]+/i, `$1${encodeURIComponent(isoTime)}`);
  }
}

function serializeMercatorBbox(bounds: [number, number, number, number]): string | null {
  if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) return null;
  return bounds.map((value) => value.toFixed(1)).join(",");
}

function isValidBbox(value: string): boolean {
  const parts = value.split(",");
  return parts.length === 4 && parts.every((part) => Number.isFinite(Number(part.trim())));
}

function apiUrl(path: string): string {
  try {
    const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
    return new URL(path.replace(/^\//, ""), base).toString();
  } catch {
    const left = API_BASE_URL.endsWith("/") ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    const right = path.startsWith("/") ? path : `/${path}`;
    return `${left}${right}`;
  }
}

function buildWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string {
  const bbox = `${mercBounds[0].toFixed(1)},${mercBounds[1].toFixed(1)},${mercBounds[2].toFixed(1)},${mercBounds[3].toFixed(1)}`;
  return template
    .replace(/\{bbox-epsg-3857\}/g, bbox)
    .replace(/WIDTH=\d+/i, `WIDTH=${width}`)
    .replace(/HEIGHT=\d+/i, `HEIGHT=${height}`);
}

export function buildProxiedWmsUrl(
  template: string,
  mercBounds: [number, number, number, number],
  width: number,
  height: number,
): string | null {
  const directUrl = buildWmsUrl(template, mercBounds, width, height);

  try {
    const source = parseUrl(directUrl);
    const proxy = new URL(apiUrl("/api/eccc/wms/image"));

    const get = (...keys: string[]) => {
      for (const key of keys) {
        const value = source.searchParams.get(key);
        if (value !== null && value !== "") return value;
      }
      return "";
    };

    const layerName = get("LAYERS", "layers");
    const bbox = serializeMercatorBbox(mercBounds) ?? get("BBOX", "bbox");

    if (!layerName || !bbox || !isValidBbox(bbox)) return null;

    proxy.searchParams.set("layer_name", layerName);
    proxy.searchParams.set("bbox", bbox);
    proxy.searchParams.set("width", get("WIDTH", "width") || String(width));
    proxy.searchParams.set("height", get("HEIGHT", "height") || String(height));
    proxy.searchParams.set("crs", get("CRS", "SRS", "crs") || "EPSG:3857");
    proxy.searchParams.set("format", get("FORMAT", "format") || "image/png");
    proxy.searchParams.set("transparent", get("TRANSPARENT", "transparent") || "TRUE");

    const styles = get("STYLES", "styles", "STYLE", "style");
    if (styles) proxy.searchParams.set("style", styles);

    const time = get("TIME", "time");
    if (time) proxy.searchParams.set("time", time);

    return proxy.toString();
  } catch {
    return null;
  }
}

async function loadImage(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  // Long TTL: satellite frames are immutable once published (a frame for a
  // given TIME never changes), so cached copies stay valid for a week and
  // serve as the historical archive after upstream retention expires.
  const response = await cachedGetImageBlob(url, signal, {
    ttlMs: 7 * 24 * 60 * 60 * 1000,
    staleIfErrorMs: 30 * 24 * 60 * 60 * 1000,
  });

  if (!response.ok) {
    const error = new Error(`WMS image request failed ${response.status}: ${url.slice(0, 120)}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`WMS proxy returned ${contentType || "non-image"} for ${url.slice(0, 120)}`);
  }

  const blob = await response.blob();
  return createImageBitmap(blob);
}

export async function loadImageWithRetry(url: string, signal: AbortSignal): Promise<ImageBitmap> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await loadImage(url, signal);
    } catch (err) {
      if (signal.aborted) throw err;
      lastError = err;

      const status = typeof (err as { status?: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;

      if (status !== null && status >= 400 && status < 600) break;

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;

      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, delay);

        const onAbort = () => {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };

        signal.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("WMS image request failed");
}
