/** Pure deck.gl layer builders for OSINT feeds.
 *
 * Spec law 2: parsers return typed events; these functions turn
 * (events, nowMs) into layers. No fetching, no state — fully unit-testable.
 */

import { LineLayer, ScatterplotLayer } from "@deck.gl/layers";

import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import type { QuakeEvent } from "../../lib/liveFeeds/quakes";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

// ── Earthquakes ───────────────────────────────────────────────────────────

/** Radius in meters: standard magnitude→energy-ish visual scale. */
export function quakeRadiusM(magnitude: number): number {
  return 12_000 * Math.pow(1.8, Math.max(0, magnitude));
}

/** Fade with age over 24 h; fresh events glow. */
export function quakeOpacity(eventTimeMs: number, nowMs: number): number {
  const ageHours = Math.max(0, (nowMs - eventTimeMs) / 3_600_000);
  return Math.max(0.12, 1 - ageHours / 24);
}

export function quakeColor(magnitude: number, eventTimeMs: number, nowMs: number): [number, number, number, number] {
  const alpha = Math.round(quakeOpacity(eventTimeMs, nowMs) * 255);
  if (magnitude >= 6) return [255, 70, 70, alpha];
  if (magnitude >= 4.5) return [255, 150, 60, alpha];
  return [255, 215, 90, alpha];
}

export function createQuakeLayer(
  quakes: QuakeEvent[],
  nowMs: number,
  opts?: { onPick?: (q: QuakeEvent) => void },
) {
  if (quakes.length === 0) return null;
  return new ScatterplotLayer<QuakeEvent>({
    id: "osint-quakes",
    data: quakes,
    getPosition: (q) => [q.lon, q.lat],
    getRadius: (q) => quakeRadiusM(q.magnitude),
    getFillColor: (q) => {
      const [r, g, b, a] = quakeColor(q.magnitude, q.timeMs, nowMs);
      return [r, g, b, Math.round(a * 0.25)];
    },
    getLineColor: (q) => quakeColor(q.magnitude, q.timeMs, nowMs),
    getLineWidth: 1.5,
    lineWidthUnits: "pixels",
    stroked: true,
    filled: true,
    radiusUnits: "meters",
    pickable: true,
    onClick: opts?.onPick ? (info) => { if (info.object) opts.onPick!(info.object); return true; } : undefined,
  });
}

// ── Aircraft ──────────────────────────────────────────────────────────────

/** Dead-reckoned position: advance along the current track at the reported
 * ground speed for the time since the position report. Flat-earth step is
 * exact enough for ≤60 s extrapolation at airliner speeds (<0.02° error). */
export function deadReckon(state: AircraftState, nowMs: number): [number, number] {
  const dtS = Math.max(0, Math.min(120, (nowMs - state.timeMs) / 1000));
  if (state.onGround || state.velocityMps <= 0 || dtS === 0) return [state.lon, state.lat];
  const distM = state.velocityMps * dtS;
  const headingRad = state.headingDeg * DEG_TO_RAD;
  const dLat = (distM * Math.cos(headingRad)) / EARTH_RADIUS_M / DEG_TO_RAD;
  const cosLat = Math.max(0.05, Math.cos(state.lat * DEG_TO_RAD));
  const dLon = (distM * Math.sin(headingRad)) / (EARTH_RADIUS_M * cosLat) / DEG_TO_RAD;
  return [state.lon + dLon, state.lat + dLat];
}

const EMERGENCY_SQUAWKS = new Set(["7500", "7600", "7700"]);

export function aircraftColor(state: AircraftState): [number, number, number, number] {
  if (state.squawk && EMERGENCY_SQUAWKS.has(state.squawk)) return [255, 60, 60, 255];
  if (state.onGround) return [150, 150, 160, 200];
  // Altitude ramp: low = cyan, cruise = white-blue.
  const altKm = (state.altitudeM ?? 0) / 1000;
  const t = Math.max(0, Math.min(1, altKm / 12));
  return [Math.round(110 + 130 * t), Math.round(220 - 20 * t), 255, 230];
}

interface AircraftDart {
  position: [number, number];
  tip: [number, number];
  color: [number, number, number, number];
  state: AircraftState;
}

export function buildAircraftDarts(states: AircraftState[], nowMs: number, headingTickDeg = 0.06): AircraftDart[] {
  return states.map((state) => {
    const position = deadReckon(state, nowMs);
    const headingRad = state.headingDeg * DEG_TO_RAD;
    const cosLat = Math.max(0.05, Math.cos(position[1] * DEG_TO_RAD));
    return {
      position,
      tip: [
        position[0] + (Math.sin(headingRad) * headingTickDeg) / cosLat,
        position[1] + Math.cos(headingRad) * headingTickDeg,
      ],
      color: aircraftColor(state),
      state,
    };
  });
}

export function createAircraftLayers(
  states: AircraftState[],
  nowMs: number,
  opts?: { onPick?: (s: AircraftState) => void },
) {
  if (states.length === 0) return [];
  const darts = buildAircraftDarts(states, nowMs);
  return [
    new LineLayer<AircraftDart>({
      id: "osint-aircraft-heading",
      data: darts,
      getSourcePosition: (d) => d.position,
      getTargetPosition: (d) => d.tip,
      getColor: (d) => d.color,
      getWidth: 1.5,
      widthUnits: "pixels",
    }),
    new ScatterplotLayer<AircraftDart>({
      id: "osint-aircraft",
      data: darts,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 3.5,
      radiusUnits: "pixels",
      pickable: true,
      onClick: opts?.onPick
        ? (info) => { if (info.object) opts.onPick!(info.object.state); return true; }
        : undefined,
    }),
  ];
}
