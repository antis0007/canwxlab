/** Pure deck.gl layer builders for the orbital (satellite) layer.
 *
 * Spec law 2: given propagated `Satellite` records and a time, build subpoint
 * dots + ground-track ribbons. SGP4 runs here (cheap per satellite) but no
 * fetching, no React, no GPU state — unit-testable from a TLE.
 *
 * Ground-track cost is O(satellites × windowSamples); the allow-listed default
 * groups are small (tens). For large groups the caller passes `maxTracks` to
 * cap ribbon work while every satellite still gets a subpoint dot.
 */

import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import { groundTrackSegments, subPoint, type Satellite } from "../../lib/orbits/propagate";

export interface OrbitSubPoint {
  name: string;
  noradId: string;
  lon: number;
  lat: number;
  altKm: number;
}

interface TrackSegment {
  path: [number, number][];
  altKm: number;
}

/** Altitude-regime color: LEO cyan, MEO amber, GEO orange. */
export function altitudeColor(altKm: number): [number, number, number] {
  if (altKm < 2000) return [90, 220, 255]; // LEO
  if (altKm < 30000) return [255, 200, 90]; // MEO
  return [255, 140, 70]; // GEO and beyond
}

export function buildOrbitData(
  satellites: Satellite[],
  nowMs: number,
  maxTracks = 60,
): { subPoints: OrbitSubPoint[]; tracks: TrackSegment[] } {
  const date = new Date(nowMs);
  const subPoints: OrbitSubPoint[] = [];
  const tracks: TrackSegment[] = [];
  for (let i = 0; i < satellites.length; i++) {
    const sat = satellites[i];
    const sp = subPoint(sat.satrec, date);
    if (!sp) continue;
    subPoints.push({ name: sat.name, noradId: sat.noradId, lon: sp.lon, lat: sp.lat, altKm: sp.altKm });
    if (i < maxTracks) {
      for (const path of groundTrackSegments(sat.satrec, date)) {
        if (path.length > 1) tracks.push({ path, altKm: sp.altKm });
      }
    }
  }
  return { subPoints, tracks };
}

export function createOrbitLayers(satellites: Satellite[], nowMs: number, maxTracks = 60) {
  if (satellites.length === 0) return [];
  const { subPoints, tracks } = buildOrbitData(satellites, nowMs, maxTracks);
  return [
    new PathLayer<TrackSegment>({
      id: "osint-orbit-tracks",
      data: tracks,
      getPath: (t) => t.path,
      getColor: (t) => [...altitudeColor(t.altKm), 110] as [number, number, number, number],
      getWidth: 1,
      widthUnits: "pixels",
      jointRounded: true,
      capRounded: true,
    }),
    new ScatterplotLayer<OrbitSubPoint>({
      id: "osint-orbit-subpoints",
      data: subPoints,
      getPosition: (s) => [s.lon, s.lat],
      getFillColor: (s) => [...altitudeColor(s.altKm), 255] as [number, number, number, number],
      getRadius: 4,
      radiusUnits: "pixels",
      stroked: true,
      getLineColor: [10, 18, 30, 220],
      getLineWidth: 1,
      lineWidthUnits: "pixels",
      pickable: true,
    }),
  ];
}
