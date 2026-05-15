from fastapi import APIRouter, Depends, Query

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.mock import MockWeatherSourceAdapter
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import AlertFeature
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.get("", response_model=list[AlertFeature])
async def alerts(
    bbox: str | None = Query(default=None, description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(default=100, ge=1, le=1000),
    live: bool | None = Query(default=None),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[AlertFeature]:
    parsed_bbox = parse_bbox_param(bbox)

    if live is False:
        return await MockWeatherSourceAdapter().fetch_alerts(bbox=parsed_bbox, limit=limit)

    if live is True and hasattr(adapter, "live_adapter"):
        return await adapter.live_adapter.fetch_alerts(bbox=parsed_bbox, limit=limit)  # type: ignore[attr-defined]

    return await adapter.fetch_alerts(bbox=parsed_bbox, limit=limit)
