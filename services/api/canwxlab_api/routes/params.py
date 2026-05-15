from __future__ import annotations

from fastapi import HTTPException

BBox = tuple[float, float, float, float]


def parse_bbox_param(bbox: str | None) -> BBox | None:
    if bbox is None:
        return None

    parts = [part.strip() for part in bbox.split(",")]
    if len(parts) != 4:
        raise HTTPException(
            status_code=400,
            detail="bbox must be minLon,minLat,maxLon,maxLat",
        )

    try:
        values = tuple(float(part) for part in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail="bbox must contain numeric values",
        ) from exc

    west, south, east, north = values
    if west >= east or south >= north:
        raise HTTPException(
            status_code=400,
            detail="bbox must satisfy minLon < maxLon and minLat < maxLat",
        )

    return values
