"""Honest planning contracts for future cosmic/orbital data sources.

These endpoints intentionally return unavailable or seed-labelled payloads. They
exist so the frontend and docs can target stable contracts without mistaking
planned JPL/CelesTrak integrations for live orbital data.
"""

from __future__ import annotations

from datetime import UTC, datetime
from hashlib import sha256
from typing import Any

from fastapi import APIRouter, Query

from canwxlab_api.adapters.cosmic_horizons import COSMIC_CACHE_ROOT, ensure_cosmic_cache_dirs

router = APIRouter(prefix="/api/cosmic", tags=["cosmic"])


def _planned_sources() -> list[dict[str, Any]]:
    return [
        {
            "source_id": "jpl_horizons",
            "name": "JPL Horizons",
            "adapter": "cosmic_horizons",
            "status": "unavailable",
            "data_class": "planned",
            "source_status": "unavailable",
            "description": "Planned ephemeris source. No live requests are made yet.",
        },
        {
            "source_id": "jpl_sbdb",
            "name": "JPL Small-Body Database",
            "adapter": "cosmic_sbdb",
            "status": "unavailable",
            "data_class": "planned",
            "source_status": "unavailable",
            "description": "Planned small-body catalogue source.",
        },
        {
            "source_id": "celestrak",
            "name": "CelesTrak",
            "adapter": "cosmic_celestrak",
            "status": "unavailable",
            "data_class": "planned",
            "source_status": "unavailable",
            "description": "Planned satellite TLE/OMM source.",
        },
    ]


@router.get("/status")
async def cosmic_status() -> dict[str, Any]:
    return {
        "status": "unavailable",
        "data_class": "planned",
        "message": "Cosmic/orbital integrations are planned, not live.",
        "sources": _planned_sources(),
    }


@router.get("/sources")
async def cosmic_sources() -> dict[str, Any]:
    return {
        "status": "unavailable",
        "data_class": "planned",
        "sources": _planned_sources(),
    }


@router.get("/objects/seed")
async def cosmic_seed_objects() -> dict[str, Any]:
    return {
        "data_class": "seed",
        "source_status": "mock",
        "message": "Static seed objects for UI framing only; not live ephemerides.",
        "star_catalog": [
            {
                "object_id": "hip:71683",
                "name": "Alpha Centauri",
                "data_class": "seed",
                "source_status": "mock",
            }
        ],
        "orbital_bodies": [
            {
                "object_id": "sun",
                "name": "Sun",
                "data_class": "seed",
                "source_status": "mock",
            },
            {
                "object_id": "earth",
                "name": "Earth",
                "data_class": "seed",
                "source_status": "mock",
            },
        ],
    }


@router.get("/ephemeris")
async def cosmic_ephemeris(
    target: str | None = Query(default=None),
    body: str | None = Query(default=None),
    center: str = Query(default="earth"),
    start: datetime | None = Query(default=None),
    end: datetime | None = Query(default=None),
    step_seconds: int = Query(default=3600, ge=60, le=86400),
) -> dict[str, Any]:
    requested_object = target or body or "unspecified"
    ensure_cosmic_cache_dirs()

    cache_key = sha256(
        "|".join(
            [
                requested_object,
                center,
                start.isoformat() if start else "",
                end.isoformat() if end else "",
                str(step_seconds),
            ]
        ).encode("utf-8")
    ).hexdigest()
    planned_cache_path = COSMIC_CACHE_ROOT / "horizons" / f"{cache_key}.json"

    return {
        "object_id": requested_object,
        "source_id": "jpl_horizons",
        "status": "unavailable",
        "data_class": "unavailable",
        "samples": [],
        "center": center,
        "start": start.isoformat() if start else None,
        "end": end.isoformat() if end else None,
        "step_seconds": step_seconds,
        "generated_at": datetime.now(UTC).isoformat(),
        "message": "JPL Horizons adapter is planned; no live or mock ephemeris is returned.",
        "provenance": {
            "adapter": "cosmic_horizons",
            "source_id": "jpl_horizons",
            "center": center,
            "cache_root": str(COSMIC_CACHE_ROOT),
            "cache_path_planned": str(planned_cache_path),
            "source_status": "unavailable",
            "data_class": "planned",
        },
    }
