"""Shared motion field endpoint.

GET /api/motion/field returns a dense optical-flow field between two
timestamps of a continuous IR satellite product, packed as raw RGBA bytes in
the client's flow-texture format (rg = flow UV, b = confidence). The client
applies this one field to whatever visual product it is displaying.

Frames come through the existing WMS image proxy, so they share its cache,
upstream throttling, and fallback behaviour; computed fields are cached on
disk keyed by (layer, bbox, size, t0, t1) — a pair is computed exactly once.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from datetime import datetime

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.config import get_settings
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.motion_flow import (
    DEFAULT_GRID,
    compute_flow,
    encode_flow_rgba,
    luma_from_png,
    parse_time_extent,
    snap_to_grid,
)
from canwxlab_api.routes.eccc import get_wms_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/motion", tags=["motion"])

# Continuous (non-categorical) products suitable for motion estimation.
MOTION_SOURCE_LAYERS = {
    "goes-east": "GOES-East_2km_NightIR",
    "goes-west": "GOES-West_2km_NightIR",
}

_CACHE_SUBDIR = "motion_fields"


def _cache_path(cache_dir: str, key: str) -> Path:
    digest = hashlib.sha256(key.encode()).hexdigest()[:32]
    return Path(cache_dir) / _CACHE_SUBDIR / f"{digest}.rgba"


async def _snap_to_source_grid(
    layer: str, t0: str, t1: str, adapter: WeatherSourceAdapter
) -> tuple[str, str]:
    """Snap requested times to the IR layer's published grid. The displayed
    product's frame times (the client sends those) rarely line up with the IR
    motion source's grid; without snapping GeoMet rejects them as 'time
    outside valid hours'. Returns the times unchanged if the extent cannot be
    read so the request still attempts a fetch."""
    try:
        summary = await adapter.get_wms_capabilities_summary()
    except Exception:
        return t0, t1
    extent = next(
        (s.time_extent for s in summary.layers if s.layer_name == layer and s.time_extent),
        None,
    )
    if not extent:
        return t0, t1
    parsed = parse_time_extent(extent)
    if not parsed:
        return t0, t1
    start, end, step = parsed
    try:
        d0 = datetime.fromisoformat(t0.replace("Z", "+00:00"))
        d1 = datetime.fromisoformat(t1.replace("Z", "+00:00"))
    except ValueError:
        return t0, t1
    s0 = snap_to_grid(d0, start, end, step)
    s1 = snap_to_grid(d1, start, end, step)
    # Both clamped to the same grid time (request outside the window): nudge t1
    # one step earlier so the pair stays distinct and inside the window.
    if s1 <= s0:
        s0 = max(start, s1 - step)
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return s0.strftime(fmt), s1.strftime(fmt)


async def _fetch_luma(
    layer: str, bbox: str, size: int, time: str, adapter: WeatherSourceAdapter,
):
    response = await get_wms_image(
        layer_name=layer,
        bbox=bbox,
        width=size,
        height=size,
        crs="EPSG:3857",
        time=time,
        style=None,
        format="image/png",
        transparent=True,
        adapter=adapter,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=424,
            detail={"reason": "source_frame_unavailable", "time": time, "layer": layer},
        )
    return luma_from_png(bytes(response.body), size)


@router.get("/field")
async def get_motion_field(
    satellite: str = Query("goes-east", pattern="^(goes-east|goes-west)$"),
    bbox: str = Query(..., description="EPSG:3857 minx,miny,maxx,maxy"),
    t0: str = Query(..., description="Earlier frame time, ISO-8601 UTC"),
    t1: str = Query(..., description="Later frame time, ISO-8601 UTC"),
    size: int = Query(DEFAULT_GRID, ge=64, le=512),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> Response:
    settings = get_settings()
    layer = MOTION_SOURCE_LAYERS[satellite]
    t0, t1 = await _snap_to_source_grid(layer, t0, t1, adapter)
    cache_key = f"{layer}|{bbox}|{size}|{t0}|{t1}"
    cache_file = _cache_path(settings.cache_dir, cache_key)

    if cache_file.exists():
        body = cache_file.read_bytes()
    else:
        prev = await _fetch_luma(layer, bbox, size, t0, adapter)
        nxt = await _fetch_luma(layer, bbox, size, t1, adapter)
        u, v, conf = compute_flow(prev, nxt)
        body = encode_flow_rgba(u, v, conf)
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_bytes(body)
        logger.info(
            "motion field computed",
            extra={"layer": layer, "t0": t0, "t1": t1, "size": size},
        )

    return Response(
        content=body,
        media_type="application/octet-stream",
        headers={
            "X-Motion-Width": str(size),
            "X-Motion-Height": str(size),
            "Cache-Control": "public, max-age=604800, immutable",
        },
    )
