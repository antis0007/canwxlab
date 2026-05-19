import type {
  AlertFeature,
  DataSource,
  DerivedCellState,
  EvidenceChain,
  EventIngestionResult,
  Observation,
  OgcFeatureCollection,
  SimulationConfig,
  SimulationRun,
  PluginCatalogResponse,
  SourceStatusResponse,
  SpatiotemporalEvent,
  VerificationMetric,
  WeatherLayer,
  WmsCapabilitiesSummaryResponse,
  WmsCapabilityLayerSummary
} from "../types/weather";
import { cachedGetJson } from "./localCache";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

function cachePolicyForPath(path: string): { ttlMs: number; staleIfErrorMs: number } {
  if (path.includes("/wms/capabilities") || path.includes("/wms/layers") || path.includes("/eccc/collections")) {
    return { ttlMs: 6 * 60 * 60 * 1000, staleIfErrorMs: 7 * 24 * 60 * 60 * 1000 };
  }
  if (path.includes("/layers") || path.includes("/sources") || path.includes("/plugins")) {
    return { ttlMs: 10 * 60 * 1000, staleIfErrorMs: 24 * 60 * 60 * 1000 };
  }
  if (path.includes("/observations") || path.includes("/alerts")) {
    return { ttlMs: 60 * 1000, staleIfErrorMs: 30 * 60 * 1000 };
  }
  if (path.includes("/verification")) {
    return { ttlMs: 30 * 60 * 1000, staleIfErrorMs: 24 * 60 * 60 * 1000 };
  }
  return { ttlMs: 2 * 60 * 1000, staleIfErrorMs: 30 * 60 * 1000 };
}

async function getJson<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }

  return cachedGetJson<T>(url.toString(), cachePolicyForPath(path));
}

async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${path}`);
  }
  return response.json() as Promise<T>;
}

export interface CollectionResponse {
  status: string;
  message?: string;
  collections?: unknown[];
  collection?: unknown;
}

export const api = {
  sources: () => getJson<DataSource[]>("/api/sources"),
  sourceStatus: () => getJson<SourceStatusResponse>("/api/sources/status"),
  layers: () => getJson<WeatherLayer[]>("/api/layers"),
  observations: (query?: { bbox?: string; limit?: number }) =>
    getJson<Observation[]>("/api/observations/stations", query),
  hourlyObservations: (query?: { bbox?: string; limit?: number }) =>
    getJson<Observation[]>("/api/observations/hourly", query),
  alerts: (query?: { bbox?: string; limit?: number; live?: boolean }) =>
    getJson<AlertFeature[]>("/api/alerts", query),
  ecccCollections: () => getJson<CollectionResponse>("/api/eccc/collections"),
  ecccCollection: (collectionId: string) =>
    getJson<CollectionResponse>(`/api/eccc/collections/${encodeURIComponent(collectionId)}`),
  wmsCapabilitiesSummary: () =>
    getJson<WmsCapabilitiesSummaryResponse>("/api/eccc/wms/capabilities-summary"),
  wmsLayers: () => getJson<WmsCapabilityLayerSummary[]>("/api/eccc/wms/layers"),
  wmsLayer: (layerName: string) =>
    getJson<WmsCapabilityLayerSummary>(`/api/eccc/wms/layers/${encodeURIComponent(layerName)}`),
  wmsLayerTimes: (layerName: string) =>
    getJson<{ layer_name: string; times: string[] }>(`/api/eccc/wms/layers/${encodeURIComponent(layerName)}/times`),
  wmsBuildUrl: (query: { layer_name: string; bbox: string; width?: number; height?: number; crs?: string; time?: string; style?: string; format?: string; transparent?: boolean }) =>
    getJson<{ url: string }>("/api/eccc/wms/build-url", query),
  wmsDiagnostics: () =>
    getJson<Record<string, unknown>>("/api/eccc/wms/diagnostics"),
  clearServerCache: () =>
    postJson<{ ok: boolean; cleared: string }>("/api/admin/clear-cache"),
  ogcLayerFeatures: (layerId: string, query?: { bbox?: string; limit?: number }) =>
    getJson<OgcFeatureCollection>(
      `/api/eccc/ogc/layers/${encodeURIComponent(layerId)}/features`,
      query,
    ),
  plugins: () => getJson<PluginCatalogResponse>("/api/plugins"),
  verification: () => getJson<VerificationMetric[]>("/api/verification/summary"),
  createSimulation: async (config: SimulationConfig): Promise<SimulationRun> => {
    const response = await fetch(`${API_BASE_URL}/api/simulations/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config)
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: create simulation`);
    }
    return response.json() as Promise<SimulationRun>;
  },
  getSimulationRun: (runId: string) =>
    getJson<SimulationRun>(`/api/simulations/runs/${encodeURIComponent(runId)}`),
  // Verification cases API
  verificationCases: () =>
    getJson<Array<Record<string, unknown>>>("/api/verification/cases"),
  verificationCaseDiff: (
    caseId: string,
    field: string,
    diffMode: string = "ABSOLUTE_ERROR",
  ) =>
    getJson<{
      field: string;
      diff_mode: string;
      rows: number;
      cols: number;
      bbox: [number, number, number, number];
      is_generated_mock: boolean;
      grid: number[][];
    }>(
      `/api/verification/cases/${encodeURIComponent(caseId)}/diff/${encodeURIComponent(field)}`,
      { diff_mode: diffMode },
    ),

  // ── Phase A: Evidence API ────────────────────────────────────────────
  // PHASE-A-TODO: Wire these into InspectorPanel (provenance button) and a
  // new EvidencePanel component that renders the full event chain timeline.
  evidenceProvenance: (objectId: string) =>
    getJson<EvidenceChain>(`/api/evidence/${encodeURIComponent(objectId)}/provenance`),
  evidenceHistory: (objectId: string) =>
    getJson<SpatiotemporalEvent[]>(`/api/evidence/${encodeURIComponent(objectId)}/history`),
  evidenceConflicts: (objectId: string) =>
    getJson<DerivedCellState[]>(`/api/evidence/${encodeURIComponent(objectId)}/conflicts`),
  cellState: (query: { h3: string; variable: string }) =>
    getJson<DerivedCellState>("/api/evidence/cells", query),
  ingestEvents: (events: SpatiotemporalEvent[]) =>
    (async (): Promise<EventIngestionResult> => {
      const response = await fetch(`${API_BASE_URL}/api/events/ingest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(events),
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ingest events`);
      }
      return response.json() as Promise<EventIngestionResult>;
    })(),
  queryEvents: (query: { bbox?: string; from?: string; to?: string; limit?: number }) =>
    getJson<SpatiotemporalEvent[]>("/api/events", query),
  // ─────────────────────────────────────────────────────────────────────
};
