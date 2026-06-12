/** AMV-style cloud motion vector overlay.
 *
 * Renders the derived optical-flow motion field as speed-colored arrows
 * (shaft + two head strokes) using deck.gl LineLayers. Vectors are static
 * per satellite scene, matching professional AMV display behavior.
 */

import { LineLayer } from "@deck.gl/layers";

import type { MotionVectorSample } from "./satellite/motionField";

const DEG_TO_RAD = Math.PI / 180;

/** Speed → color, 4-stop ramp (km/h thresholds). */
export function colorForSpeed(speedMps: number): [number, number, number, number] {
  const kmh = speedMps * 3.6;
  if (kmh < 20) return [120, 200, 255, 220];
  if (kmh < 50) return [120, 255, 160, 220];
  if (kmh < 90) return [255, 210, 90, 230];
  return [255, 110, 90, 240];
}

/** Arrow shaft length in degrees of longitude, clamped to a sane range so
 * slow motion stays visible and jet-level motion does not span the map. */
export function arrowLengthDeg(speedMps: number, viewSpanLonDeg: number): number {
  const kmh = Math.min(120, speedMps * 3.6);
  const minLen = viewSpanLonDeg * 0.008;
  const maxLen = viewSpanLonDeg * 0.045;
  return minLen + (maxLen - minLen) * (kmh / 120);
}

export interface ArrowSegment {
  source: [number, number];
  target: [number, number];
  color: [number, number, number, number];
}

export function buildArrowSegments(
  vectors: MotionVectorSample[],
  viewSpanLonDeg: number,
): ArrowSegment[] {
  const segments: ArrowSegment[] = [];

  for (const vector of vectors) {
    const length = arrowLengthDeg(vector.speedMps, viewSpanLonDeg);
    if (!(length > 0) || !Number.isFinite(vector.bearingFromDeg)) continue;

    // Arrow points TOWARD the motion direction.
    const toRad = ((vector.bearingFromDeg + 180) % 360) * DEG_TO_RAD;
    const cosLat = Math.max(0.2, Math.cos(vector.lat * DEG_TO_RAD));
    const dLon = (Math.sin(toRad) * length) / cosLat;
    const dLat = Math.cos(toRad) * length;

    const tail: [number, number] = [vector.lon - dLon / 2, vector.lat - dLat / 2];
    const tip: [number, number] = [vector.lon + dLon / 2, vector.lat + dLat / 2];
    const color = colorForSpeed(vector.speedMps);

    segments.push({ source: tail, target: tip, color });

    // Two head strokes at ±150° from the shaft direction.
    const headLength = length * 0.35;
    for (const side of [150, -150]) {
      const headRad = toRad + side * DEG_TO_RAD;
      segments.push({
        source: tip,
        target: [
          tip[0] + (Math.sin(headRad) * headLength) / cosLat,
          tip[1] + Math.cos(headRad) * headLength,
        ],
        color,
      });
    }
  }

  return segments;
}

export function createMotionVectorLayer(
  vectors: MotionVectorSample[],
  viewSpanLonDeg: number,
): LineLayer<ArrowSegment> | null {
  if (vectors.length === 0) return null;
  const segments = buildArrowSegments(vectors, viewSpanLonDeg);

  return new LineLayer<ArrowSegment>({
    id: "cloud-motion-vectors",
    data: segments,
    getSourcePosition: (d) => d.source,
    getTargetPosition: (d) => d.target,
    getColor: (d) => d.color,
    getWidth: 1.6,
    widthUnits: "pixels",
    pickable: false,
  });
}
