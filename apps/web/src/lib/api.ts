import type {
  AlertFeature,
  DataSource,
  Observation,
  SimulationConfig,
  SimulationRun,
  PluginCatalogResponse,
  SourceStatusResponse,
  VerificationMetric,
  WeatherLayer,
  WmsCapabilitiesSummaryResponse,
  WmsCapabilityLayerSummary
} from "../types/weather";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

async function getJson<T>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      url.searchParams.set(key, String(value));
    });
  }

  const response = await fetch(url.toString());
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
  }
};
