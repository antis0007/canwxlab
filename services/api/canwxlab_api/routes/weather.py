"""Weather point and hourly forecast routes.

GET /api/weather/point?lat=&lon=      → current conditions (Open-Meteo NWP)
GET /api/weather/hourly?lat=&lon=&hours=  → hourly forecast slots
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Query

from canwxlab_api.dependencies import get_open_meteo_adapter

router = APIRouter(prefix="/api/weather", tags=["weather"])


@router.get("/point")
async def weather_point(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
) -> dict[str, Any]:
    adapter = get_open_meteo_adapter()
    data = await adapter.fetch_current(lat, lon)
    if data is None:
        return {
            "latitude": lat,
            "longitude": lon,
            "source": "unavailable",
            "retrieved_at": datetime.now(UTC).isoformat(),
        }
    return {"latitude": lat, "longitude": lon, **data}


@router.get("/hourly")
async def weather_hourly(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
    hours: int = Query(default=48, ge=1, le=384, description="Forecast horizon in hours"),
) -> dict[str, Any]:
    adapter = get_open_meteo_adapter()
    slots = await adapter.fetch_hourly(lat, lon, hours)
    return {
        "latitude": lat,
        "longitude": lon,
        "timezone": "UTC",
        "slots": slots,
        "retrieved_at": datetime.now(UTC).isoformat(),
    }
