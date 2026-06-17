/** OSINT events → timeline pins (spec: 2026-06-12-osint-fusion-program.md,
 * Phase 2). Pure mapping: anything carrying a `timeMs` becomes a clickable
 * marker on the scrubber, so the fusion timeline ties live signals to the
 * same deep weather time. No rendering, no network — testable in isolation. */

import type { AircraftState } from "../lib/liveFeeds/aircraft";
import type { QuakeEvent } from "../lib/liveFeeds/quakes";

export type EventPinKind = "quake" | "aircraft-emergency";
export type EventPinSeverity = "info" | "warning" | "critical";

export interface TimelineEventPin {
  id: string;
  timeMs: number;
  label: string;
  kind: EventPinKind;
  severity: EventPinSeverity;
  lon?: number;
  lat?: number;
}

export interface PlacedEventPin extends TimelineEventPin {
  /** Horizontal position on the timeline track, 0–100. */
  leftPct: number;
}

/** Transponder emergency squawks: hijack, radio failure, general emergency. */
const EMERGENCY_SQUAWKS: Record<string, string> = {
  "7500": "hijack",
  "7600": "radio failure",
  "7700": "emergency",
};

export function quakesToPins(quakes: QuakeEvent[], minMagnitude = 4.5): TimelineEventPin[] {
  const pins: TimelineEventPin[] = [];
  for (const q of quakes) {
    if (!Number.isFinite(q.magnitude) || q.magnitude < minMagnitude) continue;
    if (!Number.isFinite(q.timeMs)) continue;
    pins.push({
      id: `quake:${q.id}`,
      timeMs: q.timeMs,
      label: `M${q.magnitude.toFixed(1)} ${q.place}`,
      kind: "quake",
      // ≥6.0 is a serious quake; flag it critical.
      severity: q.magnitude >= 6.0 ? "critical" : "warning",
      lon: q.lon,
      lat: q.lat,
    });
  }
  return pins;
}

export function aircraftEmergenciesToPins(aircraft: AircraftState[]): TimelineEventPin[] {
  const pins: TimelineEventPin[] = [];
  for (const a of aircraft) {
    const reason = a.squawk ? EMERGENCY_SQUAWKS[a.squawk] : undefined;
    if (!reason || !Number.isFinite(a.timeMs)) continue;
    const who = a.callsign || a.id;
    pins.push({
      id: `air:${a.id}:${a.squawk}`,
      timeMs: a.timeMs,
      label: `${who} squawk ${a.squawk} (${reason})`,
      kind: "aircraft-emergency",
      severity: "critical",
    });
  }
  return pins;
}

/** Place pins on the visible timeline window; events outside it are dropped.
 * Deduplicates by id (a still-emergency aircraft repeats every poll). */
export function placeEventPins(
  pins: TimelineEventPin[],
  windowStartMs: number,
  frameCount: number,
  frameIntervalMs: number,
): PlacedEventPin[] {
  const windowDurationMs = Math.max(1, (frameCount - 1) * frameIntervalMs);
  const byId = new Map<string, PlacedEventPin>();
  for (const pin of pins) {
    const leftPct = ((pin.timeMs - windowStartMs) / windowDurationMs) * 100;
    if (leftPct < 0 || leftPct > 100 || !Number.isFinite(leftPct)) continue;
    byId.set(pin.id, { ...pin, leftPct });
  }
  return Array.from(byId.values()).sort((a, b) => a.timeMs - b.timeMs);
}

/** Timeline frame nearest an event time, for seek-on-click. */
export function frameForEventTime(
  timeMs: number,
  windowStartMs: number,
  frameCount: number,
  frameIntervalMs: number,
): number {
  const frame = Math.round((timeMs - windowStartMs) / frameIntervalMs);
  return Math.max(0, Math.min(frameCount - 1, frame));
}
