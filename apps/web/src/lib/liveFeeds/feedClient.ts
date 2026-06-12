/** Generic realtime feed poller — the single kernel behind every OSINT
 * source (spec: docs/superpowers/specs/2026-06-12-osint-fusion-program.md).
 *
 * A source is a *definition* (URL builder + parser + cadence); this class
 * supplies the plumbing every feed needs exactly once: polling, viewport
 * gating, aborts, decorrelated-jitter backoff, and honest status reporting.
 * No React, no globals — construct, start, read, stop.
 */

export type LonLatBounds = [west: number, south: number, east: number, north: number];

export interface FeedDefinition<T> {
  id: string;
  /** Base poll cadence while healthy. */
  intervalMs: number;
  /** Build the request URL; bbox is null for global feeds. */
  url: (bbox: LonLatBounds | null) => string;
  /** Parse a successful response body into typed events. */
  parse: (body: unknown) => T[];
  /** Re-fetch when the viewport center moves more than this fraction of the
   * current span (Chebyshev distance). Default ⅓; global feeds ignore it. */
  bboxMoveThreshold?: number;
}

export interface FeedStatus {
  state: "idle" | "live" | "degraded" | "down";
  lastSuccessMs: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

const BACKOFF_CAP_MS = 5 * 60 * 1000;
const DOWN_AFTER_FAILURES = 3;

/** Decorrelated jitter (AWS): sleep = min(cap, rand(base, prev * 3)). */
export function nextBackoffMs(baseMs: number, previousMs: number, random = Math.random): number {
  const upper = Math.max(baseMs, previousMs * 3);
  return Math.min(BACKOFF_CAP_MS, baseMs + random() * (upper - baseMs));
}

/** True when the view moved far enough (Chebyshev on centers, in spans) to
 * justify a re-fetch of a bbox-gated feed. */
export function bboxMovedBeyond(
  previous: LonLatBounds,
  current: LonLatBounds,
  thresholdFraction: number,
): boolean {
  const spanLon = Math.max(1e-6, previous[2] - previous[0]);
  const spanLat = Math.max(1e-6, previous[3] - previous[1]);
  const dLon = Math.abs((current[0] + current[2]) / 2 - (previous[0] + previous[2]) / 2);
  const dLat = Math.abs((current[1] + current[3]) / 2 - (previous[1] + previous[3]) / 2);
  const grew = (current[2] - current[0]) / spanLon > 1.5 || spanLon / Math.max(1e-6, current[2] - current[0]) > 1.5;
  return grew || Math.max(dLon / spanLon, dLat / spanLat) > thresholdFraction;
}

export class FeedClient<T> {
  private events: T[] = [];
  private status: FeedStatus = { state: "idle", lastSuccessMs: null, lastError: null, consecutiveFailures: 0 };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private bbox: LonLatBounds | null = null;
  private fetchedBbox: LonLatBounds | null = null;
  private backoffMs = 0;
  private running = false;

  constructor(
    private definition: FeedDefinition<T>,
    private onChange: (events: T[], status: FeedStatus) => void,
    private fetchJson: (url: string, signal: AbortSignal) => Promise<unknown> = defaultFetchJson,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  /** Update the viewport; triggers an immediate re-fetch only when the view
   * moved beyond the definition's threshold. */
  setBbox(bbox: LonLatBounds | null): void {
    this.bbox = bbox;
    if (!this.running || bbox === null) return;
    const threshold = this.definition.bboxMoveThreshold ?? 1 / 3;
    if (this.fetchedBbox === null || bboxMovedBeyond(this.fetchedBbox, bbox, threshold)) {
      this.restartNow();
    }
  }

  getEvents(): T[] {
    return this.events;
  }

  getStatus(): FeedStatus {
    return { ...this.status };
  }

  private restartNow(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    void this.poll();
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (!this.running) return;
    this.controller = new AbortController();
    const requestBbox = this.bbox;

    try {
      const body = await this.fetchJson(this.definition.url(requestBbox), this.controller.signal);
      if (!this.running) return;
      this.events = this.definition.parse(body);
      this.fetchedBbox = requestBbox;
      this.backoffMs = 0;
      this.status = {
        state: "live",
        lastSuccessMs: Date.now(),
        lastError: null,
        consecutiveFailures: 0,
      };
      this.onChange(this.events, this.getStatus());
      this.schedule(this.definition.intervalMs);
    } catch (err) {
      if (!this.running || (err instanceof DOMException && err.name === "AbortError")) return;
      const failures = this.status.consecutiveFailures + 1;
      this.status = {
        state: failures >= DOWN_AFTER_FAILURES ? "down" : "degraded",
        lastSuccessMs: this.status.lastSuccessMs,
        lastError: err instanceof Error ? err.message : String(err),
        consecutiveFailures: failures,
      };
      this.onChange(this.events, this.getStatus());
      this.backoffMs = nextBackoffMs(this.definition.intervalMs, this.backoffMs || this.definition.intervalMs);
      this.schedule(this.backoffMs);
    }
  }
}

async function defaultFetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, mode: "cors" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}
