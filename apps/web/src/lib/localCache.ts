const API_CACHE_NAME = "canwxlab-api-v1";
const IMAGE_CACHE_NAME = "canwxlab-images-v1";
const META_PREFIX = "canwxlab.cache.meta.";

export interface CachePolicy {
  ttlMs: number;
  staleIfErrorMs?: number;
}

function hasCacheStorage(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function keyFor(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${META_PREFIX}${(hash >>> 0).toString(36)}`;
}

function readExpiry(url: string): number | null {
  try {
    const raw = window.localStorage.getItem(keyFor(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: unknown };
    return typeof parsed.expiresAt === "number" ? parsed.expiresAt : null;
  } catch {
    return null;
  }
}

function writeExpiry(url: string, expiresAt: number): void {
  try {
    window.localStorage.setItem(keyFor(url), JSON.stringify({ expiresAt }));
  } catch {
    /* local storage may be unavailable in private contexts */
  }
}

async function cachedResponse(
  cacheName: string,
  url: string,
  policy: CachePolicy,
  init?: RequestInit,
): Promise<Response> {
  if (!hasCacheStorage() || policy.ttlMs <= 0) {
    return fetch(url, init);
  }

  const cache = await window.caches.open(cacheName);
  const request = new Request(url, { method: "GET" });
  const cached = await cache.match(request);
  const expiresAt = readExpiry(url);
  const now = Date.now();
  if (cached && expiresAt !== null && now < expiresAt) {
    return cached.clone();
  }

  try {
    const response = await fetch(url, init);
    if (response.ok) {
      await cache.put(request, response.clone());
      writeExpiry(url, now + policy.ttlMs);
    }
    return response;
  } catch (err) {
    if (cached && expiresAt !== null && now < expiresAt + (policy.staleIfErrorMs ?? 0)) {
      return cached.clone();
    }
    throw err;
  }
}

export async function cachedGetJson<T>(url: string, policy: CachePolicy): Promise<T> {
  const response = await cachedResponse(API_CACHE_NAME, url, policy);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${url}`);
  }
  return response.json() as Promise<T>;
}

export async function cachedGetImageBlob(
  url: string,
  signal: AbortSignal,
  policy: CachePolicy,
): Promise<Response> {
  return cachedResponse(IMAGE_CACHE_NAME, url, policy, {
    signal,
    mode: "cors",
    cache: "force-cache",
  });
}
