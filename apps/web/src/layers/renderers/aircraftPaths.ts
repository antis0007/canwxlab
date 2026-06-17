/** Pure deck.gl layer builders for aircraft historical paths and projections.
 *
 * Trace: line through all recorded positions (historical data).
 * Projection: forward dead-reckon along current heading/speed for 30 min.
 */

import { LineLayer, PathLayer } from "@deck.gl/layers";
import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import { aircraftColor, deadReckon } from "./osint";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

/** Trace of recorded positions (longitude, latitude pairs). */
export function createTracedPathLayer(
  positions: [number, number][],
  color: [number, number, number, number],
): PathLayer | null {
  if (positions.length < 2) return null;
  return new PathLayer({
    id: "aircraft-trace",
    data: [{ path: positions }],
    getPath: (d: { path: [number, number][] }) => d.path,
    getColor: () => color,
    getWidth: 1.5,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}

/** Dead-reckon forward PROJECTION_MINUTES at current speed/heading. */
const PROJECTION_MINUTES = 30;
const PROJECTION_STEPS = 10;

export function createProjectedPathLayer(
  state: AircraftState,
  nowMs: number,
): LineLayer | null {
  if (state.onGround || state.velocityMps <= 0) return null;
  const base = deadReckon(state, nowMs);
  const headingRad = state.headingDeg * DEG_TO_RAD;
  const totalDistM = state.velocityMps * PROJECTION_MINUTES * 60;
  const stepDistM = totalDistM / PROJECTION_STEPS;
  const points: [number, number][] = [base];
  let [lon, lat] = base;
  for (let i = 0; i < PROJECTION_STEPS; i++) {
    const cosLat = Math.max(0.05, Math.cos(lat * DEG_TO_RAD));
    const dLat = (stepDistM * Math.cos(headingRad)) / EARTH_RADIUS_M / DEG_TO_RAD;
    const dLon = (stepDistM * Math.sin(headingRad)) / (EARTH_RADIUS_M * cosLat) / DEG_TO_RAD;
    lon += dLon;
    lat += dLat;
    points.push([lon, lat]);
  }
  const color = aircraftColor(state);
  return new LineLayer({
    id: "aircraft-projected",
    data: points.slice(0, -1).map((start, i) => ({ start, end: points[i + 1] })),
    getSourcePosition: (d: { start: [number, number] }) => d.start,
    getTargetPosition: (d: { end: [number, number] }) => d.end,
    getColor: () => [color[0], color[1], color[2], Math.round(180 * (1 - 0.06))],
    getWidth: () => 1.2,
    widthUnits: "pixels",
    pickable: false,
  });
}
