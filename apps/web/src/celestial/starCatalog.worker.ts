// Star catalog Web Worker.
//
// Off-main-thread loader for larger catalogs. The current seed asset is small
// enough that the main-thread loader is fine, but we want the contract in place
// before the HYG/Gaia asset lands.
//
// Vite resolves this with `new Worker(new URL("./starCatalog.worker.ts", import.meta.url), { type: "module" })`.
// See `starCatalogLoader.ts::loadStarCatalogViaWorker` for the host-side wrapper.
//
// CELESTIAL-TODO: Switch to a magnitude-binned chunk format and stream chunks
// (postMessage per chunk) so the renderer can start drawing the brightest stars
// while the rest are still being fetched/parsed.

/// <reference lib="webworker" />

import { __internal } from "./starCatalogLoader";
import type { CatalogFilterOptions, StarCatalogAsset } from "./starCatalogTypes";

interface WorkerRequest {
  id: number;
  assetUrl: string;
  filter: CatalogFilterOptions;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  warning?: string;
  meta?: Omit<StarCatalogAsset, "stars">;
  stars?: ReturnType<typeof __internal.normalizeEntry>[];
  error?: string;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  try {
    const response = await fetch(req.assetUrl);
    if (!response.ok) {
      const reply: WorkerResponse = {
        id: req.id,
        ok: false,
        error: `Asset request failed: HTTP ${response.status}`,
      };
      ctx.postMessage(reply);
      return;
    }
    const raw = (await response.json()) as Partial<StarCatalogAsset>;
    if (!raw || !Array.isArray(raw.stars)) {
      const reply: WorkerResponse = {
        id: req.id,
        ok: false,
        error: "Invalid StarCatalogAsset payload",
      };
      ctx.postMessage(reply);
      return;
    }
    const normalized = raw.stars
      .map(__internal.normalizeEntry)
      .filter((s): s is NonNullable<ReturnType<typeof __internal.normalizeEntry>> => s !== null);
    const filtered = __internal.filterEntries(normalized, req.filter);

    const meta: Omit<StarCatalogAsset, "stars"> = {
      name: raw.name ?? "unknown-asset",
      version: raw.version ?? "0.0.0",
      epoch: raw.epoch ?? "J2000.0",
      frame: raw.frame ?? "icrs",
      generatedAt: raw.generatedAt ?? "",
      dataClass: raw.dataClass ?? "catalog",
      source: raw.source ?? "asset",
      sourceUrl: raw.sourceUrl,
      license: raw.license ?? "unspecified",
      notes: raw.notes,
      limits: raw.limits,
    };

    const reply: WorkerResponse = {
      id: req.id,
      ok: true,
      meta,
      stars: filtered,
    };
    ctx.postMessage(reply);
  } catch (err) {
    const reply: WorkerResponse = {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(reply);
  }
});

export type { WorkerRequest, WorkerResponse };
