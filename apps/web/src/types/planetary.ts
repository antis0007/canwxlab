export type PlanetaryPrimitiveKind =
  | "entity"
  | "observation"
  | "event"
  | "field"
  | "asset"
  | "claim";

export type PlanetarySourceCategory =
  | "weather"
  | "satellite"
  | "transport"
  | "infrastructure"
  | "environment"
  | "government"
  | "science"
  | "documents"
  | "news"
  | "iot";

export type PlanetaryAccessMethod =
  | "api"
  | "ogc"
  | "stac"
  | "rss"
  | "webhook"
  | "scrape"
  | "file-drop"
  | "stream";

export type PlanetaryAuthMode = "none" | "api-key" | "oauth" | "paid" | "internal";

export type PlanetaryViewIntent =
  | "situational-awareness"
  | "weather"
  | "transport-risk"
  | "infrastructure"
  | "environment"
  | "news"
  | "science"
  | "all";

export type PlanetaryDataClass =
  | "observed"
  | "derived"
  | "predicted"
  | "unverified"
  | "stale";

export type TimelineMode = "live" | "replay" | "forecast";

export type ArchiveRetention = "allowed" | "restricted" | "unknown";

export interface TimeRange {
  start: string;
  end: string;
}

export interface ProvenanceRef {
  sourceId: string;
  fetchedAt: string;
  parserVersion: string;
  transformVersion?: string;
  modelVersion?: string;
  license: string;
  attribution?: string;
  confidence: number;
  qualityFlags: string[];
  rawAssetId?: string;
  derivedFrom?: string[];
}

export interface LicenseInfo {
  label: string;
  url?: string;
  attributionRequired: boolean;
  redistributionAllowed: boolean;
  commercialUseAllowed?: boolean;
  retentionAllowed?: boolean;
}

export interface CostPolicy {
  maxSpendPerHourUsd?: number;
  maxSpendPerDayUsd?: number;
  costPerRequestUsd?: number;
  costPerHistoricalHourUsd?: number;
  cacheBeforeUse: boolean;
  requireUserActionForExpensiveFetch: boolean;
}

export interface PlanetaryTimelineState {
  mode: TimelineMode;
  isTrackingLive: boolean;
  forecastEnabled: boolean;
  selectedTimeMs: number;
  liveTimeMs: number;
  replayStartMs: number;
  replayEndMs: number;
  forecastEndMs: number;
}

export interface SourceContractView {
  id: string;
  name: string;
  category: PlanetarySourceCategory;
  runtimeStatus: import("./weather").SourceStatus;
  trustTier: number;
  auth: PlanetaryAuthMode;
  retentionAllowed: boolean | "unknown";
  cacheBeforeUse: boolean;
  requiresCostApproval: boolean;
  staleAfterSeconds: number;
  lastSuccessfulFetch: string | null;
  licenseLabel: string;
}

export interface ArchiveAssetRecord {
  assetKey: string;
  url: string;
  cacheName: string;
  contentType: string | null;
  byteLength: number | null;
  fetchedAt: string;
  expiresAt: number;
  retention: ArchiveRetention;
}

export interface ArchiveSummary {
  assetCount: number;
  approximateBytes: number | null;
  allowedCount: number;
  restrictedCount: number;
  unknownCount: number;
  lastArchivedAt: string | null;
}

export interface SourceDefinition {
  id: string;
  name: string;
  category: PlanetarySourceCategory;
  access: {
    method: PlanetaryAccessMethod;
    auth: PlanetaryAuthMode;
    endpoint?: string;
    costPolicy?: CostPolicy;
  };
  legal: LicenseInfo;
  freshness: {
    updateCadenceSeconds?: number;
    expectedLatencySeconds?: number;
    historicalDepth?: string;
    staleAfterSeconds: number;
  };
  schema: {
    nativeFormat: string;
    outputTypes: PlanetaryPrimitiveKind[];
    spatialReference?: string;
    temporalField?: string;
  };
  reliability: {
    trustTier: 1 | 2 | 3 | 4 | 5;
    validationRules: string[];
    knownFailureModes: string[];
  };
}

export interface PlanetaryEntity {
  id: string;
  type: string;
  name: string;
  geometry?: GeoJSON.Geometry;
  centroid?: [number, number, number?];
  validTime?: TimeRange;
  observedTime?: TimeRange;
  identifiers: Array<{ scheme: string; value: string }>;
  relations: Array<{ predicate: string; targetId: string; confidence: number }>;
  provenance: ProvenanceRef[];
  confidence: number;
}

export interface PlanetaryObservation {
  id: string;
  observedProperty: string;
  value: number | string | [number, number];
  unit?: string;
  location: GeoJSON.Geometry;
  phenomenonTime: string;
  resultTime: string;
  sourceId: string;
  sensorEntityId?: string;
  qualityFlags: string[];
  confidence: number;
}

export interface PlanetaryEvent {
  id: string;
  type: string;
  geometry: GeoJSON.Geometry;
  startTime: string;
  endTime?: string;
  status: "reported" | "confirmed" | "estimated" | "predicted" | "resolved";
  severity?: number;
  sourceIds: string[];
  evidenceIds: string[];
  confidence: number;
}

export interface PlanetaryField {
  id: string;
  variable: string;
  dimensions: string[];
  assetRefs: string[];
  resolution: string;
  validTime: TimeRange;
  provenance: ProvenanceRef[];
}

export interface PlanetaryAsset {
  id: string;
  href: string;
  mediaType: string;
  bbox?: [number, number, number, number];
  datetime?: string;
  timeRange?: TimeRange;
  format: "COG" | "Zarr" | "GeoParquet" | "PMTiles" | "KTX2" | "MVT" | "JSON" | "HTML" | "PDF" | string;
  checksum: string;
  byteLength: number;
  license: LicenseInfo;
  lineage: ProvenanceRef[];
}

export interface PlanetaryClaim {
  id: string;
  subject: string;
  predicate: string;
  object: string | number;
  location?: GeoJSON.Geometry;
  time?: TimeRange;
  sourceId: string;
  extractionMethod: "api" | "scrape" | "llm" | "ocr" | "human" | "model";
  confidence: number;
  evidenceText?: string;
  contradicts?: string[];
}

export interface PlanetaryQuery {
  bbox: [number, number, number, number];
  timeRange: TimeRange;
  intent: PlanetaryViewIntent;
  maxLatencyMs: number;
  maxResults: number;
  quality: {
    minConfidence: number;
    includePredictions: boolean;
    includeUnverifiedReports: boolean;
  };
  lod: {
    zoom: number;
    screenSize: [number, number];
    densityBudget: number;
  };
}

export interface PlanetaryViewPlan {
  vectorTiles: string[];
  rasterTiles: string[];
  entityBatches: string[];
  eventBatches: string[];
  timeseries: string[];
  documentSnippets: string[];
  legends: string[];
  warnings: string[];
  requiredSources: string[];
  dataClasses: PlanetaryDataClass[];
}

export interface WorldDiff {
  id: string;
  entityId?: string;
  eventId?: string;
  changeType: "new" | "removed" | "attribute-changed" | "location-changed" | "status-changed" | "confidence-changed";
  before?: string;
  after?: string;
  location?: GeoJSON.Geometry;
  time: string;
  significance: number;
  sourceIds: string[];
}
