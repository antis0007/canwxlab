"""Aircraft / ADS-B position endpoints.

Live aircraft positions from the OpenSky Network REST API.
Positions are cached for 60 s to respect the anonymous rate limit.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from canwxlab_api.adapters.opensky_adsb import OpenSkyAdsbAdapter
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(prefix="/api/v1/aircraft", tags=["aircraft"])

# Module-level adapter instance — reuses the in-process TTL cache across
# requests so a burst of simultaneous clients shares one OpenSky fetch.
_adapter = OpenSkyAdsbAdapter()


@router.get("/positions")
async def aircraft_positions(
    bbox: str | None = Query(
        default=None,
        description="Spatial filter: minLon,minLat,maxLon,maxLat (EPSG:4326). "
        "Omit for global coverage (large response).",
    ),
) -> dict[str, Any]:
    """Return a GeoJSON FeatureCollection of current ADS-B aircraft positions.

    Each feature has a Point geometry and properties including:
    - ``icao24``: ICAO 24-bit hex address
    - ``callsign``: flight callsign (may be blank)
    - ``origin_country``
    - ``baro_altitude_m`` / ``geo_altitude_m``
    - ``velocity_ms`` / ``velocity_kmh``
    - ``heading_deg``: true track (degrees clockwise from north)
    - ``vertical_rate_ms``: positive = climbing
    - ``on_ground``: bool
    - ``position_source``: ADS-B | ASTERIX | MLAT | FLARM
    - ``observed_at``: ISO-8601 UTC timestamp of last position fix
    """
    parsed_bbox = parse_bbox_param(bbox)
    return await _adapter.fetch_positions(bbox=parsed_bbox)
