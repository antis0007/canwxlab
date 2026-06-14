"""Orbital element (TLE) endpoints.

Serves CelesTrak TLE sets to the browser, which propagates them with SGP4
(satellite.js). Server owns sourcing + caching; the browser owns the math.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from canwxlab_api.adapters.cosmic_celestrak import ALLOWED_GROUPS, CelestrakTleAdapter
from canwxlab_api.config import get_settings

router = APIRouter(prefix="/api/v1/orbits", tags=["orbits"])

# Module-level adapter — shares disk + in-process cache across requests.
_adapter = CelestrakTleAdapter(cache_root=Path(get_settings().cache_dir))


@router.get("/groups")
async def orbit_groups() -> dict[str, Any]:
    """List the allow-listed TLE groups and their descriptions."""
    return {"groups": [{"id": g, "description": d} for g, d in ALLOWED_GROUPS.items()]}


@router.get("/tle")
async def orbit_tle(
    group: str = Query(
        default="stations",
        description="Allow-listed CelesTrak group (see /api/v1/orbits/groups).",
    ),
) -> dict[str, Any]:
    """Return a TLE set for ``group``: raw element lines + parsed header.

    The frontend propagates these with SGP4. Cached daily server-side per
    CelesTrak's polling guidance; stale data is served (status: degraded) if a
    refresh fails rather than returning nothing.
    """
    return await _adapter.fetch_group(group)
