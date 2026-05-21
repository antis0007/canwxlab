/**
 * Parses a WMS time extent string into an array of discrete timestamps in milliseconds.
 * Handles comma-separated lists and simple ISO intervals (start/end/step).
 */
export function parseWmsTimeDimension(timeExtent: string): number[] {
  if (!timeExtent || !timeExtent.trim()) return [];

  const parts = timeExtent.split(',').map((p) => p.trim());
  const times = new Set<number>();

  for (const part of parts) {
    if (part.includes('/')) {
      // ISO interval (e.g. 2024-01-01T00:00:00Z/2024-01-02T00:00:00Z/PT1H)
      // Only simple parsing supported for now, usually WMS uses comma separated or basic intervals
      const [startStr, endStr, duration] = part.split('/');
      const start = new Date(startStr).getTime();
      const end = new Date(endStr).getTime();

      if (!isNaN(start) && !isNaN(end) && duration && duration.startsWith('P')) {
        const stepMs = parseIsoDurationMs(duration);

        if (stepMs > 0) {
          for (let t = start; t <= end; t += stepMs) {
            times.add(t);
          }
        } else {
          times.add(start);
          times.add(end);
        }
      } else if (!isNaN(start) && !isNaN(end)) {
        times.add(start);
        times.add(end);
      }
    } else {
      const t = new Date(part).getTime();
      if (!isNaN(t)) {
        times.add(t);
      }
    }
  }

  return Array.from(times).sort((a, b) => a - b);
}

function parseIsoDurationMs(duration: string): number {
  const match = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) return 0;
  const days = Number.parseInt(match[1] ?? "0", 10);
  const hours = Number.parseInt(match[2] ?? "0", 10);
  const minutes = Number.parseInt(match[3] ?? "0", 10);
  const seconds = Number.parseInt(match[4] ?? "0", 10);
  return (
    days * 24 * 60 * 60 * 1000
    + hours * 60 * 60 * 1000
    + minutes * 60 * 1000
    + seconds * 1000
  );
}

/**
 * Finds the nearest time in availableTimes to the targetTime.
 */
export function nearestTime(targetTime: number, availableTimes: number[]): number | null {
  if (!availableTimes || availableTimes.length === 0) return null;

  let closest = availableTimes[0];
  let minDiff = Math.abs(targetTime - closest);

  for (let i = 1; i < availableTimes.length; i++) {
    const diff = Math.abs(targetTime - availableTimes[i]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = availableTimes[i];
    }
  }

  return closest;
}

/**
 * Finds the closest available time at or before targetTime.
 * Returns null when all available times are after targetTime.
 */
export function floorTime(targetTime: number, availableTimes: number[]): number | null {
  if (!availableTimes || availableTimes.length === 0) return null;
  let best: number | null = null;
  for (let i = 0; i < availableTimes.length; i += 1) {
    const candidate = availableTimes[i];
    if (candidate > targetTime) break;
    best = candidate;
  }
  return best;
}

/**
 * Checks if targetTime is exactly in the availableTimes or within range.
 */
export function isTimeInRange(targetTime: number, availableTimes: number[]): boolean {
  if (!availableTimes || availableTimes.length === 0) return false;
  return targetTime >= availableTimes[0] && targetTime <= availableTimes[availableTimes.length - 1];
}

export type WmsTimeAvailability = "available" | "before-range" | "after-range" | "no-time-dimension";

export interface WmsResolvedTime {
  resolvedTime: string | null;
  availability: WmsTimeAvailability;
  requestedTime: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
}

function availabilityForTarget(targetTime: number, availableTimes: number[]): WmsTimeAvailability {
  if (!availableTimes || availableTimes.length === 0) return "no-time-dimension";
  if (targetTime < availableTimes[0]) return "before-range";
  if (targetTime > availableTimes[availableTimes.length - 1]) return "after-range";
  return "available";
}

/**
 * Resolves the final WMS time string to use based on the layer's time policy.
 * @param globalTime The current global timeline time (ms).
 * @param availableTimes Array of available times in ms.
 * @param policy 'timeline' | 'global' | 'latest' | 'fixed'
 * @param fixedTime The user-selected fixed time (ms), if policy is 'fixed'.
 */
export function resolveWmsTimeForTimeline(
  globalTime: number,
  availableTimes: number[],
  policy: 'timeline' | 'global' | 'latest' | 'fixed',
  fixedTime?: number
): string | null {
  return resolveWmsTimeForTimelineDetailed(globalTime, availableTimes, policy, fixedTime).resolvedTime;
}

export function resolveWmsTimeForTimelineDetailed(
  globalTime: number,
  availableTimes: number[],
  policy: 'timeline' | 'global' | 'latest' | 'fixed',
  fixedTime?: number
): WmsResolvedTime {
  if (!availableTimes || availableTimes.length === 0) {
    const requestedMs = policy === "fixed" && fixedTime !== undefined ? fixedTime : globalTime;
    return {
      resolvedTime: null,
      availability: "no-time-dimension",
      requestedTime: Number.isFinite(requestedMs) ? formatWmsUtcSecond(requestedMs) : null,
      rangeStart: null,
      rangeEnd: null,
    };
  }

  let resolvedMs: number | null = null;
  const targetMs = policy === "latest"
    ? availableTimes[availableTimes.length - 1]
    : policy === "fixed" && fixedTime !== undefined
      ? fixedTime
      : globalTime;

  if (policy === 'latest') {
    resolvedMs = availableTimes[availableTimes.length - 1];
  } else if (policy === 'fixed' && fixedTime !== undefined) {
    resolvedMs = floorTime(fixedTime, availableTimes) ?? nearestTime(fixedTime, availableTimes);
  } else {
    // policy === 'timeline' or historical 'global'
    resolvedMs = floorTime(globalTime, availableTimes) ?? nearestTime(globalTime, availableTimes);
  }

  const rangeStart = availableTimes[0] ?? null;
  const rangeEnd = availableTimes[availableTimes.length - 1] ?? null;

  if (resolvedMs === null) {
    return {
      resolvedTime: null,
      availability: "no-time-dimension",
      requestedTime: Number.isFinite(targetMs) ? formatWmsUtcSecond(targetMs) : null,
      rangeStart: rangeStart !== null ? formatWmsUtcSecond(rangeStart) : null,
      rangeEnd: rangeEnd !== null ? formatWmsUtcSecond(rangeEnd) : null,
    };
  }

  // GeoMet WMS rejects fractional seconds in TIME, returning an XML exception
  // that MapLibre then reports as an unsupported image type. Keep whole-second
  // UTC timestamps for WMS 1.3.0 GetMap requests.
  return {
    resolvedTime: formatWmsUtcSecond(resolvedMs),
    availability: availabilityForTarget(targetMs, availableTimes),
    requestedTime: Number.isFinite(targetMs) ? formatWmsUtcSecond(targetMs) : null,
    rangeStart: rangeStart !== null ? formatWmsUtcSecond(rangeStart) : null,
    rangeEnd: rangeEnd !== null ? formatWmsUtcSecond(rangeEnd) : null,
  };
}

export function formatWmsUtcSecond(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}
