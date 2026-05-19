from __future__ import annotations

from datetime import UTC, datetime

from canwxlab_api.core.event_store import EventStore
from canwxlab_api.models import DerivedCellState


class WorldState:
    """Materialized current-best estimate derived from the event log.

    Each (h3_cell, variable) pair maps to at most one DerivedCellState
    representing the latest, highest-confidence event for that cell.
    """

    def __init__(self, event_store: EventStore) -> None:
        self._store = event_store

    async def get_cell_state(self, h3_cell: str, variable: str) -> DerivedCellState | None:
        latest = await self._store.latest(h3_cell, variable)
        if latest is None:
            return None

        conflict_records = await self._store.conflicts(h3_cell, variable)
        conflicting_ids: list = []
        if conflict_records:
            history_rows = await self._store.history(h3_cell, variable)
            seen_sources: set[str] = set()
            for event in history_rows:
                if event.source_id != latest.source_id and event.source_id not in seen_sources:
                    if event.superseded_by is None:
                        conflicting_ids.append(event.event_id)
                        seen_sources.add(event.source_id)

        return DerivedCellState(
            h3_cell=h3_cell,
            variable=variable,
            value=latest.value,
            unit=latest.unit,
            source_id=latest.source_id,
            confidence=latest.confidence,
            confidence_level=latest.confidence_level,
            truth_mode=latest.truth_mode,
            derived_at=datetime.now(UTC),
            derived_from_event_ids=[latest.event_id],
            conflicting_event_ids=conflicting_ids,
        )

    async def materialize_region(
        self, h3_cells: list[str], variables: list[str]
    ) -> list[DerivedCellState]:
        """Batch materialize multiple cells+variables in a single query pass.

        Instead of N*M individual latest() calls, this builds a cross-product
        and fetches all latest events in one batch query, then enriches with
        conflict info.
        """
        pairs = [(cell, var) for cell in h3_cells for var in variables]
        if not pairs:
            return []

        latest_by_key = await self._store.latest_batch(pairs)
        now = datetime.now(UTC)
        results: list[DerivedCellState] = []

        for (cell, var), event in latest_by_key.items():
            conflict_records = await self._store.conflicts(cell, var)
            conflicting_ids: list = []
            if conflict_records:
                history_rows = await self._store.history(cell, var)
                seen_sources: set[str] = set()
                for h in history_rows:
                    if h.source_id != event.source_id and h.source_id not in seen_sources:
                        if h.superseded_by is None:
                            conflicting_ids.append(h.event_id)
                            seen_sources.add(h.source_id)

            results.append(
                DerivedCellState(
                    h3_cell=cell,
                    variable=var,
                    value=event.value,
                    unit=event.unit,
                    source_id=event.source_id,
                    confidence=event.confidence,
                    confidence_level=event.confidence_level,
                    truth_mode=event.truth_mode,
                    derived_at=now,
                    derived_from_event_ids=[event.event_id],
                    conflicting_event_ids=conflicting_ids,
                )
            )

        return results
