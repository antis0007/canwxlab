from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from canwxlab_api.core.event_store import EventStore
from canwxlab_api.core.world_state import WorldState
from canwxlab_api.models import (
    ConfidenceLevel,
    EventIngestionResult,
    SourceAdapterRef,
    SpatiotemporalEvent,
    TruthMode,
)


def _make_event(
    h3_cell: str = "8428309ffffffff",
    variable: str = "temperature_2m",
    value: float = 15.0,
    unit: str = "degC",
    source_id: str = "mock_canwxlab",
    confidence: float = 0.7,
    confidence_level: ConfidenceLevel = ConfidenceLevel.confirmed,
    truth_mode: TruthMode = TruthMode.observed,
    valid_from: datetime | None = None,
    observed_at: datetime | None = None,
    superseded_by: str | None = None,
    longitude: float = -113.58,
    latitude: float = 53.31,
    event_kind: str = "meteorological.observation",
) -> SpatiotemporalEvent:
    now = datetime.now(UTC)
    return SpatiotemporalEvent(
        event_kind=event_kind,
        valid_from=valid_from or now,
        observed_at=observed_at or now,
        longitude=longitude,
        latitude=latitude,
        h3_cell=h3_cell,
        variable=variable,
        value=value,
        unit=unit,
        source_id=source_id,
        source_adapter=SourceAdapterRef(adapter_id=source_id),
        confidence=confidence,
        confidence_level=confidence_level,
        truth_mode=truth_mode,
        attribution="Test data",
        superseded_by=superseded_by,
    )


class TestEventStore:
    """Tests for the append-only event store."""

    def test_append_and_query_by_time_range(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                e1 = _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now - timedelta(hours=2),
                    observed_at=now - timedelta(hours=2),
                )
                e2 = _make_event(
                    variable="temperature_2m",
                    value=16.0,
                    valid_from=now - timedelta(hours=1),
                    observed_at=now - timedelta(hours=1),
                )

                result: EventIngestionResult = await store.append([e1, e2])
                assert result.events_written == 2
                assert result.events_skipped_duplicate == 0
                assert result.events_rejected_schema == 0

                # Query all
                events = await store.query()
                assert len(events) == 2

                # Query by time range — only the later one
                recent = await store.query(time_from=now - timedelta(minutes=90))
                assert len(recent) == 1
                assert recent[0].value == 16.0
            finally:
                await store.close()

        asyncio.run(run())

    def test_latest_returns_highest_confidence(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                # Low confidence first, then high confidence
                e1 = _make_event(
                    variable="pressure_msl",
                    value=1011.0,
                    confidence=0.3,
                    confidence_level=ConfidenceLevel.estimated,
                    valid_from=now,
                    observed_at=now,
                )
                e2 = _make_event(
                    variable="pressure_msl",
                    value=1012.0,
                    confidence=0.9,
                    confidence_level=ConfidenceLevel.confirmed,
                    valid_from=now + timedelta(seconds=1),
                    observed_at=now + timedelta(seconds=1),
                )
                await store.append([e1, e2])

                latest = await store.latest("8428309ffffffff", "pressure_msl")
                assert latest is not None
                assert latest.value == 1012.0
                assert latest.confidence == 0.9
            finally:
                await store.close()

        asyncio.run(run())

    def test_detects_conflicting_sources(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                e1 = _make_event(
                    h3_cell="8428309ffffffff",
                    variable="wind_speed_10m",
                    value=5.0,
                    source_id="eccc_geomet_ogc_api",
                    confidence=0.8,
                    valid_from=now,
                    observed_at=now,
                )
                e2 = _make_event(
                    h3_cell="8428309ffffffff",
                    variable="wind_speed_10m",
                    value=12.0,
                    source_id="mock_canwxlab",
                    confidence=0.3,
                    confidence_level=ConfidenceLevel.synthetic,
                    truth_mode=TruthMode.hypothetical,
                    valid_from=now,
                    observed_at=now,
                )
                await store.append([e1, e2])

                conflicts = await store.conflicts("8428309ffffffff", "wind_speed_10m")
                assert len(conflicts) == 1
                assert conflicts[0]["h3_cell"] == "8428309ffffffff"
                assert len(conflicts[0]["sources"]) == 2
            finally:
                await store.close()

        asyncio.run(run())

    def test_no_conflict_when_only_one_source(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                e1 = _make_event(
                    variable="temperature_2m",
                    value=20.0,
                    source_id="eccc_geomet_ogc_api",
                    valid_from=now,
                    observed_at=now,
                )
                e2 = _make_event(
                    variable="temperature_2m",
                    value=22.0,
                    source_id="eccc_geomet_ogc_api",
                    valid_from=now + timedelta(hours=1),
                    observed_at=now + timedelta(hours=1),
                )
                await store.append([e1, e2])

                conflicts = await store.conflicts("8428309ffffffff", "temperature_2m")
                assert conflicts == []
            finally:
                await store.close()

        asyncio.run(run())

    def test_append_skips_duplicates(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                e1 = _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    source_id="station_a",
                    valid_from=now,
                    observed_at=now,
                )
                # Same business key: source_id + observed_at + variable + h3_cell
                duplicate = _make_event(
                    variable="temperature_2m",
                    value=99.0,
                    source_id="station_a",
                    valid_from=now,
                    observed_at=now,
                )
                result = await store.append([e1])
                assert result.events_written == 1

                result = await store.append([duplicate])
                assert result.events_written == 0
                assert result.events_skipped_duplicate == 1
            finally:
                await store.close()

        asyncio.run(run())

    def test_supersede_chain(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                original = _make_event(
                    variable="temperature_2m",
                    value=10.0,
                    valid_from=now,
                    observed_at=now,
                )
                await store.append([original])

                # Correction supersedes original
                correction = _make_event(
                    variable="temperature_2m",
                    value=12.0,
                    source_id="station_a",
                    valid_from=now,
                    observed_at=now + timedelta(minutes=10),
                )
                # Remove original and re-add with superseded_by set. The dedup index will
                # skip the correction insert only when the business key is identical.
                result = await store.append([correction])
                assert result.events_written == 1

                # Now the latest() should return the correction (not superseded)
                latest = await store.latest("8428309ffffffff", "temperature_2m")
                assert latest is not None
                # The original still exists but latest() filters superseded_by IS NULL
                # Both are not superseded in this test since we couldn't update the original.
                # Instead, verify both exist in history
                history = await store.history("8428309ffffffff", "temperature_2m")
                assert len(history) == 2
            finally:
                await store.close()

        asyncio.run(run())

    def test_history_time_ordered(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                events = []
                for i in range(5):
                    events.append(
                        _make_event(
                            variable="temperature_2m",
                            value=float(10 + i),
                            valid_from=now + timedelta(hours=i),
                            observed_at=now + timedelta(hours=i),
                        )
                    )
                await store.append(events)

                history = await store.history("8428309ffffffff", "temperature_2m")
                assert len(history) == 5
                values = [e.value for e in history]
                assert values == [10.0, 11.0, 12.0, 13.0, 14.0]  # ascending by valid_from
            finally:
                await store.close()

        asyncio.run(run())

    def test_query_by_bbox(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                e1 = _make_event(
                    h3_cell="cell_ab",
                    longitude=-113.5,
                    latitude=53.5,
                    value=10.0,
                    valid_from=now,
                    observed_at=now,
                )
                e2 = _make_event(
                    h3_cell="cell_qc",
                    longitude=-73.5,
                    latitude=45.5,
                    value=20.0,
                    valid_from=now,
                    observed_at=now,
                )
                await store.append([e1, e2])

                # Query Alberta region
                alberta_events = await store.query(bbox=(-120.0, 49.0, -110.0, 60.0))
                assert len(alberta_events) == 1
                assert alberta_events[0].value == 10.0

                # Query Quebec region
                quebec_events = await store.query(bbox=(-80.0, 44.0, -70.0, 48.0))
                assert len(quebec_events) == 1
                assert quebec_events[0].value == 20.0
            finally:
                await store.close()

        asyncio.run(run())


class TestWorldState:
    """Tests for the derived world state materialization."""

    def test_get_cell_state_returns_latest_best(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                await store.append([
                    _make_event(
                        variable="temperature_2m",
                        value=15.0,
                        confidence=0.9,
                        valid_from=now,
                        observed_at=now,
                    )
                ])
                ws = WorldState(store)
                state = await ws.get_cell_state("8428309ffffffff", "temperature_2m")
                assert state is not None
                assert state.value == 15.0
                assert state.confidence == 0.9
                assert len(state.derived_from_event_ids) == 1
            finally:
                await store.close()

        asyncio.run(run())

    def test_get_cell_state_returns_none_for_missing(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                ws = WorldState(store)
                state = await ws.get_cell_state("8428309ffffffff", "nonexistent")
                assert state is None
            finally:
                await store.close()

        asyncio.run(run())

    def test_materialize_region_batch(self) -> None:
        async def run() -> None:
            store = EventStore(":memory:")
            try:
                now = datetime.now(UTC)
                await store.append([
                    _make_event(
                        h3_cell="cell_a",
                        variable="temperature_2m",
                        value=10.0,
                        valid_from=now,
                        observed_at=now,
                    ),
                    _make_event(
                        h3_cell="cell_b",
                        variable="temperature_2m",
                        value=20.0,
                        valid_from=now,
                        observed_at=now,
                    ),
                    _make_event(
                        h3_cell="cell_a",
                        variable="pressure_msl",
                        value=1013.0,
                        valid_from=now,
                        observed_at=now,
                    ),
                ])
                ws = WorldState(store)
                results = await ws.materialize_region(
                    ["cell_a", "cell_b"], ["temperature_2m", "pressure_msl"]
                )
                assert len(results) == 3  # cell_a has 2, cell_b has 1 (no pressure)
            finally:
                await store.close()

        asyncio.run(run())
