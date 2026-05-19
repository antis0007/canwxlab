from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from canwxlab_api.core.event_store import EventStore
from canwxlab_api.dependencies import get_event_store
from canwxlab_api.models import (
    DerivedCellState,
    EventIngestionResult,
    EvidenceChain,
    SpatiotemporalEvent,
)
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(tags=["evidence"])


def _parse_object_id(object_id: str) -> tuple[str, str]:
    parts = object_id.split("/", 1)
    if len(parts) != 2:
        raise HTTPException(
            status_code=400,
            detail="object_id must be {h3_cell}/{variable}",
        )
    h3_cell, variable = parts
    if not h3_cell or not variable:
        raise HTTPException(
            status_code=400,
            detail="object_id must be {h3_cell}/{variable}",
        )
    return h3_cell, variable


@router.get("/api/evidence/{object_id:path}/provenance", response_model=EvidenceChain)
async def evidence_provenance(
    object_id: str,
    store: EventStore = Depends(get_event_store),
) -> EvidenceChain:
    h3_cell, variable = _parse_object_id(object_id)
    events = await store.history(h3_cell, variable)
    conflict_records = await store.conflicts(h3_cell, variable)
    conflict_count = conflict_records[0]["event_count"] if conflict_records else 0

    if not events:
        raise HTTPException(status_code=404, detail="No events found for object")

    current = events[-1]
    return EvidenceChain(
        object_id=object_id,
        current_value=current.value,
        unit=current.unit,
        confidence_level=current.confidence_level,
        truth_mode=current.truth_mode,
        events=events,
        conflict_count=conflict_count,
    )


@router.get("/api/evidence/{object_id:path}/history", response_model=list[SpatiotemporalEvent])
async def evidence_history(
    object_id: str,
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    store: EventStore = Depends(get_event_store),
) -> list[SpatiotemporalEvent]:
    h3_cell, variable = _parse_object_id(object_id)
    return await store.history(h3_cell, variable, time_from=from_time, time_to=to_time)


@router.get("/api/evidence/{object_id:path}/conflicts", response_model=list[dict[str, Any]])
async def evidence_conflicts(
    object_id: str,
    store: EventStore = Depends(get_event_store),
) -> list[dict[str, Any]]:
    h3_cell, variable = _parse_object_id(object_id)
    return await store.conflicts(h3_cell, variable)


@router.get("/api/evidence/cells", response_model=DerivedCellState | None)
async def evidence_cell_state(
    h3: str = Query(..., description="H3 cell index"),
    variable: str = Query(..., description="Variable name"),
    store: EventStore = Depends(get_event_store),
) -> DerivedCellState | None:
    from canwxlab_api.core.world_state import WorldState

    ws = WorldState(store)
    state = await ws.get_cell_state(h3, variable)
    if state is None:
        raise HTTPException(status_code=404, detail="No data for cell+variable")
    return state


@router.post("/api/events/ingest", response_model=EventIngestionResult)
async def events_ingest(
    events: list[SpatiotemporalEvent],
    store: EventStore = Depends(get_event_store),
) -> EventIngestionResult:
    if not events:
        raise HTTPException(status_code=400, detail="No events provided")
    return await store.append(events)


@router.get("/api/events", response_model=list[SpatiotemporalEvent])
async def events_query(
    bbox: str | None = Query(default=None, description="minLon,minLat,maxLon,maxLat"),
    from_time: datetime | None = Query(default=None, alias="from"),
    to_time: datetime | None = Query(default=None, alias="to"),
    variable: str | None = Query(default=None),
    h3: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=1000),
    store: EventStore = Depends(get_event_store),
) -> list[SpatiotemporalEvent]:
    parsed_bbox = parse_bbox_param(bbox) if bbox else None
    variables = [variable] if variable else None
    h3_cells = [h3] if h3 else None
    return await store.query(
        bbox=parsed_bbox,
        time_from=from_time,
        time_to=to_time,
        variables=variables,
        h3_cells=h3_cells,
        limit=limit,
    )
