# Phase A Implementation Prompt

Copy everything below this line into a fresh agent.

---

## Task

Implement Phase A "Foundation Hardening" for the canwxlab weather visualization platform. Add event sourcing, a bitemporal event log, and an evidence API that makes every rendered value traceable to its source.

## Context

canwxlab is a geospatial weather platform. It has:
- A FastAPI backend (`services/api/canwxlab_api/`) that ingests weather data from ECCC GeoMet
- A React frontend (`apps/web/src/`) with a CesiumJS/MapLibre globe, deck.gl layers, time slider, inspector panels
- A composite adapter pattern: `MockSourceAdapter` + `EcccGeoMetSourceAdapter` → `CompositeWeatherSourceAdapter`

The backend models are in `services/api/canwxlab_api/models.py`. The adapter contract is in `services/api/canwxlab_api/adapters/base.py`. Routes are in `services/api/canwxlab_api/routes/`.

## What to Build

### 1. Event Store (`services/api/canwxlab_api/core/event_store.py`)

Create `core/` directory with `__init__.py` and `event_store.py`.

```python
class EventStore:
    def __init__(self, db_path: str):
        """Open or create SQLite database at db_path. Create events table on first run."""

    async def append(self, events: list[SpatiotemporalEvent]) -> EventIngestionResult:
        """Append events. Skip duplicates (same source_id + observed_at + variable + h3_cell).
        Return counts of written, skipped, rejected."""

    async def query(self, *, bbox=None, time_from=None, time_to=None,
                    variables=None, limit=500) -> list[SpatiotemporalEvent]:
        """Query events by spatial/temporal/variable filters."""

    async def latest(self, h3_cell: str, variable: str) -> SpatiotemporalEvent | None:
        """Return the most recent (by observed_at), highest-confidence event for a cell+variable."""

    async def history(self, h3_cell: str, variable: str, time_from=None, time_to=None) -> list[SpatiotemporalEvent]:
        """Time-ordered event history for a cell+variable."""

    async def conflicts(self, h3_cell: str, variable: str) -> list[dict]:
        """Return events where multiple sources disagree on the same (cell, variable).
        Group by valid_from window, flag groups with >1 distinct source_id and value difference > threshold."""
```

Use SQLite with `aiosqlite`. Table schema:

```sql
CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    event_kind TEXT NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    observed_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
    superseded_by TEXT,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    elevation_m REAL,
    h3_cell TEXT NOT NULL,
    variable TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    source_id TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    confidence_level TEXT NOT NULL DEFAULT 'estimated',
    truth_mode TEXT NOT NULL DEFAULT 'observed',
    attribution TEXT NOT NULL DEFAULT '',
    license_url TEXT,
    adapter_id TEXT,
    adapter_version TEXT,
    raw_pointer TEXT,
    ingest_duration_ms REAL,
    raw_properties TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_events_cell_var_time
    ON events(h3_cell, variable, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_events_source_observed
    ON events(source_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_events_valid_from
    ON events(valid_from);
CREATE INDEX IF NOT EXISTS idx_events_bbox
    ON events(longitude, latitude);
```

### 2. World State (`services/api/canwxlab_api/core/world_state.py`)

```python
class WorldState:
    def __init__(self, event_store: EventStore):
        """Holds reference to the event store."""

    async def get_cell_state(self, h3_cell: str, variable: str) -> DerivedCellState | None:
        """Return current best estimate for a cell+variable by calling event_store.latest().
        If multiple un-superseded events exist from different sources, populate conflicting_event_ids."""

    async def materialize_region(self, h3_cells: list[str], variables: list[str]) -> list[DerivedCellState]:
        """Batch materialize multiple cells+variables. Used for tile generation later."""
```

`DerivedCellState` model is already defined in `models.py`. Use it directly.

### 3. Evidence Routes (`services/api/canwxlab_api/routes/evidence.py`)

Create a FastAPI router with these endpoints:

| Method | Path | Returns |
|--------|------|---------|
| GET | `/api/evidence/{object_id}/provenance` | `EvidenceChain` |
| GET | `/api/evidence/{object_id}/history` | `list[SpatiotemporalEvent]` |
| GET | `/api/evidence/{object_id}/conflicts` | `list[DerivedCellState]` |
| GET | `/api/evidence/cells` | `DerivedCellState` |
| POST | `/api/events/ingest` | `EventIngestionResult` |
| GET | `/api/events` | `list[SpatiotemporalEvent]` |

`object_id` format: `{h3_cell}/{variable}` (e.g., `8428309ffffffff/temperature_2m`)

For `/api/events` and `/api/evidence/cells`, accept query params: `bbox`, `from`, `to`, `variable`, `h3`, `limit`.

The evidence router should depend on `EventStore` via FastAPI dependency injection. Add the dependency to `dependencies.py`:

```python
from canwxlab_api.core.event_store import EventStore

_event_store: EventStore | None = None

def get_event_store() -> EventStore:
    global _event_store
    if _event_store is None:
        settings = get_settings()
        db_path = Path(settings.cache_dir) / "event_store.db"
        _event_store = EventStore(str(db_path))
    return _event_store
```

### 4. Wire into main.py

In `main.py`, add:
```python
from canwxlab_api.routes import evidence
app.include_router(evidence.router)
```

### 5. Emit events from MockSourceAdapter

In `adapters/mock.py`, implement `emit_events()`. Each time mock observations are generated, also emit them as `SpatiotemporalEvent` records with:
- `event_kind = "meteorological.observation"`
- `valid_from = observed_at` (for observations, valid time = observed time)
- `h3_cell` computed from lat/lon at resolution 5
- `confidence` based on whether data is mock (0.3) or real (varies)
- `truth_mode = "observed"` for station data, `"synthetic"` for mock

Use the `h3` Python library for cell computation. Add it to `pyproject.toml` if not present.

### 6. Emit events from EcccGeoMetSourceAdapter

In `adapters/eccc_geomet.py`, implement `emit_events()`. Convert OGC API observations into `SpatiotemporalEvent` records. The adapter already has the data — just transform it into the event schema.

### 7. Write tests

Create `services/api/tests/test_event_store.py`:
- Test append and query by time range
- Test latest() returns highest-confidence event
- Test conflict detection when two events claim same cell+variable
- Test schema validation rejects invalid events
- Test supersede chain (event B supersedes event A)

Create `services/api/tests/test_evidence_routes.py`:
- Test GET provenance returns correct chain
- Test POST ingest returns correct counts

## Things already done (do NOT redo)

- Models (`SpatiotemporalEvent`, `DerivedCellState`, `EvidenceChain`, `EventIngestionResult`, `ConfidenceLevel`, `TruthMode`, `SourceAdapterRef`) are already defined in `models.py`
- `emit_events()` contract is already on the `WeatherSourceAdapter` base class (returns empty list by default)
- Frontend types are already in `apps/web/src/types/weather.ts`
- Frontend API client methods are already in `apps/web/src/lib/api.ts`
- TODO annotations are already in `main.py`, `composite.py`, `InspectorPanel.tsx`, `RightInspector.tsx`

## Files to create

- `services/api/canwxlab_api/core/__init__.py`
- `services/api/canwxlab_api/core/event_store.py`
- `services/api/canwxlab_api/core/world_state.py`
- `services/api/canwxlab_api/routes/evidence.py`
- `services/api/tests/test_event_store.py`
- `services/api/tests/test_evidence_routes.py`

## Files to modify

- `services/api/canwxlab_api/dependencies.py` — add `get_event_store()`
- `services/api/canwxlab_api/main.py` — mount evidence router
- `services/api/canwxlab_api/adapters/mock.py` — implement `emit_events()`
- `services/api/canwxlab_api/adapters/eccc_geomet.py` — implement `emit_events()`
- `services/api/canwxlab_api/adapters/composite.py` — wire `emit_events()` through to active adapter
- `services/api/pyproject.toml` — add `h3` and `aiosqlite` dependencies

## Design doc

Read the full design: `docs/superpowers/specs/2026-05-17-phase-a-foundation-hardening-design.md`

## Before claiming done

1. `python -m pytest services/api/tests/ -x` passes
2. Existing tests still pass (no regressions)
3. You can POST events to `/api/events/ingest` and GET them back from `/api/events`
4. Evidence endpoints return data from the event store
5. Mock adapter emits valid events
