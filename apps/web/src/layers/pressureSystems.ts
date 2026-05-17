// Pressure-system detection from point observations.
//
// Operational meteorology workstations flag candidate surface highs and
// lows so the operator can see the synoptic pattern at a glance. With a
// dense gridded MSLP analysis you'd run a local-extrema filter on the
// raster; here we only have station observations, so we use a
// k-nearest-neighbour comparison: a station is a candidate Low if its
// MSLP is lower than every other station within `radiusKm`, and the same
// inverse for a candidate High. A `minContrastHpa` floor avoids flagging
// near-flat ridges/troughs as systems.
//
// Outputs are intentionally simple — the inspector renders them as a
// short table, and the map renders L/H glyphs at the centre coordinates.

import { haversineKm } from "./weatherAnalysis";
import type { Observation } from "../types/weather";

export type PressureSystemKind = "L" | "H";

export interface PressureSystem {
  kind: PressureSystemKind;
  longitude: number;
  latitude: number;
  pressureHpa: number;
  stationId: string;
  stationName: string;
  /** hPa difference to the most extreme opposite-direction neighbour in the
   *  comparison window. Higher = more pronounced system. */
  contrastHpa: number;
  observedAt: string;
}

export interface DetectionOptions {
  /** Neighbours within this great-circle distance are compared. */
  radiusKm?: number;
  /** Minimum hPa contrast to qualify as a real system, not a quiet ridge. */
  minContrastHpa?: number;
  /** Minimum neighbour count required to consider a station; avoids flagging
   *  isolated single stations as "systems". */
  minNeighbours?: number;
}

const DEFAULT_RADIUS_KM = 800;
const DEFAULT_MIN_CONTRAST_HPA = 2.0;
const DEFAULT_MIN_NEIGHBOURS = 2;

interface PointWithPressure {
  observation: Observation;
  pressureHpa: number;
}

function readPressureHpa(observation: Observation): number | null {
  const raw = observation.values?.pressure_msl;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  // Reject values that obviously aren't sea-level pressure (e.g. station
  // pressure at 4 km elevation). Synoptic MSLP lives in ~870..1070 hPa.
  if (raw < 860 || raw > 1080) return null;
  return raw;
}

export function detectPressureSystems(
  observations: Observation[],
  options: DetectionOptions = {},
): PressureSystem[] {
  const radiusKm = options.radiusKm ?? DEFAULT_RADIUS_KM;
  const minContrastHpa = options.minContrastHpa ?? DEFAULT_MIN_CONTRAST_HPA;
  const minNeighbours = options.minNeighbours ?? DEFAULT_MIN_NEIGHBOURS;

  const points: PointWithPressure[] = [];
  for (const obs of observations) {
    const pressureHpa = readPressureHpa(obs);
    if (pressureHpa === null) continue;
    points.push({ observation: obs, pressureHpa });
  }
  if (points.length < minNeighbours + 1) return [];

  const systems: PressureSystem[] = [];
  for (const candidate of points) {
    let neighbourCount = 0;
    let lowestNeighbour = Number.POSITIVE_INFINITY;
    let highestNeighbour = Number.NEGATIVE_INFINITY;
    for (const other of points) {
      if (other.observation.observation_id === candidate.observation.observation_id) continue;
      const distance = haversineKm(
        candidate.observation.longitude,
        candidate.observation.latitude,
        other.observation.longitude,
        other.observation.latitude,
      );
      if (distance > radiusKm) continue;
      neighbourCount += 1;
      if (other.pressureHpa < lowestNeighbour) lowestNeighbour = other.pressureHpa;
      if (other.pressureHpa > highestNeighbour) highestNeighbour = other.pressureHpa;
    }
    if (neighbourCount < minNeighbours) continue;

    // Low candidate: strictly less pressure than every neighbour AND big
    // enough gap to the nearest competing low.
    if (candidate.pressureHpa < lowestNeighbour) {
      const contrast = lowestNeighbour - candidate.pressureHpa;
      if (contrast >= minContrastHpa) {
        systems.push({
          kind: "L",
          longitude: candidate.observation.longitude,
          latitude: candidate.observation.latitude,
          pressureHpa: candidate.pressureHpa,
          stationId: candidate.observation.station_id,
          stationName: candidate.observation.station_name,
          contrastHpa: Number(contrast.toFixed(2)),
          observedAt: candidate.observation.observed_at,
        });
        continue;
      }
    }
    // High candidate: strictly greater pressure than every neighbour.
    if (candidate.pressureHpa > highestNeighbour) {
      const contrast = candidate.pressureHpa - highestNeighbour;
      if (contrast >= minContrastHpa) {
        systems.push({
          kind: "H",
          longitude: candidate.observation.longitude,
          latitude: candidate.observation.latitude,
          pressureHpa: candidate.pressureHpa,
          stationId: candidate.observation.station_id,
          stationName: candidate.observation.station_name,
          contrastHpa: Number(contrast.toFixed(2)),
          observedAt: candidate.observation.observed_at,
        });
      }
    }
  }

  // Sort by contrast descending so the most pronounced systems sit at the
  // top of the inspector list.
  return systems.sort((a, b) => b.contrastHpa - a.contrastHpa);
}
