import type { AlertFeature, Observation } from "../types/weather";
import { solarElevationDeg } from "../time/solarBands";
import { sampleMockWeatherPoint } from "./renderers/mockWeatherFields";
import type { LayerDefinition, RendererFeatureValue, RenderLayerPlan } from "./types";

export interface InspectorBuildInput {
  longitude: number;
  latitude: number;
  frame: number;
  activeLayers: LayerDefinition[];
  renderPlan: RenderLayerPlan[];
  observations: Observation[];
  alerts: AlertFeature[];
  sampledRgb?: [number, number, number] | null;
  sampledAtMs?: number;
}

export interface InspectorPayload {
  longitude: number;
  latitude: number;
  values: RendererFeatureValue[];
  nearestStation: string | null;
  activeAlert: string | null;
}

function summarizeAlert(alert: AlertFeature): string {
  const severity = alert.severity && alert.severity !== "unknown"
    ? alert.severity.toUpperCase()
    : null;
  const head = alert.headline?.trim() || alert.event?.trim() || "Weather alert";
  const expiresPart = alert.expires_at
    ? ` - expires ${new Date(alert.expires_at).toLocaleString()}`
    : "";
  const descSrc = (alert.description ?? "").trim();
  const desc = descSrc.length > 220 ? `${descSrc.slice(0, 218).trimEnd()}...` : descSrc;
  const headLine = severity ? `[${severity}] ${head}` : head;
  return desc && desc !== head ? `${headLine}${expiresPart}\n${desc}` : `${headLine}${expiresPart}`;
}

function flattenPoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (
    value.length === 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
  ) {
    return [[value[0], value[1]]];
  }
  return value.flatMap((item) => flattenPoints(item));
}

export function activeAlertAtPoint(alerts: AlertFeature[], longitude: number, latitude: number): string | null {
  for (const alert of alerts) {
    const coordinates = (alert.geometry as any)?.coordinates;
    if (!Array.isArray(coordinates)) continue;
    const flat = flattenPoints(coordinates);
    if (flat.length === 0) continue;
    const lons = flat.map((point) => point[0]);
    const lats = flat.map((point) => point[1]);
    if (
      longitude >= Math.min(...lons)
      && longitude <= Math.max(...lons)
      && latitude >= Math.min(...lats)
      && latitude <= Math.max(...lats)
    ) {
      return summarizeAlert(alert);
    }
  }
  return null;
}

export function nearestObservation(
  observations: Observation[],
  longitude: number,
  latitude: number,
): Observation | null {
  let nearest: Observation | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const observation of observations) {
    const distance = Math.hypot(observation.longitude - longitude, observation.latitude - latitude);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = observation;
    }
  }

  return nearest;
}

export function nearestStationName(
  observations: Observation[],
  longitude: number,
  latitude: number,
): string | null {
  const nearest = nearestObservation(observations, longitude, latitude);
  return nearest ? `${nearest.station_name} (${nearest.station_id})` : null;
}

function hasLayer(activeLayers: LayerDefinition[], predicate: (layer: LayerDefinition) => boolean): boolean {
  return activeLayers.some(predicate);
}

function isDayNightMicrophysicsLayer(layer: LayerDefinition | RenderLayerPlan): boolean {
  const parts = "source" in layer
    ? [layer.source.title, layer.source.wmsLayerName, layer.source.variable]
    : [layer.title, layer.wmsLayerName, layer.variable];
  const haystack = parts.join(" ").toLowerCase();
  return (
    haystack.includes("daycloudtype-nightmicrophysics")
    || haystack.includes("daynightcloudmicro")
    || haystack.includes("day cloud phase")
    || haystack.includes("night microphysics")
  );
}

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

interface MicrophysicsClass {
  label: string;
  color: [number, number, number];
  /** Plain-language precipitation/cloud-type hint per the NOAA RGB quick guide. */
  precipHint: string;
}

const DAY_CLOUD_PHASE_CLASSES: MicrophysicsClass[] = [
  { label: "low water cloud (cyan/lavender)", color: [120, 210, 230], precipHint: "warm liquid stratus; drizzle possible, no convective precip" },
  { label: "glaciating cloud (bright green)", color: [70, 190, 80], precipHint: "active glaciation; cold-cloud precip likely (rain or snow given temp)" },
  { label: "snow / snow-covered surface", color: [145, 210, 95], precipHint: "surface snow signal, not precipitation; check temperature and radar" },
  { label: "thick high ice cloud (yellow)", color: [230, 220, 60], precipHint: "deep ice cloud; convective storm top or thick cirrus shield" },
  { label: "thin mid-level water cloud (magenta)", color: [210, 80, 180], precipHint: "supercooled liquid mid-cloud; aircraft icing risk, light precip" },
  { label: "thin high-level ice cloud (red-orange)", color: [220, 90, 35], precipHint: "thin cirrus; no precipitation reaching surface" },
  { label: "land surface (blue)", color: [50, 90, 170], precipHint: "clear land; no cloud signature" },
  { label: "water surface / very dark background", color: [10, 15, 25], precipHint: "clear ocean or very weak signal" },
];

const NIGHT_MICROPHYSICS_CLASSES: MicrophysicsClass[] = [
  { label: "fog / very low stratus (dull aqua-gray)", color: [145, 180, 175], precipHint: "fog or low stratus; visibility hazard, no precip" },
  { label: "very low warm cloud (aqua)", color: [80, 215, 210], precipHint: "warm shallow cloud; drizzle possible" },
  { label: "low cool cloud (bright green)", color: [80, 230, 70], precipHint: "low cool stratiform; light rain or snow possible" },
  { label: "mid-level water cloud (light green)", color: [165, 220, 105], precipHint: "mid-level cloud; moderate stratiform precip likely if cold" },
  { label: "mid thick water/ice cloud (tan)", color: [190, 155, 95], precipHint: "transitional mixed-phase; precip risk; check radar" },
  { label: "high thin ice cloud (dark blue)", color: [35, 70, 145], precipHint: "thin cirrus; no precipitation" },
  { label: "high very thin ice cloud (purple)", color: [105, 60, 150], precipHint: "thin cirrus; no precipitation" },
  { label: "high thick cold cloud (dark red)", color: [135, 25, 25], precipHint: "deep convective top; heavy rain or hail likely beneath" },
  { label: "high thin / near-black", color: [15, 15, 18], precipHint: "clear or very thin cloud" },
  { label: "high thick very cold cloud (noisy red/yellow)", color: [220, 150, 30], precipHint: "overshooting top; severe convection likely" },
];

interface MicrophysicsResult {
  mode: "Day Cloud Phase" | "Night Microphysics";
  label: string;
  precipHint: string;
  dayLikelihood: "day" | "night";
}

function isLikelyDayAt(
  longitude: number,
  latitude: number,
  rgb: [number, number, number],
  sampledAtMs: number | undefined,
): boolean {
  if (sampledAtMs !== undefined && Number.isFinite(sampledAtMs)) {
    // Real solar geometry: civil-twilight cutoff is the same threshold used by
    // GOES-R when switching from Day Cloud Phase to Nighttime Microphysics.
    return solarElevationDeg(latitude, longitude, sampledAtMs) >= -6;
  }
  // No time available: fall back to a brightness heuristic. Daylight imagery is
  // generally brighter than nighttime IR-derived RGB.
  return rgb[0] + rgb[1] + rgb[2] > 230;
}

function classifyMicrophysics(
  longitude: number,
  latitude: number,
  rgb: [number, number, number],
  sampledAtMs: number | undefined,
): MicrophysicsResult {
  const dayLight = isLikelyDayAt(longitude, latitude, rgb, sampledAtMs);
  const classes = dayLight ? DAY_CLOUD_PHASE_CLASSES : NIGHT_MICROPHYSICS_CLASSES;
  const ranked = classes
    .map((entry) => ({ entry, distance: rgbDistance(rgb, entry.color) }))
    .sort((a, b) => a.distance - b.distance);
  const best = ranked[0].entry;
  return {
    mode: dayLight ? "Day Cloud Phase" : "Night Microphysics",
    label: best.label,
    precipHint: best.precipHint,
    dayLikelihood: dayLight ? "day" : "night",
  };
}

function addMockFieldValues(
  values: RendererFeatureValue[],
  longitude: number,
  latitude: number,
  frame: number,
  activeLayers: LayerDefinition[],
) {
  const sampled = sampleMockWeatherPoint(longitude, latitude, frame);

  if (hasLayer(activeLayers, (layer) => layer.id === "demo_temperature_field" || layer.id === "mock_temperature")) {
    values.push({ label: "Sampled Temperature", value: sampled.temperatureC.toFixed(1), unit: "degC", status: "mock" });
  }
  if (hasLayer(activeLayers, (layer) => layer.id === "demo_pressure_msl" || layer.variable === "pressure_msl")) {
    values.push({ label: "Sampled Pressure", value: sampled.pressureHpa.toFixed(1), unit: "hPa", status: "mock" });
  }
  if (hasLayer(activeLayers, (layer) => layer.id === "demo_radar_animation" || layer.id === "mock_radar" || layer.category === "radar")) {
    values.push({ label: "Sampled Precip/Radar", value: sampled.precipitationRate.toFixed(2), unit: "mm/h", status: "mock" });
  }
  if (hasLayer(activeLayers, (layer) => layer.id === "demo_wind_particles" || layer.id === "mock_wind")) {
    values.push({ label: "Sampled Wind Speed", value: sampled.windSpeed.toFixed(1), unit: "m/s", status: "mock" });
    values.push({ label: "Sampled Wind Vector", value: `${sampled.windU.toFixed(1)}, ${sampled.windV.toFixed(1)}`, unit: "u/v", status: "mock" });
  }
  if (hasLayer(activeLayers, (layer) => layer.id === "demo_clouds")) {
    values.push({ label: "Sampled Cloud Opacity", value: sampled.cloudOpacity.toFixed(2), unit: "ratio", status: "mock" });
  }
}

function addStationValues(
  values: RendererFeatureValue[],
  observations: Observation[],
  longitude: number,
  latitude: number,
) {
  const nearest = nearestObservation(observations, longitude, latitude);
  if (!nearest) return;
  const stationValues: Array<[string, string, string]> = [
    ["temperature_2m", "Station Temperature", "degC"],
    ["pressure_msl", "Station Pressure", "hPa"],
    ["wind_speed_10m", "Station Wind", "m/s"],
  ];
  for (const [key, label, fallbackUnit] of stationValues) {
    const raw = nearest.values[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    values.push({
      label,
      value: raw.toFixed(1),
      unit: nearest.units[key] ?? fallbackUnit,
      status: nearest.source_status,
    });
  }
  if (nearest.observed_at) {
    values.push({
      label: "Station Time",
      value: new Date(nearest.observed_at).toLocaleString(),
      status: nearest.source_status,
    });
  }
}

function addWmsValues(
  values: RendererFeatureValue[],
  renderPlan: RenderLayerPlan[],
  longitude: number,
  latitude: number,
  sampledRgb?: [number, number, number] | null,
  sampledAtMs?: number,
) {
  const wmsLayers = renderPlan.filter((plan) => plan.visible && plan.rendererType === "wms-raster");
  for (const plan of wmsLayers.slice().sort((a, b) => b.order - a.order).slice(0, 3)) {
    values.push({
      label: `WMS Layer: ${plan.source.title}`,
      value: plan.resolvedTime ?? (plan.timePolicy === "latest" ? "latest advertised" : "untimed"),
      unit: plan.timePolicy,
      status: plan.source.status,
    });
  }

  const microphysics = wmsLayers.find(isDayNightMicrophysicsLayer);
  if (!microphysics) return;
  if (sampledRgb) {
    const classified = classifyMicrophysics(longitude, latitude, sampledRgb, sampledAtMs);
    values.push({
      label: "GOES Microphysics RGB",
      value: `${classified.mode}: ${classified.label}`,
      unit: `rgb(${sampledRgb.join(",")})`,
      status: "derived",
    });
    values.push({
      label: "Precip / Cloud Hint",
      value: classified.precipHint,
      unit: classified.dayLikelihood,
      status: "derived",
    });
  } else {
    values.push({
      label: "GOES Microphysics RGB",
      value: "active; pixel colour sample unavailable",
      unit: "qualitative",
      status: "derived",
    });
  }
  values.push({
    label: "Microphysics Note",
    value: "qualitative RGB guidance; not a direct precipitation measurement",
    status: "derived",
  });
}

export function buildInspectorPayload(input: InspectorBuildInput): InspectorPayload {
  const values: RendererFeatureValue[] = [];
  addMockFieldValues(values, input.longitude, input.latitude, input.frame, input.activeLayers);
  addStationValues(values, input.observations, input.longitude, input.latitude);
  addWmsValues(values, input.renderPlan, input.longitude, input.latitude, input.sampledRgb, input.sampledAtMs);

  return {
    longitude: input.longitude,
    latitude: input.latitude,
    values,
    nearestStation: nearestStationName(input.observations, input.longitude, input.latitude),
    activeAlert: activeAlertAtPoint(input.alerts, input.longitude, input.latitude),
  };
}
