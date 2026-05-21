import type { CameraState } from "../layers/types";
import type {
  PlanetaryClaim,
  PlanetaryDataClass,
  PlanetaryEvent,
  PlanetaryQuery,
  PlanetarySourceCategory,
  PlanetaryViewIntent,
  PlanetaryViewPlan,
  SourceContractView,
  SourceDefinition,
  WorldDiff,
} from "../types/planetary";
import type { DataSource } from "../types/weather";

const OPEN_LICENSE = {
  label: "Open data",
  attributionRequired: true,
  redistributionAllowed: true,
  commercialUseAllowed: true,
  retentionAllowed: true,
};

export const PLANETARY_SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    id: "eccc-geomet",
    name: "MSC GeoMet",
    category: "weather",
    access: {
      method: "ogc",
      auth: "none",
      endpoint: "https://api.weather.gc.ca",
      costPolicy: {
        cacheBeforeUse: true,
        requireUserActionForExpensiveFetch: false,
      },
    },
    legal: {
      ...OPEN_LICENSE,
      label: "Government of Canada Open Data",
      url: "https://open.canada.ca/en/open-government-licence-canada",
    },
    freshness: {
      updateCadenceSeconds: 300,
      expectedLatencySeconds: 120,
      historicalDepth: "varies by collection",
      staleAfterSeconds: 900,
    },
    schema: {
      nativeFormat: "OGC API / WMS",
      outputTypes: ["field", "asset", "observation", "event"],
      spatialReference: "EPSG:4326 / Web Mercator products",
      temporalField: "datetime",
    },
    reliability: {
      trustTier: 5,
      validationRules: ["time extent must parse", "coverage must intersect query bbox", "license snapshot required"],
      knownFailureModes: ["collection-specific temporal gaps", "WMS layer unavailable", "latest frame delayed"],
    },
  },
  {
    id: "paid-weather-archive",
    name: "Costed Weather Archive",
    category: "weather",
    access: {
      method: "api",
      auth: "paid",
      costPolicy: {
        maxSpendPerHourUsd: 100,
        costPerHistoricalHourUsd: 100,
        cacheBeforeUse: true,
        requireUserActionForExpensiveFetch: true,
      },
    },
    legal: {
      label: "Contract restricted",
      attributionRequired: true,
      redistributionAllowed: false,
      commercialUseAllowed: true,
      retentionAllowed: false,
    },
    freshness: {
      updateCadenceSeconds: 3600,
      historicalDepth: "paid historical retrieval",
      staleAfterSeconds: 86400,
    },
    schema: {
      nativeFormat: "provider API",
      outputTypes: ["field", "observation", "asset"],
      temporalField: "valid_time",
    },
    reliability: {
      trustTier: 4,
      validationRules: ["server-side fetch only", "cost token required", "cache hit checked before request"],
      knownFailureModes: ["budget exceeded", "retention disallowed", "narrow recent-history window"],
    },
  },
  {
    id: "osm-base",
    name: "OpenStreetMap",
    category: "infrastructure",
    access: {
      method: "api",
      auth: "none",
      costPolicy: {
        cacheBeforeUse: true,
        requireUserActionForExpensiveFetch: false,
      },
    },
    legal: {
      ...OPEN_LICENSE,
      label: "ODbL",
      url: "https://www.openstreetmap.org/copyright",
    },
    freshness: {
      updateCadenceSeconds: 86400,
      historicalDepth: "planet snapshots",
      staleAfterSeconds: 604800,
    },
    schema: {
      nativeFormat: "OSM PBF",
      outputTypes: ["entity", "asset"],
      spatialReference: "EPSG:4326",
    },
    reliability: {
      trustTier: 4,
      validationRules: ["geometry validity", "tag normalization", "feature LOD classification"],
      knownFailureModes: ["tag inconsistency", "regional coverage variation"],
    },
  },
  {
    id: "stac-earth-observation",
    name: "Earth Observation STAC",
    category: "satellite",
    access: {
      method: "stac",
      auth: "api-key",
      costPolicy: {
        cacheBeforeUse: true,
        requireUserActionForExpensiveFetch: false,
      },
    },
    legal: {
      label: "Collection-specific",
      attributionRequired: true,
      redistributionAllowed: false,
      retentionAllowed: true,
    },
    freshness: {
      updateCadenceSeconds: 1800,
      expectedLatencySeconds: 900,
      historicalDepth: "collection-specific",
      staleAfterSeconds: 7200,
    },
    schema: {
      nativeFormat: "STAC + COG/Zarr",
      outputTypes: ["asset", "field", "claim"],
      spatialReference: "EPSG:4326 item geometry",
      temporalField: "datetime",
    },
    reliability: {
      trustTier: 4,
      validationRules: ["asset checksum required", "cloud cover quality gate", "lineage required for derived products"],
      knownFailureModes: ["cloud cover", "late acquisitions", "collection license mismatch"],
    },
  },
  {
    id: "public-bulletins",
    name: "Public Bulletins",
    category: "documents",
    access: {
      method: "rss",
      auth: "none",
      costPolicy: {
        cacheBeforeUse: true,
        requireUserActionForExpensiveFetch: false,
      },
    },
    legal: {
      label: "Source-specific",
      attributionRequired: true,
      redistributionAllowed: false,
      retentionAllowed: true,
    },
    freshness: {
      updateCadenceSeconds: 600,
      staleAfterSeconds: 3600,
    },
    schema: {
      nativeFormat: "RSS/HTML/PDF",
      outputTypes: ["claim", "event", "asset"],
      temporalField: "published_at",
    },
    reliability: {
      trustTier: 3,
      validationRules: ["claims require provenance", "geocoding confidence required", "unverified rendering by default"],
      knownFailureModes: ["ambiguous place names", "duplicate articles", "stale reposts"],
    },
  },
];

const INTENT_SOURCE_CATEGORIES: Record<PlanetaryViewIntent, PlanetarySourceCategory[]> = {
  "situational-awareness": ["weather", "satellite", "environment", "infrastructure", "documents"],
  weather: ["weather", "satellite", "environment"],
  "transport-risk": ["weather", "transport", "infrastructure", "documents"],
  infrastructure: ["infrastructure", "government", "weather"],
  environment: ["environment", "weather", "satellite", "science"],
  news: ["news", "documents", "government"],
  science: ["science", "satellite", "environment"],
  all: ["weather", "satellite", "transport", "infrastructure", "environment", "government", "science", "documents", "news", "iot"],
};

export const PLANETARY_SAMPLE_EVENTS: PlanetaryEvent[] = [
  {
    id: "evt-weather-risk",
    type: "weather-risk",
    geometry: { type: "Point", coordinates: [-114.0719, 51.0447] },
    startTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    status: "estimated",
    severity: 0.64,
    sourceIds: ["eccc-geomet"],
    evidenceIds: ["field-radar-current", "obs-surface-network"],
    confidence: 0.82,
  },
  {
    id: "evt-archive-budget",
    type: "cost-control",
    geometry: { type: "Point", coordinates: [-75.6972, 45.4215] },
    startTime: new Date().toISOString(),
    status: "confirmed",
    severity: 0.72,
    sourceIds: ["paid-weather-archive"],
    evidenceIds: ["cost-policy-paid-weather-archive"],
    confidence: 0.95,
  },
  {
    id: "evt-source-claim",
    type: "public-report",
    geometry: { type: "Point", coordinates: [-123.1207, 49.2827] },
    startTime: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    status: "reported",
    severity: 0.38,
    sourceIds: ["public-bulletins"],
    evidenceIds: ["claim-transport-delay"],
    confidence: 0.57,
  },
];

export const PLANETARY_SAMPLE_CLAIMS: PlanetaryClaim[] = [
  {
    id: "claim-transport-delay",
    subject: "regional transport corridor",
    predicate: "may be affected by",
    object: "weather and visibility constraints",
    location: { type: "Point", coordinates: [-123.1207, 49.2827] },
    sourceId: "public-bulletins",
    extractionMethod: "llm",
    confidence: 0.57,
    evidenceText: "Unverified document-derived claim; requires corroboration before operational rendering.",
  },
];

export const PLANETARY_SAMPLE_DIFFS: WorldDiff[] = [
  {
    id: "diff-source-state",
    changeType: "status-changed",
    before: "unknown",
    after: "source registry normalized",
    time: new Date().toISOString(),
    significance: 0.7,
    sourceIds: ["eccc-geomet", "paid-weather-archive"],
  },
  {
    id: "diff-cache-policy",
    changeType: "attribute-changed",
    before: "direct fetch",
    after: "cache-before-use",
    time: new Date().toISOString(),
    significance: 0.86,
    sourceIds: ["paid-weather-archive"],
  },
];

export function buildPlanetaryQuery(input: {
  cameraState: CameraState;
  selectedTime: string;
  intent: PlanetaryViewIntent;
  minConfidence: number;
  includePredictions: boolean;
  includeUnverifiedReports: boolean;
}): PlanetaryQuery {
  const zoom = Math.max(0, input.cameraState.zoom);
  const span = Math.max(0.08, 80 / 2 ** Math.min(zoom, 12));
  const halfLon = span;
  const halfLat = span * 0.58;
  const centerLon = input.cameraState.longitude;
  const centerLat = input.cameraState.latitude;
  const selectedMs = new Date(input.selectedTime).getTime();
  const safeMs = Number.isFinite(selectedMs) ? selectedMs : Date.now();

  return {
    bbox: [
      Math.max(-180, centerLon - halfLon),
      Math.max(-85, centerLat - halfLat),
      Math.min(180, centerLon + halfLon),
      Math.min(85, centerLat + halfLat),
    ],
    timeRange: {
      start: new Date(safeMs - 24 * 60 * 60 * 1000).toISOString(),
      end: new Date(safeMs + 48 * 60 * 60 * 1000).toISOString(),
    },
    intent: input.intent,
    maxLatencyMs: zoom >= 8 ? 450 : 750,
    maxResults: zoom >= 8 ? 180 : 90,
    quality: {
      minConfidence: input.minConfidence,
      includePredictions: input.includePredictions,
      includeUnverifiedReports: input.includeUnverifiedReports,
    },
    lod: {
      zoom,
      screenSize: [1440, 900],
      densityBudget: zoom >= 8 ? 240 : 120,
    },
  };
}

export function buildPlanetaryViewPlan(input: {
  query: PlanetaryQuery;
  liveSources?: DataSource[];
  sourceContracts?: SourceContractView[];
  activeLayerCount: number;
}): PlanetaryViewPlan {
  const categories = INTENT_SOURCE_CATEGORIES[input.query.intent];
  const registry = input.sourceContracts ?? buildSourceContractViews(input.liveSources ?? []);
  const requiredSources = registry
    .filter((source) => categories.includes(source.category))
    .map((source) => source.id);
  const liveSourceIds = new Set(registry.filter((source) => source.runtimeStatus === "live" || source.runtimeStatus === "stale").map((source) => source.id));
  const warnings: string[] = [];

  if (requiredSources.includes("paid-weather-archive")) {
    warnings.push("Paid archive is gated behind cache-before-use and explicit cost approval.");
  }
  if (!input.query.quality.includeUnverifiedReports) {
    warnings.push("Unverified document claims are suppressed from operational batches.");
  }
  if (input.activeLayerCount > 8) {
    warnings.push("Layer stack is dense; query planner should reduce semantic LOD before adding more overlays.");
  }

  const dataClasses: PlanetaryDataClass[] = ["observed", "derived"];
  if (input.query.quality.includePredictions) dataClasses.push("predicted");
  if (input.query.quality.includeUnverifiedReports) dataClasses.push("unverified");
  if (registry.some((source) => source.runtimeStatus === "stale" || source.runtimeStatus === "fallback")) dataClasses.push("stale");

  return {
    vectorTiles: [
      "base/infrastructure/{z}/{x}/{y}.mvt",
      "events/current/{z}/{x}/{y}.mvt",
    ],
    rasterTiles: requiredSources.includes("eccc-geomet")
      ? ["weather/fields/current/{z}/{x}/{y}.ktx2", "satellite/cloud-motion/{z}/{x}/{y}.ktx2"]
      : [],
    entityBatches: ["entities/by-cell-and-time"],
    eventBatches: ["events/by-bbox-time-confidence"],
    timeseries: requiredSources.some((id) => liveSourceIds.has(id) || id === "eccc-geomet")
      ? ["observations/recent-window"]
      : [],
    documentSnippets: requiredSources.includes("public-bulletins") ? ["claims/source-evidence"] : [],
    legends: ["confidence", "freshness", "source-status"],
    warnings,
    requiredSources,
    dataClasses,
  };
}

function normalizeSourceId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findRuntimeSource(source: SourceDefinition, liveSources: DataSource[]): DataSource | undefined {
  const sourceId = normalizeSourceId(source.id);
  return liveSources.find((candidate) => {
    const candidateIds = [
      candidate.source_id,
      candidate.adapter,
      candidate.name,
    ].filter(Boolean).map((value) => normalizeSourceId(String(value)));
    if (candidateIds.some((candidateId) => candidateId === sourceId || candidateId.includes(sourceId) || sourceId.includes(candidateId))) {
      return true;
    }
    if (source.id === "eccc-geomet") {
      return candidateIds.some((candidateId) => candidateId.includes("eccc") || candidateId.includes("geomet"));
    }
    return false;
  });
}

export function buildSourceContractViews(liveSources: DataSource[]): SourceContractView[] {
  return PLANETARY_SOURCE_DEFINITIONS.map((source) => {
    const runtime = findRuntimeSource(source, liveSources);
    return {
      id: source.id,
      name: source.name,
      category: source.category,
      runtimeStatus: runtime?.status ?? (source.access.auth === "paid" ? "fallback" : "derived"),
      trustTier: source.reliability.trustTier,
      auth: source.access.auth,
      retentionAllowed: source.legal.retentionAllowed ?? "unknown",
      cacheBeforeUse: source.access.costPolicy?.cacheBeforeUse ?? false,
      requiresCostApproval: source.access.costPolicy?.requireUserActionForExpensiveFetch ?? false,
      staleAfterSeconds: source.freshness.staleAfterSeconds,
      lastSuccessfulFetch: runtime?.last_successful_fetch ?? null,
      licenseLabel: source.legal.label,
    };
  });
}
