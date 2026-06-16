"""Neural frame-interpolation endpoints.

Synthesizes intermediate frames between two satellite keyframes so the client
can play clouds back as seamless video instead of morphing across 5–10 min
gaps in a shader.

  GET /api/v1/interp/manifest  → JSON list of frames (keyframes + synthesized
                                 intermediates) with per-frame URLs. Triggers
                                 (cached) synthesis of the whole pair.
  GET /api/v1/interp/frame     → PNG bytes of one cached frame.

Synthesis runs off the event loop and is cached on disk per
(layer, bbox, size, t0, t1, depth); a pair is synthesized exactly once. When
no neural backend is installed the manifest returns ``available: false`` and
the client falls back to the existing shader morph (honest degradation).
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.config import get_settings
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.frame_interp import (
    DEFAULT_DEPTH,
    MAX_DEPTH,
    InterpUnavailable,
    frac_to_time_ms,
    load_interpolator,
    midpoint_fractions,
    pair_cache_key,
    png_to_rgb,
    rgb_to_png,
    synthesize_sequence,
)
from canwxlab_api.routes.eccc import get_wms_image

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/interp", tags=["interp"])

# Per-key synthesis locks: collapse a burst of clients onto one synthesis.
_locks: dict[str, asyncio.Lock] = {}


def _cache_dir(cache_dir: str, key: str) -> Path:
    return Path(cache_dir) / "interp" / key


def _frame_file(dir_: Path, frac: float) -> Path:
    # Stable filename per fraction (avoid float repr drift).
    return dir_ / f"f{round(frac * 1_000_000):07d}.png"


async def _fetch_rgb(layer: str, bbox: str, size: int, time: str, adapter: WeatherSourceAdapter):
    response = await get_wms_image(
        layer_name=layer, bbox=bbox, width=size, height=size, crs="EPSG:3857",
        time=time, style=None, format="image/png", transparent=False, adapter=adapter,
    )
    if response.status_code != 200:
        raise HTTPException(
            status_code=424,
            detail={"reason": "source_frame_unavailable", "time": time, "layer": layer},
        )
    return png_to_rgb(bytes(response.body))


async def _ensure_synthesized(
    layer: str, bbox: str, size: int, t0: str, t1: str, depth: int,
    cache_dir: str, adapter: WeatherSourceAdapter,
) -> Path:
    """Synthesize (once) and cache all intermediate frames for the pair.

    Returns the cache directory. Raises InterpUnavailable if no model backend.
    """
    key = pair_cache_key(layer, bbox, size, t0, t1, depth)
    out_dir = _cache_dir(cache_dir, key)
    fractions = midpoint_fractions(depth)

    # Fast path: fully cached already.
    if all(_frame_file(out_dir, f).exists() for f in fractions):
        return out_dir

    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if all(_frame_file(out_dir, f).exists() for f in fractions):
            return out_dir

        interp = load_interpolator()  # raises InterpUnavailable if absent
        frame_a, frame_b = await asyncio.gather(
            _fetch_rgb(layer, bbox, size, t0, adapter),
            _fetch_rgb(layer, bbox, size, t1, adapter),
        )
        # Model synthesis is GPU/CPU heavy — keep it off the event loop.
        sequence = await asyncio.to_thread(synthesize_sequence, frame_a, frame_b, depth, interp)

        out_dir.mkdir(parents=True, exist_ok=True)
        for frac, frame in sequence.items():
            _frame_file(out_dir, frac).write_bytes(rgb_to_png(frame))
        logger.info(
            "interp synthesized", extra={"layer": layer, "t0": t0, "t1": t1, "depth": depth,
                                         "frames": len(sequence)},
        )
    return out_dir


@router.get("/manifest")
async def interp_manifest(
    layer: str = Query(...),
    bbox: str = Query(..., description="EPSG:3857 minx,miny,maxx,maxy"),
    t0: str = Query(..., description="Earlier keyframe time, ISO-8601 UTC"),
    t1: str = Query(..., description="Later keyframe time, ISO-8601 UTC"),
    size: int = Query(512, ge=64, le=1024),
    depth: int = Query(DEFAULT_DEPTH, ge=1, le=MAX_DEPTH),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    settings = get_settings()
    try:
        t0_ms = _iso_to_ms(t0)
        t1_ms = _iso_to_ms(t1)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    key = pair_cache_key(layer, bbox, size, t0, t1, depth)
    base = f"/api/v1/interp/frame?layer={layer}&bbox={bbox}&size={size}&t0={t0}&t1={t1}&depth={depth}"

    try:
        await _ensure_synthesized(layer, bbox, size, t0, t1, depth, settings.cache_dir, adapter)
    except InterpUnavailable as exc:
        # Honest degradation: client falls back to the shader morph.
        return {"available": False, "reason": str(exc), "layer": layer, "key": key}

    frames: list[dict[str, Any]] = [
        {"frac": frac, "tMs": frac_to_time_ms(t0_ms, t1_ms, frac), "url": f"{base}&frac={frac}"}
        for frac in midpoint_fractions(depth)
    ]
    return {
        "available": True, "layer": layer, "key": key, "depth": depth, "size": size,
        "t0": t0, "t1": t1, "t0Ms": t0_ms, "t1Ms": t1_ms, "frames": frames,
    }


@router.get("/frame")
async def interp_frame(
    layer: str = Query(...),
    bbox: str = Query(...),
    t0: str = Query(...),
    t1: str = Query(...),
    frac: float = Query(..., ge=0.0, le=1.0),
    size: int = Query(512, ge=64, le=1024),
    depth: int = Query(DEFAULT_DEPTH, ge=1, le=MAX_DEPTH),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> Response:
    settings = get_settings()
    try:
        out_dir = await _ensure_synthesized(layer, bbox, size, t0, t1, depth, settings.cache_dir, adapter)
    except InterpUnavailable as exc:
        raise HTTPException(status_code=503, detail={"reason": "interp_unavailable", "message": str(exc)}) from exc

    path = _frame_file(out_dir, frac)
    if not path.exists():
        raise HTTPException(status_code=404, detail={"reason": "frame_not_in_sequence", "frac": frac})
    return Response(
        content=path.read_bytes(),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=604800, immutable"},
    )


def _iso_to_ms(iso: str) -> int:
    from datetime import datetime

    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)
