// Star catalog data contracts.
//
// CELESTIAL-TODO: Treat this file as the single source of truth for what the renderer
// and the StarInfoCard expect. A future Gaia/HYG asset pipeline must emit JSON that
// validates against `StarCatalogEntry` exactly, so adding fields here is a breaking
// change for the asset format — bump `version` in the JSON asset accordingly.
// CELESTIAL-TODO: Add a magnitude-binned chunk format so large catalogs (~10⁵ stars)
// can be lazy-loaded by magnitude floor instead of streaming a single huge file.

/** Provenance state for a star catalog row. Mirrors backend `CosmicDataClass`. */
export type StarDataClass =
  | "seed"        // hand-curated demo data shipped with the app.
  | "catalog"     // loaded from a vendored static asset (e.g. HYG/Gaia subset).
  | "cached"      // fetched once from a remote source and stored locally.
  | "live";       // freshly fetched from a live source.

/** Where a star catalog came from. */
export type StarCatalogSource =
  | "embedded"             // the tiny in-source `BRIGHT_STARS` fallback.
  | "asset"                // a JSON asset under `/catalogs/stars/...`.
  | "hyg"                  // a vendored HYG catalog (planned).
  | "gaia"                 // a Gaia-derived subset (planned).
  | "api"                  // a future backend cache endpoint (planned).
  | "canwxlab-curated";    // anything we hand-rolled.

/**
 * A single star, normalized for renderer + StarInfoCard consumption.
 *
 * Coordinate frame: ICRS / J2000 unless `epoch` overrides it at the asset level.
 * CELESTIAL-TODO: Add `properMotionMasPerYr` + `parallaxMas` so we can apply proper
 * motion and parallax when the timeline date is far from the asset epoch.
 */
export interface StarCatalogEntry {
  /** Stable id, unique within the asset. Convention: `seed.<name>` or `hip.<id>`. */
  id: string;
  /** Common name if known (Sirius, Vega). May be absent for catalog-only entries. */
  properName?: string;
  /** Catalog cross-IDs. Keys: hip, hd, hr, gaia, tyc, bayer, flamsteed, hyg, simbad. */
  catalogIds?: Record<string, string>;
  raDeg: number;
  decDeg: number;
  apparentMag: number;
  absoluteMag?: number;
  distanceLy?: number;
  spectralType?: string;
  massSolar?: number;
  radiusSolar?: number;
  luminositySolar?: number;
  constellation?: string;
  bayer?: string;
  flamsteed?: string;
  exoplanets?: string[];
  /** Where this row came from (e.g. "hyg-3.0", "gaia-dr3", "canwxlab-curated"). */
  source: StarCatalogSource | string;
  /** Optional URL pointing at the upstream catalog or query. */
  sourceUrl?: string;
  dataClass: StarDataClass;
  notes?: string;
}

/** Top-level asset envelope. */
export interface StarCatalogAsset {
  name: string;
  version: string;
  /** Reference epoch — e.g. "J2000.0". */
  epoch: string;
  /** Reference frame — e.g. "icrs". */
  frame: string;
  generatedAt: string;
  dataClass: StarDataClass;
  source: StarCatalogSource | string;
  sourceUrl?: string;
  license: string;
  notes?: string;
  limits?: {
    magnitudeMax?: number;
    distanceLyMax?: number;
    starCount?: number;
  };
  stars: StarCatalogEntry[];
}

/** Options that gate which catalog rows the loader returns. */
export interface CatalogFilterOptions {
  /** Drop stars dimmer than this apparent magnitude. */
  apparentMagMax?: number;
  /** Drop stars further than this distance (light-years). */
  maxDistanceLy?: number;
  /** Hard upper limit on returned entries (post-filter). */
  limit?: number;
}

/** Loader result. */
export interface LoadedStarCatalog {
  /** Where we actually got the data from — for diagnostics + StarInfoCard provenance. */
  source: StarCatalogSource;
  /** The asset envelope (without `stars`) for provenance, plus per-row entries. */
  meta: Omit<StarCatalogAsset, "stars">;
  stars: StarCatalogEntry[];
  /** Soft warning surfaced to the UI (e.g. "asset missing, falling back to embedded"). */
  warning?: string;
}
