import type { AlertFeature, Observation, SourceStatus } from "../types/weather";
import { valueForRampColor } from "./colorRamps";
import { solarElevationDeg } from "../time/solarBands";
import {
  airDensityKgM3,
  beaufortFromWindMs,
  cardinalDirection,
  dewpointFromTempRH,
  haversineKm,
  rhFromTempDewpoint,
  windDirectionFromUVDeg,
  windSpeedFromUV,
} from "./weatherAnalysis";
import { detectPressureSystems, type PressureSystem } from "./pressureSystems";
import type { LayerDefinition, LayerRuntimeState, RendererFeatureValue, RenderLayerPlan } from "./types";

export interface HeroMetric {
  /** Stable id so the UI can key elements and apply consistent colour. */
  id: "temperature" | "pressure" | "wind" | "precipitation" | "humidity" | "dewpoint" | "density";
  /** Short, all-caps label rendered above the value (e.g. "TEMP"). */
  label: string;
  /** Pre-formatted number string (e.g. "13.4"). */
  value: string;
  /** Unit suffix shown smaller next to the value. */
  unit: string;
  /** Provenance shown as a small chip ("live", "derived", "fallback", etc.). */
  status: SourceStatus;
  /** Optional caption line (e.g. "WSW · Light breeze" for wind). */
  caption?: string;
  /** Optional source identifier for "from: station-name" attribution. */
  source?: string;
}

export interface InspectorBuildInput {
  longitude: number;
  latitude: number;
  frame: number;
  activeLayers: LayerDefinition[];
  renderPlan: RenderLayerPlan[];
  runtimeState?: Record<string, LayerRuntimeState>;
  observations: Observation[];
  alerts: AlertFeature[];
  sampledRgb?: [number, number, number] | null;
  sampledAtMs?: number;
}

export interface InspectorWmsRow {
  title: string;
  resolvedTime: string | null;
  timePolicy: string;
  status: SourceStatus;
  availability: string;
  requestedTime: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
}

export interface InspectorPayload {
  longitude: number;
  latitude: number;
  /** Big-number metric cards rendered at the top of the inspector. */
  heroMetrics: HeroMetric[];
  /** Free-form analytic rows (microphysics hint, layer stack, etc.). */
  values: RendererFeatureValue[];
  nearestStation: string | null;
  /** Distance in km to the nearest station, or null if unknown. */
  nearestStationKm: number | null;
  activeAlert: string | null;
  /** Synoptic-pattern lows/highs from station observations. */
  pressureSystems: PressureSystem[];
  /** Up-to-three top WMS layers contributing to the current view. */
  wmsLayers: InspectorWmsRow[];
}

function summarizeAlert(alert: AlertFeature): string {
  const severity = alert.severity && alert.severity !== "unknown"
    ? alert.severity.toUpperCase()
    : null;
  const head = alert.headline?.trim() || alert.event?.trim() || "Weather alert";
  const expiresPart = alert.expires_at
    ? ` - expires ${new Date(alert.expires_at).toLocaleString()}`
    : "";
  // Full description: ECCC alert text lists every affected zone, and operators
  // need all of them. The inspector renders this in an expandable block, so
  // truncating here only destroyed information.
  const desc = (alert.description ?? "").trim();
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

export function isMeasuredObservation(observation: Observation): boolean {
  const flags = new Set(observation.quality_flags.map((flag) => flag.toLowerCase()));
  if (flags.has("mock") || flags.has("hourly_mock") || flags.has("fallback")) return false;
  return observation.source_status === "live" || observation.source_status === "stale";
}

export function nearestMeasuredObservation(
  observations: Observation[],
  longitude: number,
  latitude: number,
): Observation | null {
  return nearestObservation(
    observations.filter(isMeasuredObservation),
    longitude,
    latitude,
  );
}

export function nearestStationName(
  observations: Observation[],
  longitude: number,
  latitude: number,
): string | null {
  const nearest = nearestObservation(observations, longitude, latitude);
  return nearest ? `${nearest.station_name} (${nearest.station_id})` : null;
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

interface MicrophysicsClass {
  label: string;
  color: [number, number, number];
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

function rgbDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function isLikelyDayAt(
  longitude: number,
  latitude: number,
  rgb: [number, number, number],
  sampledAtMs: number | undefined,
): boolean {
  if (sampledAtMs !== undefined && Number.isFinite(sampledAtMs)) {
    return solarElevationDeg(latitude, longitude, sampledAtMs) >= -6;
  }
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

function readNumber(values: Record<string, number>, key: string): number | null {
  const raw = values[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function buildHeroMetrics(input: InspectorBuildInput): HeroMetric[] {
  const metrics: HeroMetric[] = [];
  const nearest = nearestMeasuredObservation(input.observations, input.longitude, input.latitude);
  const sampledTemperature = sampledLayerValue(input, (layer, plan) => {
    const haystack = `${layer.title} ${layer.variable ?? ""} ${plan.source.wmsLayerName ?? ""}`.toLowerCase();
    return (
      haystack.includes("surface temp")
      || haystack.includes("temperature")
      || haystack.includes("tmp")
      || haystack.includes("t2m")
    );
  });

  const stationTemp = nearest ? readNumber(nearest.values, "temperature_2m") : null;
  const stationPressure = nearest ? readNumber(nearest.values, "pressure_msl") : null;
  const stationWindSpeed = nearest ? readNumber(nearest.values, "wind_speed_10m") : null;
  const stationWindDir = nearest ? readNumber(nearest.values, "wind_direction_10m") : null;
  const stationWindU = nearest ? readNumber(nearest.values, "wind_u_10m") : null;
  const stationWindV = nearest ? readNumber(nearest.values, "wind_v_10m") : null;
  const stationDew = nearest ? readNumber(nearest.values, "dewpoint_2m") : null;
  const stationRH = nearest ? readNumber(nearest.values, "relative_humidity_2m") : null;
  const stationPrecip1h = nearest ? readNumber(nearest.values, "precipitation_1h") : null;

  // Derived dewpoint when only RH is reported, or derived RH when only dew is.
  const dewpoint = stationDew ?? (stationTemp !== null && stationRH !== null
    ? dewpointFromTempRH(stationTemp, stationRH)
    : null);
  const rh = stationRH ?? (stationTemp !== null && stationDew !== null
    ? rhFromTempDewpoint(stationTemp, stationDew)
    : null);

  // Wind: prefer measured speed/dir; otherwise compute from u/v components.
  const derivedSpeed = stationWindSpeed
    ?? (stationWindU !== null && stationWindV !== null ? windSpeedFromUV(stationWindU, stationWindV) : null);
  const derivedDir = stationWindDir
    ?? (stationWindU !== null && stationWindV !== null ? windDirectionFromUVDeg(stationWindU, stationWindV) : null);

  if (sampledTemperature) {
    metrics.push({
      id: "temperature",
      label: "SFC TEMP",
      value: sampledTemperature.value.toFixed(1),
      unit: sampledTemperature.unit ?? "deg",
      status: "derived",
      caption: sampledTemperature.confidence >= 0.7
        ? `canvas sample - ${sampledTemperature.layerTitle}`
        : `approx canvas sample - ${sampledTemperature.layerTitle}`,
      source: sampledTemperature.layerId,
    });
  } else if (stationTemp !== null) {
    metrics.push({
      id: "temperature",
      label: "TEMP",
      value: stationTemp.toFixed(1),
      unit: nearest?.units.temperature_2m ?? "°C",
      status: nearest?.source_status ?? "live",
      caption: nearest?.station_name,
      source: nearest?.station_id,
    });
  }

  if (stationPressure !== null) {
    metrics.push({
      id: "pressure",
      label: "MSLP",
      value: stationPressure.toFixed(1),
      unit: nearest?.units.pressure_msl ?? "hPa",
      status: nearest?.source_status ?? "live",
      caption: nearest?.station_name,
      source: nearest?.station_id,
    });
  }

  if (derivedSpeed !== null) {
    const dirText = derivedDir !== null
      ? `${cardinalDirection(derivedDir)} (${derivedDir.toFixed(0)}°)`
      : null;
    const beaufort = beaufortFromWindMs(derivedSpeed);
    const captionBits: string[] = [];
    if (dirText) captionBits.push(dirText);
    if (beaufort) captionBits.push(`F${beaufort.force} · ${beaufort.label}`);
    metrics.push({
      id: "wind",
      label: "WIND",
      value: derivedSpeed.toFixed(1),
      unit: nearest?.units.wind_speed_10m ?? "m/s",
      status: nearest?.source_status ?? "derived",
      caption: captionBits.join(" · ") || undefined,
      source: nearest?.station_id,
    });
  }

  if (stationPrecip1h !== null) {
    metrics.push({
      id: "precipitation",
      label: "PRECIP 1h",
      value: stationPrecip1h.toFixed(2),
      unit: nearest?.units.precipitation_1h ?? "mm",
      status: nearest?.source_status ?? "live",
      source: nearest?.station_id,
    });
  }

  if (dewpoint !== null && stationTemp !== null) {
    metrics.push({
      id: "dewpoint",
      label: "DEW PT",
      value: dewpoint.toFixed(1),
      unit: "°C",
      status: stationDew !== null ? (nearest?.source_status ?? "live") : "derived",
      caption: stationDew === null ? "derived from T + RH" : undefined,
      source: nearest?.station_id,
    });
  }

  if (rh !== null) {
    metrics.push({
      id: "humidity",
      label: "RH",
      value: rh.toFixed(0),
      unit: "%",
      status: stationRH !== null ? (nearest?.source_status ?? "live") : "derived",
      caption: stationRH === null ? "derived from T + DP" : undefined,
      source: nearest?.station_id,
    });
  }

  if (stationTemp !== null && stationPressure !== null) {
    const density = airDensityKgM3(stationPressure, stationTemp, dewpoint);
    if (density !== null) {
      metrics.push({
        id: "density",
        label: "ρ AIR",
        value: density.toFixed(3),
        unit: "kg/m³",
        status: "derived",
        caption: "ideal-gas moist air",
        source: nearest?.station_id,
      });
    }
  }

  return metrics;
}

function layerRampId(input: InspectorBuildInput, layer: LayerDefinition): string {
  return input.runtimeState?.[layer.id]?.colourRamp ?? layer.colourRamp;
}

function isServerRendered(layer: LayerDefinition): boolean {
  return layer.serviceType === "wms" || layer.serviceType === "wmts";
}

function layerSupportsNumericCanvasSampling(layer: LayerDefinition): boolean {
  if (!isServerRendered(layer)) return true;
  return typeof layer.metadata?.legend_sampling_ramp === "string";
}

function samplingRampId(input: InspectorBuildInput, layer: LayerDefinition): string {
  return typeof layer.metadata?.legend_sampling_ramp === "string"
    ? layer.metadata.legend_sampling_ramp
    : layerRampId(input, layer);
}

function sampledLayerValue(
  input: InspectorBuildInput,
  predicate?: (layer: LayerDefinition, plan: RenderLayerPlan) => boolean,
): {
  layerId: string;
  layerTitle: string;
  value: number;
  unit?: string;
  confidence: number;
} | null {
  if (!input.sampledRgb) return null;
  const candidates = input.renderPlan
    .filter((plan) => plan.visible)
    .slice()
    .sort((a, b) => b.order - a.order)
    .map((plan) => ({
      plan,
      layer: input.activeLayers.find((candidate) => candidate.id === plan.source.layerId),
    }))
    .filter((entry): entry is { plan: RenderLayerPlan; layer: LayerDefinition } => Boolean(entry.layer))
    .filter(({ layer, plan }) => {
      if (predicate && !predicate(layer, plan)) return false;
      if (!layerSupportsNumericCanvasSampling(layer)) return false;
      if (layer.category === "satellite" || layer.category === "radar") return false;
      if (layer.legend.unit === "category") return false;
      return true;
    });

  for (const { layer } of candidates) {
    const derived = valueForRampColor(samplingRampId(input, layer), input.sampledRgb);
    if (!derived) continue;
    return {
      layerId: layer.id,
      layerTitle: layer.title,
      value: derived.value,
      unit: layer.legend.unit ?? layer.unit ?? undefined,
      confidence: derived.confidence,
    };
  }
  return null;
}

function buildAnalysisRows(input: InspectorBuildInput): RendererFeatureValue[] {
  const values: RendererFeatureValue[] = [];
  const topQueryableLayer = input.renderPlan
    .filter((plan) => plan.visible)
    .slice()
    .sort((a, b) => b.order - a.order)
    .map((plan) => ({
      plan,
      layer: input.activeLayers.find((candidate) => candidate.id === plan.source.layerId),
    }))
    .find(({ layer }) => {
      if (!layer) return false;
      const variable = `${layer.variable ?? ""} ${layer.title}`.toLowerCase();
      return (
        layerSupportsNumericCanvasSampling(layer)
        && layer.category !== "satellite"
        && layer.category !== "radar"
        && layer.legend.unit !== "category"
        && !variable.includes("alert")
      );
    });

  if (topQueryableLayer?.layer) {
    if (input.sampledRgb) {
      const derived = valueForRampColor(samplingRampId(input, topQueryableLayer.layer), input.sampledRgb);
      if (derived) {
        const prefix = derived.confidence >= 0.7 ? "" : "approx ";
        values.push({
          label: `${topQueryableLayer.layer.title} colour sample`,
          value: `${prefix}${derived.value.toFixed(1)}`,
          unit: topQueryableLayer.layer.legend.unit ?? topQueryableLayer.layer.unit ?? undefined,
          status: "derived",
        });
        values.push({
          label: "Pixel RGB",
          value: `rgb(${input.sampledRgb.join(", ")})`,
          unit: `${Math.round(derived.confidence * 100)}% ramp confidence`,
          status: "derived",
        });
      }
    } else {
      values.push({
        label: `${topQueryableLayer.layer.title} colour sample`,
        value: "pixel sample unavailable",
        unit: topQueryableLayer.layer.legend.unit ?? topQueryableLayer.layer.unit ?? undefined,
        status: "unavailable",
      });
    }
  }

  const wmsLayers = input.renderPlan.filter((plan) => plan.visible && plan.rendererType === "wms-raster");
  const microphysics = wmsLayers.find(isDayNightMicrophysicsLayer);
  if (microphysics) {
    if (input.sampledRgb) {
      const classified = classifyMicrophysics(
        input.longitude,
        input.latitude,
        input.sampledRgb,
        input.sampledAtMs,
      );
      values.push({
        label: "GOES Microphysics RGB",
        value: `${classified.mode}: ${classified.label}`,
        unit: `rgb(${input.sampledRgb.join(",")})`,
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

  return values;
}

function buildWmsRows(plan: RenderLayerPlan[]): InspectorWmsRow[] {
  const wmsLayers = plan.filter((entry) => entry.visible && entry.rendererType === "wms-raster");
  return wmsLayers
    .slice()
    .sort((a, b) => b.order - a.order)
    .slice(0, 3)
    .map((entry) => ({
      title: entry.source.title,
      resolvedTime: entry.resolvedTime,
      timePolicy: entry.timePolicy,
      status: entry.source.status,
      availability: String(entry.source.metadata.time_availability ?? "available"),
      requestedTime: typeof entry.source.metadata.requested_time === "string"
        ? entry.source.metadata.requested_time
        : null,
      rangeStart: typeof entry.source.metadata.available_time_start === "string"
        ? entry.source.metadata.available_time_start
        : null,
      rangeEnd: typeof entry.source.metadata.available_time_end === "string"
        ? entry.source.metadata.available_time_end
        : null,
    }));
}

export function buildInspectorPayload(input: InspectorBuildInput): InspectorPayload {
  const heroMetrics = buildHeroMetrics(input);
  const values = buildAnalysisRows(input);
  const wmsLayers = buildWmsRows(input.renderPlan);
  const measuredPool = input.observations.filter(isMeasuredObservation);
  const alertPool = input.alerts.filter((alert) => alert.source_status === "live" || alert.source_status === "stale");
  const pressureSystems = detectPressureSystems(measuredPool);
  const nearest = nearestMeasuredObservation(input.observations, input.longitude, input.latitude);
  const nearestStationKm = nearest
    ? haversineKm(input.longitude, input.latitude, nearest.longitude, nearest.latitude)
    : null;

  return {
    longitude: input.longitude,
    latitude: input.latitude,
    heroMetrics,
    values,
    nearestStation: nearest ? `${nearest.station_name} (${nearest.station_id})` : null,
    nearestStationKm,
    activeAlert: activeAlertAtPoint(alertPool, input.longitude, input.latitude),
    pressureSystems,
    wmsLayers,
  };
}
