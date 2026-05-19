from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any
from uuid import UUID

import aiosqlite

from canwxlab_api.models import (
    ConfidenceLevel,
    EventIngestionResult,
    SourceAdapterRef,
    SpatiotemporalEvent,
    TruthMode,
)

logger = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]

_SCHEMA_SQL = """
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup
    ON events(source_id, observed_at, variable, h3_cell);

CREATE INDEX IF NOT EXISTS idx_events_cell_var_time
    ON events(h3_cell, variable, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_events_source_observed
    ON events(source_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_events_valid_from
    ON events(valid_from);
CREATE INDEX IF NOT EXISTS idx_events_bbox
    ON events(longitude, latitude);
"""

_INSERT_SQL = """\
INSERT OR IGNORE INTO events (
    event_id, event_kind, valid_from, valid_to, observed_at,
    ingested_at, superseded_by, longitude, latitude, elevation_m,
    h3_cell, variable, value, unit, source_id, confidence,
    confidence_level, truth_mode, attribution, license_url,
    adapter_id, adapter_version, raw_pointer, ingest_duration_ms,
    raw_properties
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?
)"""


def _serialize_datetime(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.isoformat()


def _deserialize_datetime(text: str | None) -> datetime | None:
    if text is None:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _event_to_row(event: SpatiotemporalEvent) -> tuple:
    sa = event.source_adapter
    return (
        str(event.event_id),
        event.event_kind,
        _serialize_datetime(event.valid_from),
        _serialize_datetime(event.valid_to),
        _serialize_datetime(event.observed_at),
        _serialize_datetime(event.ingested_at),
        str(event.superseded_by) if event.superseded_by else None,
        event.longitude,
        event.latitude,
        event.elevation_m,
        event.h3_cell or "",
        event.variable,
        event.value,
        event.unit,
        event.source_id,
        event.confidence,
        event.confidence_level.value,
        event.truth_mode.value,
        event.attribution,
        event.license_url,
        sa.adapter_id if sa else None,
        sa.adapter_version if sa else None,
        sa.raw_pointer if sa else None,
        sa.ingest_duration_ms if sa else None,
        json.dumps(event.raw_properties),
    )


def _row_to_event(row: aiosqlite.Row) -> SpatiotemporalEvent:
    source_adapter = None
    if row["adapter_id"]:
        source_adapter = SourceAdapterRef(
            adapter_id=row["adapter_id"],
            adapter_version=row["adapter_version"] or "0.1.0",
            raw_pointer=row["raw_pointer"],
            ingest_duration_ms=row["ingest_duration_ms"],
        )

    raw_props = {}
    try:
        raw_props = json.loads(row["raw_properties"] or "{}")
    except json.JSONDecodeError:
        pass

    return SpatiotemporalEvent(
        event_id=UUID(row["event_id"]),
        event_kind=row["event_kind"],
        valid_from=_deserialize_datetime(row["valid_from"]),  # type: ignore[arg-type]
        valid_to=_deserialize_datetime(row["valid_to"]),
        observed_at=_deserialize_datetime(row["observed_at"]),  # type: ignore[arg-type]
        ingested_at=_deserialize_datetime(row["ingested_at"]),  # type: ignore[arg-type]
        superseded_by=UUID(row["superseded_by"]) if row["superseded_by"] else None,
        longitude=row["longitude"],
        latitude=row["latitude"],
        elevation_m=row["elevation_m"],
        h3_cell=row["h3_cell"],
        variable=row["variable"],
        value=row["value"],
        unit=row["unit"],
        source_id=row["source_id"],
        source_adapter=source_adapter,
        confidence=row["confidence"],
        confidence_level=ConfidenceLevel(row["confidence_level"]),
        truth_mode=TruthMode(row["truth_mode"]),
        attribution=row["attribution"],
        license_url=row["license_url"],
        raw_properties=raw_props,
    )


class EventStore:
    """Append-only event log backed by SQLite.

    Every observation, forecast frame, alert, and sensor reading enters
    the system as a SpatiotemporalEvent. The log is never mutated —
    corrections are recorded as new events that supersede old ones.
    """

    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        self._conn: aiosqlite.Connection | None = None

    async def _ensure_connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self.db_path)
            self._conn.row_factory = aiosqlite.Row
            await self._conn.executescript(_SCHEMA_SQL)
            await self._conn.commit()
        return self._conn

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    async def append(self, events: list[SpatiotemporalEvent]) -> EventIngestionResult:
        rejected = 0
        valid_rows: list[tuple] = []
        latest_id: UUID | None = None

        for event in events:
            try:
                event.model_validate(event.model_dump())
            except Exception:
                rejected += 1
                continue
            valid_rows.append(_event_to_row(event))
            latest_id = event.event_id

        if not valid_rows:
            return EventIngestionResult(
                events_written=0,
                events_skipped_duplicate=0,
                events_rejected_schema=rejected,
                latest_event_id=None,
            )

        conn = await self._ensure_connection()

        # Count before to determine how many were actually inserted
        cursor = await conn.execute("SELECT COUNT(*) FROM events")
        count_before = (await cursor.fetchone())[0]

        await conn.executemany(_INSERT_SQL, valid_rows)
        await conn.commit()

        cursor = await conn.execute("SELECT COUNT(*) FROM events")
        count_after = (await cursor.fetchone())[0]

        written = count_after - count_before
        skipped = len(valid_rows) - written

        return EventIngestionResult(
            events_written=written,
            events_skipped_duplicate=skipped,
            events_rejected_schema=rejected,
            latest_event_id=latest_id,
        )

    async def query(
        self,
        *,
        bbox: BBox | None = None,
        time_from: datetime | None = None,
        time_to: datetime | None = None,
        variables: list[str] | None = None,
        h3_cells: list[str] | None = None,
        limit: int = 500,
    ) -> list[SpatiotemporalEvent]:
        conn = await self._ensure_connection()
        clauses: list[str] = []
        params: list[Any] = []

        if bbox is not None:
            west, south, east, north = bbox
            clauses.append("longitude >= ? AND longitude <= ? AND latitude >= ? AND latitude <= ?")
            params.extend([west, east, south, north])

        if time_from is not None:
            clauses.append("valid_from >= ?")
            params.append(_serialize_datetime(time_from))

        if time_to is not None:
            clauses.append("valid_from <= ?")
            params.append(_serialize_datetime(time_to))

        if variables:
            placeholders = ",".join("?" for _ in variables)
            clauses.append(f"variable IN ({placeholders})")
            params.extend(variables)

        if h3_cells:
            placeholders = ",".join("?" for _ in h3_cells)
            clauses.append(f"h3_cell IN ({placeholders})")
            params.extend(h3_cells)

        where = " AND ".join(clauses) if clauses else "1=1"
        sql = f"SELECT * FROM events WHERE {where} ORDER BY valid_from DESC LIMIT ?"
        params.append(min(limit, 1000))

        cursor = await conn.execute(sql, params)
        rows = await cursor.fetchall()
        return [_row_to_event(row) for row in rows]

    async def latest(self, h3_cell: str, variable: str) -> SpatiotemporalEvent | None:
        conn = await self._ensure_connection()
        cursor = await conn.execute(
            """SELECT * FROM events
               WHERE h3_cell = ? AND variable = ? AND superseded_by IS NULL
               ORDER BY confidence DESC, valid_from DESC
               LIMIT 1""",
            (h3_cell, variable),
        )
        row = await cursor.fetchone()
        return _row_to_event(row) if row else None

    async def latest_batch(
        self, cells_and_vars: list[tuple[str, str]]
    ) -> dict[tuple[str, str], SpatiotemporalEvent]:
        """Fetch latest event for multiple (h3_cell, variable) pairs in one query."""
        if not cells_and_vars:
            return {}

        conn = await self._ensure_connection()
        # Build a parameterized IN clause for (h3_cell, variable) pairs
        placeholders = ", ".join("(?, ?)" for _ in cells_and_vars)
        flat_params: list[Any] = []
        for cell, var in cells_and_vars:
            flat_params.extend([cell, var])

        cursor = await conn.execute(
            f"""SELECT * FROM events
                WHERE (h3_cell, variable) IN ({placeholders})
                  AND superseded_by IS NULL
                ORDER BY confidence DESC, valid_from DESC""",
            flat_params,
        )
        rows = await cursor.fetchall()

        result: dict[tuple[str, str], SpatiotemporalEvent] = {}
        seen: set[tuple[str, str]] = set()
        for row in rows:
            key = (row["h3_cell"], row["variable"])
            if key not in seen:
                seen.add(key)
                result[key] = _row_to_event(row)
        return result

    async def history(
        self,
        h3_cell: str,
        variable: str,
        time_from: datetime | None = None,
        time_to: datetime | None = None,
    ) -> list[SpatiotemporalEvent]:
        conn = await self._ensure_connection()
        clauses = ["h3_cell = ?", "variable = ?"]
        params: list[Any] = [h3_cell, variable]

        if time_from is not None:
            clauses.append("valid_from >= ?")
            params.append(_serialize_datetime(time_from))
        if time_to is not None:
            clauses.append("valid_from <= ?")
            params.append(_serialize_datetime(time_to))

        where = " AND ".join(clauses)
        cursor = await conn.execute(
            f"SELECT * FROM events WHERE {where} ORDER BY valid_from ASC",
            params,
        )
        rows = await cursor.fetchall()
        return [_row_to_event(row) for row in rows]

    async def conflicts(self, h3_cell: str, variable: str) -> list[dict[str, Any]]:
        conn = await self._ensure_connection()
        cursor = await conn.execute(
            """SELECT source_id, value, confidence, valid_from, valid_to, event_id
               FROM events
               WHERE h3_cell = ? AND variable = ? AND superseded_by IS NULL
               ORDER BY valid_from DESC""",
            (h3_cell, variable),
        )
        rows = await cursor.fetchall()

        if len(rows) < 2:
            return []

        seen_sources: set[str] = set()
        values_by_source: dict[str, float] = {}

        for row in rows:
            sid = row["source_id"]
            if sid not in values_by_source:
                values_by_source[sid] = row["value"]
            seen_sources.add(sid)

        if len(seen_sources) > 1 and len(set(values_by_source.values())) > 1:
            return [{
                "h3_cell": h3_cell,
                "variable": variable,
                "sources": list(seen_sources),
                "values": values_by_source,
                "event_count": len(rows),
            }]

        return []
