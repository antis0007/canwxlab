# Phase A: Foundation Hardening — Event Sourcing + Provenance-First Architecture

**Date:** 2026-05-17
**Status:** Design approved, awaiting implementation
**Depends on:** Current canwxlab v0.1.0 codebase
**Unlocks:** Phase B (cyberspace mode), Phase C (ML lab)

## Problem Statement

The current canwxlab platform ingests weather data from ECCC GeoMet and serves it as transient `WeatherLayer` and `Observation` objects. These are view-centric: they represent the current state but discard history, provenance, and the evidence chain.

**What can't be done today:**
- Answer "what did we know and when did we know it?" for any rendered value
- Replay a historical time window to validate a forecast against reality
- Detect when two sources disagree about the same spatiotemporal cell
- Trace a rendered pixel back to its source adapter, raw URL, and confidence
- Train an ML model on an exact historical slice of observations
- Distinguish observed data from simulated/forecast/synthetic data in the UI

## Design Principles

1. **Event log is the source of truth.** Every observation enters as an append-only `SpatiotemporalEvent`. The log is never mutated — corrections are new events that supersede old ones.

2. **Bitemporal model.** Every event carries `valid_time` (when the fact was true in the world) and `observed_time` (when the system learned it). This is the minimum required for forecast validation.

3. **Provenance on every rendered value.** Any pixel or number shown to the user must be traceable back through the event chain to its source adapter and raw ingest record.

4. **Backward compatible.** Existing `WeatherLayer`, `Observation`, and `AlertFeature` models continue to work. They become materialized views derived from the event log. No breaking changes to the frontend during the migration.

5. **Confidence and truth mode are first-class.** Every value carries a `ConfidenceLevel` (confirmed/probable/estimated/conflicting/stale/synthetic/restricted) and a `TruthMode` (observed/legal/physical/operational/predicted/historical/hypothetical).

## Architecture

```
Source Adapters (ECCC, NOAA, Mock)
        │
        │  emit_events()
        ▼
┌───────────────────┐
│   Event Store     │  ← NEW: core/event_store.py
│  (append-only)    │     SQLite for dev, Parquet for prod
│  Spatiotemporal   │
│  Event log        │
└───────┬───────────┘
        │
        │  replay / materialize
        ▼
┌───────────────────┐
│  World State      │  ← NEW: core/world_state.py
│  (derived)        │     Materialized view: one row per (h3_cell, variable)
│  DerivedCellState │     Conflict records where two sources disagree
└───────┬───────────┘
        │
        ├──► Existing API surface (layers, observations, alerts)
        │    unchanged — just backed by derived state
        │
        ├──► Evidence API (NEW) — GET /api/evidence/...
        │    provenance, history, conflicts, cell state
        │
        └──► Tile/Query APIs (future phases)
```

## New Files

| File | Purpose |
|------|---------|
| `services/api/canwxlab_api/core/__init__.py` | Package init |
| `services/api/canwxlab_api/core/event_store.py` | Append-only event log with query support |
| `services/api/canwxlab_api/core/world_state.py` | Materialized derived state from event replay |
| `services/api/canwxlab_api/routes/evidence.py` | Evidence API endpoints |

## Modified Files

| File | Change |
|------|--------|
| `models.py` | `SpatiotemporalEvent`, `DerivedCellState`, `EvidenceChain`, enums added |
| `adapters/base.py` | `emit_events()` contract added |
| `adapters/composite.py` | Event store injection, `emit_events()` override |
| `adapters/eccc_geomet.py` | `emit_events()` implementation for ECCC observations |
| `adapters/mock.py` | `emit_events()` implementation for mock data |
| `main.py` | Evidence router mounted |
| `dependencies.py` | Event store as FastAPI dependency |
| `config.py` | Event store config (db path, retention) |

## Core Schema

### SpatiotemporalEvent

```python
class SpatiotemporalEvent(BaseModel):
    event_id: UUID                    # unique, generated at ingest
    event_kind: str                   # "meteorological.observation", etc.
    valid_from: datetime              # when the fact was true
    valid_to: datetime | None         # None = still valid
    observed_at: datetime             # when the system learned it
    ingested_at: datetime             # when our system processed it
    superseded_by: UUID | None        # replacement event (corrections)
    longitude: float
    latitude: float
    elevation_m: float | None
    h3_cell: str | None               # H3 index at resolution 5-7
    variable: str
    value: float
    unit: str
    source_id: str
    source_adapter: SourceAdapterRef | None
    confidence: float                 # 0.0–1.0
    confidence_level: ConfidenceLevel # enum
    truth_mode: TruthMode             # enum
    attribution: str
    license_url: str | None
    raw_properties: dict
```

### DerivedCellState

```python
class DerivedCellState(BaseModel):
    h3_cell: str
    variable: str
    value: float                      # current best estimate
    unit: str
    source_id: str
    confidence: float
    confidence_level: ConfidenceLevel
    truth_mode: TruthMode
    derived_at: datetime
    derived_from_event_ids: list[UUID]
    conflicting_event_ids: list[UUID] # empty = no conflicts
```

## Event Store (`core/event_store.py`)

### Responsibilities
- Append `SpatiotemporalEvent` records (never mutate)
- Query by time range, bounding box, H3 cell, variable
- Find latest event for a (cell, variable) pair
- Detect superseded events
- Schema validate on ingest

### Storage Strategy
- **Dev**: SQLite with JSON column for raw_properties, indexed on (h3_cell, variable, valid_from)
- **Prod path**: Append-only Parquet files partitioned by date, with DuckDB for query — zero-cost migration path from SQLite
- **Retention**: Configurable. Default: 90 days hot, archive to object storage

### Key Methods
```python
class EventStore:
    async def append(events: list[SpatiotemporalEvent]) -> EventIngestionResult
    async def query(bbox, time_range, variables, limit) -> list[SpatiotemporalEvent]
    async def latest(cell: str, variable: str) -> SpatiotemporalEvent | None
    async def history(cell: str, variable: str, from_, to) -> list[SpatiotemporalEvent]
    async def conflicts(cell: str, variable: str) -> list[DerivedCellState]
```

## Evidence API (`routes/evidence.py`)

| Method | Path | Returns | Purpose |
|--------|------|---------|---------|
| GET | `/api/evidence/{object_id}/provenance` | `EvidenceChain` | Full event trace for one value |
| GET | `/api/evidence/{object_id}/history` | `list[SpatiotemporalEvent]` | Time-ordered history |
| GET | `/api/evidence/{object_id}/conflicts` | `list[DerivedCellState]` | Competing claims |
| GET | `/api/evidence/cells?h3=&variable=` | `DerivedCellState` | Current best for cell |
| POST | `/api/events/ingest` | `EventIngestionResult` | Append events |
| GET | `/api/events?bbox=&from=&to=` | `list[SpatiotemporalEvent]` | Raw event query |

`object_id` is composed as `{h3_cell}/{variable}` or `{source_id}/{station_id}/{variable}`.

## Migration Strategy

### Stage 1: Schema and store (no behavior change)
1. Add new models to `models.py`
2. Implement `event_store.py` with SQLite backend
3. Implement `world_state.py` with in-memory materialization
4. Add evidence routes (return empty/not-implemented initially)
5. Write tests for event append, query, latest, supersede

### Stage 2: Adapter opt-in
1. Implement `emit_events()` on `MockSourceAdapter` (easy, deterministic)
2. Implement `emit_events()` on `EcccGeoMetSourceAdapter` (maps OGC API → events)
3. Wire `CompositeWeatherSourceAdapter.emit_events()` to fan out + append to store
4. Call `emit_events()` alongside existing `fetch_*()` methods in routes
5. Existing API surface unchanged — events are a side effect

### Stage 3: Derived state replaces direct adapter output
1. Routes read from `world_state` instead of calling adapter directly
2. World state materialized from event log on a timer (every 60s or on ingest)
3. Existing `WeatherLayer` and `Observation` models still returned — just sourced from derived state

### Stage 4: Frontend evidence panels
1. Add `EvidencePanel` component to `RightInspector`
2. Add "View Provenance" button to `InspectorPanel` value rows
3. Add `ConfidenceLevel` color badges to `StatusBadge`
4. Add `TruthMode` toggle to `LeftSidebar` layer list

## Confidence Level → Visual Encoding

| Level | Color | Meaning | Example |
|-------|-------|---------|---------|
| confirmed | Green #4caf50 | Multiple high-quality sources agree | Weather station temp |
| probable | Blue #2196f3 | One good source, no disagreement | Radar-derived precip |
| estimated | Yellow #ff9800 | Interpolated or inferred | Grid cell between stations |
| conflicting | Red #f44336 | Sources disagree | Two models, different temps |
| stale | Gray #9e9e9e | Data older than freshness threshold | Station offline 2h |
| synthetic | Purple #9c27b0 | Generated by model/simulation | Mock data, forecast |
| restricted | Dark #424242 | User lacks permission to see raw source | Classified sensor |

## Testing Strategy

- **Event store tests**: Append, query by bbox, query by time, supersede chain, conflict detection, schema validation rejection
- **Adapter emit tests**: Mock adapter emits valid events with correct bitemporal timestamps; ECCC adapter normalizes real OGC API responses into events
- **World state tests**: Materialize from known event set, verify latest-wins semantics, verify conflict detection when two events claim same (cell, variable)
- **API integration tests**: Evidence endpoints return correct chains from known event fixtures
- **No regressions**: Existing `/api/layers`, `/api/observations`, `/api/alerts` tests continue to pass

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Event append (single) | < 5ms | SQLite insert |
| Event append (batch 1000) | < 100ms | Bulk insert |
| Latest cell query | < 10ms | Indexed on (h3_cell, variable, valid_from DESC) |
| Time-range query (1M events) | < 200ms | B-tree on valid_from |
| World state materialize (100K cells) | < 1s | In-memory aggregation |
| Evidence chain for object | < 50ms | Walk supersede chain |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Event log grows unbounded | Configurable retention (90d hot), Parquet archive for cold storage |
| Adapters don't emit events consistently | `emit_events()` is optional with default no-op; enforce at test level with shared validation |
| Dual-write (old API + events) causes drift | Stage 3 eliminates dual-write; until then, integration test compares adapter output to event-derived state |
| SQLite can't handle prod throughput | Parquet + DuckDB migration path designed in from day one; same query interface |

## What Phase A Does NOT Include

- Conflict resolution engine (that's Phase A.5, after a second source is onboarded)
- Real-time push/SSE for live event streaming (REST polling is sufficient for current update frequencies)
- Plugin sandbox runtime (Phase B/C)
- Multi-user access control
- Federation to external sources at query time
