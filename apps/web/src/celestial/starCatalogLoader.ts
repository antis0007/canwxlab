// Star catalog loader.
//
// Loads the public seed asset (and, eventually, larger HYG/Gaia chunks) from
// `/catalogs/stars/...`, normalizes the rows, applies basic filters, and returns
// a render-ready list with provenance.
//
// CELESTIAL-TODO: Move filtering off the main thread by routing through
// `starCatalog.worker.ts` once the asset grows past ~3k stars; the worker
// already implements the same `filterEntries`/`normalizeEntry` contract.
// CELESTIAL-TODO: Add magnitude-binned chunk loading: request
// `/catalogs/stars/hyg/mag-{n}.json` lazily as the user zooms / dims exposure.

import type {
  CatalogFilterOptions,
  LoadedStarCatalog,
  StarCatalogAsset,
  StarCatalogEntry,
  StarCatalogSource,
} from "./starCatalogTypes";

const DEFAULT_ASSET_URL = "/catalogs/stars/bright_stars_seed.json";

/** A minimal embedded fallback so the starfield is never blank if the asset fails. */
const EMBEDDED_FALLBACK: StarCatalogEntry[] = [
  {
    id: "embedded.sirius",
    properName: "Sirius",
    raDeg: 101.287,
    decDeg: -16.716,
    apparentMag: -1.46,
    distanceLy: 8.6,
    spectralType: "A1V",
    constellation: "Canis Major",
    bayer: "α CMa",
    source: "embedded",
    dataClass: "seed",
  },
  {
    id: "embedded.vega",
    properName: "Vega",
    raDeg: 279.234,
    decDeg: 38.784,
    apparentMag: 0.03,
    distanceLy: 25.04,
    spectralType: "A0V",
    constellation: "Lyra",
    bayer: "α Lyr",
    source: "embedded",
    dataClass: "seed",
  },
  {
    id: "embedded.polaris",
    properName: "Polaris",
    raDeg: 37.955,
    decDeg: 89.264,
    apparentMag: 1.98,
    distanceLy: 433,
    spectralType: "F7Ib",
    constellation: "Ursa Minor",
    bayer: "α UMi",
    source: "embedded",
    dataClass: "seed",
  },
];

const EMBEDDED_META: Omit<StarCatalogAsset, "stars"> = {
  name: "canwxlab-embedded-fallback",
  version: "0.0.0",
  epoch: "J2000.0",
  frame: "icrs",
  generatedAt: "2026-05-15T00:00:00Z",
  dataClass: "seed",
  source: "embedded",
  license: "Embedded fallback only.",
};

/** Light validation: drop rows missing required astrometric fields. */
export function normalizeEntry(raw: unknown): StarCatalogEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const raDeg = typeof r.raDeg === "number" ? r.raDeg : null;
  const decDeg = typeof r.decDeg === "number" ? r.decDeg : null;
  const apparentMag = typeof r.apparentMag === "number" ? r.apparentMag : null;
  if (id === null || raDeg === null || decDeg === null || apparentMag === null) return null;
  if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || !Number.isFinite(apparentMag)) return null;
  if (raDeg < 0 || raDeg > 360) return null;
  if (decDeg < -90 || decDeg > 90) return null;

  const out: StarCatalogEntry = {
    id,
    raDeg,
    decDeg,
    apparentMag,
    source: (typeof r.source === "string" ? r.source : "asset") as StarCatalogSource | string,
    dataClass: (typeof r.dataClass === "string" ? r.dataClass : "catalog") as StarCatalogEntry["dataClass"],
  };
  if (typeof r.properName === "string") out.properName = r.properName;
  if (r.catalogIds && typeof r.catalogIds === "object") {
    out.catalogIds = r.catalogIds as Record<string, string>;
  }
  if (typeof r.absoluteMag === "number") out.absoluteMag = r.absoluteMag;
  if (typeof r.distanceLy === "number") out.distanceLy = r.distanceLy;
  if (typeof r.spectralType === "string") out.spectralType = r.spectralType;
  if (typeof r.massSolar === "number") out.massSolar = r.massSolar;
  if (typeof r.radiusSolar === "number") out.radiusSolar = r.radiusSolar;
  if (typeof r.luminositySolar === "number") out.luminositySolar = r.luminositySolar;
  if (typeof r.constellation === "string") out.constellation = r.constellation;
  if (typeof r.bayer === "string") out.bayer = r.bayer;
  if (typeof r.flamsteed === "string") out.flamsteed = r.flamsteed;
  if (Array.isArray(r.exoplanets)) {
    out.exoplanets = r.exoplanets.filter((x): x is string => typeof x === "string");
  }
  if (typeof r.sourceUrl === "string") out.sourceUrl = r.sourceUrl;
  if (typeof r.notes === "string") out.notes = r.notes;
  return out;
}

export function filterEntries(
  entries: StarCatalogEntry[],
  opts: CatalogFilterOptions,
): StarCatalogEntry[] {
  const magCap = opts.apparentMagMax ?? Number.POSITIVE_INFINITY;
  const distCap = opts.maxDistanceLy ?? Number.POSITIVE_INFINITY;
  const filtered = entries.filter((s) => {
    if (s.apparentMag > magCap) return false;
    if (s.distanceLy != null && s.distanceLy > distCap) return false;
    return true;
  });
  // Sort by apparent magnitude (brightest first) so a hard `limit` keeps the most
  // visually important stars.
  filtered.sort((a, b) => a.apparentMag - b.apparentMag);
  if (typeof opts.limit === "number" && opts.limit > 0 && filtered.length > opts.limit) {
    filtered.length = opts.limit;
  }
  return filtered;
}

interface FetchLike {
  (input: string, init?: { signal?: AbortSignal }): Promise<{ ok: boolean; json: () => Promise<unknown> }>;
}

export interface LoadOptions extends CatalogFilterOptions {
  /** Override the asset URL — useful in tests. */
  assetUrl?: string;
  /** Inject a fetcher (Node tests). Defaults to global fetch. */
  fetchImpl?: FetchLike;
  /** Abort signal to cancel an in-flight load. */
  signal?: AbortSignal;
}

/**
 * Load the star catalog asset and return normalized, filtered entries.
 *
 * Falls back to the embedded seed list if the asset cannot be fetched or fails
 * validation — in that case the result carries a `warning` and `source = "embedded"`.
 */
export async function loadStarCatalog(opts: LoadOptions = {}): Promise<LoadedStarCatalog> {
  const url = opts.assetUrl ?? DEFAULT_ASSET_URL;
  const fetchImpl = opts.fetchImpl ?? (typeof fetch !== "undefined" ? (fetch as FetchLike) : null);

  if (!fetchImpl) {
    return embeddedFallback("No fetch implementation available; using embedded seed stars.");
  }

  try {
    const response = await fetchImpl(url, { signal: opts.signal });
    if (!response.ok) {
      return embeddedFallback(`Asset request failed (HTTP not OK) — embedded fallback in use.`);
    }
    const raw = (await response.json()) as Partial<StarCatalogAsset>;
    if (!raw || !Array.isArray(raw.stars)) {
      return embeddedFallback("Asset payload is not a valid StarCatalogAsset; embedded fallback in use.");
    }
    const normalized = raw.stars
      .map(normalizeEntry)
      .filter((s): s is StarCatalogEntry => s !== null);
    const filtered = filterEntries(normalized, opts);

    const meta: Omit<StarCatalogAsset, "stars"> = {
      name: typeof raw.name === "string" ? raw.name : "unknown-asset",
      version: typeof raw.version === "string" ? raw.version : "0.0.0",
      epoch: typeof raw.epoch === "string" ? raw.epoch : "J2000.0",
      frame: typeof raw.frame === "string" ? raw.frame : "icrs",
      generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : "",
      dataClass: (raw.dataClass as StarCatalogEntry["dataClass"]) ?? "catalog",
      source: (raw.source as StarCatalogSource | string) ?? "asset",
      sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
      license: typeof raw.license === "string" ? raw.license : "unspecified",
      notes: typeof raw.notes === "string" ? raw.notes : undefined,
      limits: raw.limits,
    };

    return {
      source: "asset",
      meta,
      stars: filtered,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return embeddedFallback(`Asset load threw (${msg}); embedded fallback in use.`);
  }
}

function embeddedFallback(warning: string): LoadedStarCatalog {
  return {
    source: "embedded",
    meta: EMBEDDED_META,
    stars: [...EMBEDDED_FALLBACK],
    warning,
  };
}

/** Internal export for the worker so both paths use the same normalize/filter logic. */
export const __internal = { normalizeEntry, filterEntries, EMBEDDED_FALLBACK, EMBEDDED_META };
