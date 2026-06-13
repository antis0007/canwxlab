# OSINT Fusion Program — Living Spec

Date: 2026-06-12
Status: Phase 1 implemented; later phases are designs awaiting their cycle.
Revision: 2 (see Revision Log — this spec updates itself as phases land)

## Vision

The Earth from Snow Crash: one globe, every public realtime signal layered
over deep weather time. Not a pile of layers — a *fusion instrument*: every
source is time-indexed, every event lands on the same timeline, every pixel
is interrogable, and everything seen is archived locally and replayable.

## Design laws (apply to every phase)

1. **One kernel, many sources.** All realtime sources go through the same
   ~150-line feed client. A new source is a *data definition* (URL builder +
   parser + cadence), never new plumbing.
2. **Sources are pure data → layers are pure functions.** Parsers return
   typed events; deck layers are built by pure functions of (events, nowMs).
   Both are unit-testable without network or GPU.
3. **Time is the bus.** Every event carries `timeMs`. Anything with `timeMs`
   can be pinned to the timeline, replayed from archive, and exported.
4. **Honest failure.** Feeds report status (live/degraded/down + last error);
   the UI shows it; nothing silently goes stale.
5. **Archive what you see.** Feed snapshots flow through the same 7-day
   CacheStorage archive as imagery, so history replays offline.

## Algorithms (chosen for optimality at our scales)

- **Polling with decorrelated jitter backoff** (AWS-style): healthy feeds
  poll at base cadence; failures back off `min(cap, rand(base, prev*3))` —
  optimal recovery vs thundering herd for N ≤ dozens of feeds.
- **Viewport gating:** feeds that accept bbox parameters fetch only the
  visible region (+25% pad), re-fetching when the view moves > ⅓ of its span
  (Chebyshev distance on mercator centers — O(1) per check).
- **Event identity & dedupe:** stable id per event (source id or
  `geohash6(lat,lon)|round(timeMs, cadence)`); Map-keyed upsert is O(1)
  amortized, no spatial index needed below ~50k points. If a source exceeds
  that, switch to a uniform grid hash (cell = render pixel at min zoom).
- **Aircraft motion:** between polls, positions dead-reckon along great
  circles (`pos + v·Δt` on the unit sphere via slerp) — visually continuous
  at 10–30 s cadences with zero extra requests.
- **Satellite tracks (phase 3):** SGP4 propagation client-side from the TLE
  cache the API already maintains (`cosmic_celestrak` adapter); sample track
  ±45 min at 30 s steps, decimate with Ramer–Douglas–Peucker (ε = 1 px).

## Phases

### Phase 1 — Feed kernel + first two sources  ✅ implemented this revision

Modules (all new, no existing file grows):

| Module | Responsibility | LOC budget |
|---|---|---|
| `lib/liveFeeds/feedClient.ts` | Generic typed poller: start/stop, bbox gating, abort, jittered backoff, status reporting | ≤ 170 |
| `lib/liveFeeds/quakes.ts` | USGS all-day GeoJSON → `QuakeEvent[]` (no key, global) | ≤ 60 |
| `lib/liveFeeds/aircraft.ts` | OpenSky anonymous state vectors (bbox) → `AircraftState[]` | ≤ 80 |
| `layers/renderers/osint.ts` | Pure deck-layer builders: quake pulse rings (magnitude → radius, age → fade), aircraft dart + heading + altitude color | ≤ 140 |

Wiring: App owns a `useLiveFeed` instance per enabled source and passes
built layers to MapView through ONE new prop (`extraDeckLayers`) — MapView
stays a renderer, App stays the composer. TopBar gains an OSINT group
(`EQ`, `AIR`) following the existing VECT pattern.

Acceptance: toggling EQ shows last-24 h earthquakes pulsing by recency;
toggling AIR shows live aircraft moving smoothly between polls; killing the
network degrades both to visible "degraded" status without console spam.

### Phase 2 — Fusion timeline

Events as timeline pins: a `TimelineEventRange[]` prop (reuse the
warning-range rendering) mapping quakes/alert onsets/aircraft emergencies
(squawk 7500/7600/7700) onto the scrubber. Clicking a pin seeks the
timeline; the archive replays the weather at that instant. New module
`time/eventPins.ts` (pure mapping, ≤ 80 LOC). No new render machinery.

### Phase 3 — Orbital layer

SGP4 (satellite.js) over the existing TLE endpoint: live subpoints +
ground-track ribbons for selected constellations; pass prediction for the
clicked location ("next overhead: …"). Modules: `lib/orbits/propagate.ts`
(pure), `layers/renderers/orbits.ts`. Track decimation per Algorithms.

### Phase 4 — Anomaly watch (self-improving loop)

Baseline-and-deviation engine over feed history: per geohash5 cell, keep
EWMA + variance of feed-event rates (quakes, lightning when added, aircraft
density). Deviation > kσ → watch event on the timeline. Baselines persist in
the existing event store; every flagged anomaly the operator dismisses or
confirms adjusts k per cell (simple online calibration — the self-improving
part is *measured*, not vibes). Server-side in the existing FastAPI app.

### Phase 5 — Source expansion (each ~1 day given the kernel)

AIS ships (aisstream.io websocket — kernel grows a websocket transport),
NASA FIRMS thermal anomalies, GDELT news geo-events, lightning (Blitzortung
websocket). Each is a definition + parser + pure layer builder.

## Required refactors (tracked, not optional)

- **R1 (done in Phase 1):** MapView accepts composed `extraDeckLayers`
  instead of growing a prop per feature.
- **R2:** TopBar toggle registry — `{id, label, title}[]` + one callback,
  replacing per-toggle prop pairs (currently 3 pairs; refactor at 5).
- **R3:** App.tsx exceeds 1200 lines — extract `useExportController` and
  `useSatelliteState` hooks when either next changes.
- **R4:** MapView layer assembly (≈300 lines of memos) → `layers/compose.ts`
  pure function when Phase 3 lands its layers.

## Self-improvement protocol (how this spec stays alive)

After each phase ships: (1) record what the runtime taught us in the
Revision Log; (2) adjust later phases' designs accordingly; (3) tighten any
law that was violated and note the violation; (4) if a module exceeded its
LOC budget, either justify in one line or schedule the refactor.

## Revision Log

- r1: Initial program (phases 1–5, laws, algorithms).
- r2: Phase 1 landed. Runtime lesson: OpenSky anonymous quota is tight
  (~400 req/day) — cadence set to 30 s and fetches gate on layer visibility;
  Phase 5 should prefer push transports (websockets) over polling wherever
  available. Law 4 upheld: feed status surfaces in the TopBar chips' title.
- r3: Live verification: USGS feed live end-to-end; OpenSky direct browser
  fetch is CORS-blocked from this origin — chip honestly reports
  "degraded: Failed to fetch" (law 4 validated under real failure).
  **Phase 1.1 (next):** add `/api/osint/passthrough` to the FastAPI service
  (allow-listed upstream hosts, shared TTL cache) and point browser-hostile
  feeds at it; the kernel needs no change (URL builders swap to the proxy).
  Design consequence recorded: every future feed definition must declare
  `transport: "direct" | "proxy"` so CORS posture is explicit, not
  discovered in production.
- r4: Phase 1.1 landed — but the generic passthrough was NOT built. Reuse
  beat new plumbing: the API already had `/api/v1/aircraft/positions`
  (OpenSky wrapped with TTL cache + rate-limit handling), so the aircraft
  feed targets that and the parser reads its GeoJSON. `transport` field
  added as the law mandated (aircraft = proxy). Verified live: AIR fetches
  our proxy 200, no CORS. **Revised guidance:** before adding the generic
  passthrough in Phase 5, check whether a typed cached endpoint already
  exists for the source — prefer it. Build the generic passthrough only
  for feeds with no existing server route (FIRMS, GDELT).
