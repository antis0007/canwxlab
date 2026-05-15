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

      if (!isNaN(start) && !isNaN(end) && duration && duration.startsWith('PT')) {
        let stepMs = 0;
        // Simple regex to extract H and M from PT#H#M
        const hMatch = duration.match(/(\d+)H/);
        const mMatch = duration.match(/(\d+)M/);
        
        if (hMatch) stepMs += parseInt(hMatch[1]) * 60 * 60 * 1000;
        if (mMatch) stepMs += parseInt(mMatch[1]) * 60 * 1000;

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
 * Checks if targetTime is exactly in the availableTimes or within range.
 */
export function isTimeInRange(targetTime: number, availableTimes: number[]): boolean {
  if (!availableTimes || availableTimes.length === 0) return false;
  return targetTime >= availableTimes[0] && targetTime <= availableTimes[availableTimes.length - 1];
}

/**
 * Resolves the final WMS time string to use based on the layer's time policy.
 * @param globalTime The current global timeline time (ms).
 * @param availableTimes Array of available times in ms.
 * @param policy 'global' | 'latest' | 'fixed'
 * @param fixedTime The user-selected fixed time (ms), if policy is 'fixed'.
 */
export function resolveWmsTimeForTimeline(
  globalTime: number,
  availableTimes: number[],
  policy: 'global' | 'latest' | 'fixed',
  fixedTime?: number
): string | null {
  if (!availableTimes || availableTimes.length === 0) return null;

  let resolvedMs: number | null = null;

  if (policy === 'latest') {
    resolvedMs = availableTimes[availableTimes.length - 1];
  } else if (policy === 'fixed' && fixedTime !== undefined) {
    resolvedMs = nearestTime(fixedTime, availableTimes);
  } else {
    // policy === 'global'
    resolvedMs = nearestTime(globalTime, availableTimes);
  }

  if (resolvedMs === null) return null;

  return new Date(resolvedMs).toISOString();
}
