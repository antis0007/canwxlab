from fastapi import APIRouter, Depends, Query

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import Observation
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(prefix="/api/observations", tags=["observations"])


@router.get("/stations", response_model=list[Observation])
async def station_observations(
    bbox: str | None = Query(default=None, description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(default=100, ge=1, le=1000),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[Observation]:
    parsed_bbox = parse_bbox_param(bbox)
    return await adapter.fetch_station_observations(bbox=parsed_bbox, limit=limit)


@router.get("/hourly", response_model=list[Observation])
async def hourly_observations(
    bbox: str | None = Query(default=None, description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(default=100, ge=1, le=1000),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[Observation]:
    parsed_bbox = parse_bbox_param(bbox)
    return await adapter.fetch_recent_hourly_observations(bbox=parsed_bbox, limit=limit)
