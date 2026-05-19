import asyncio
import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import (
    build_ogc_collections_diagnostics,
    build_wms_curated_diagnostics,
    load_verified_eccc_ogc_collections,
)
from canwxlab_api.config import get_settings
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import WmsCapabilitiesSummaryResponse, WmsCapabilityLayerSummary
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(prefix="/api/eccc", tags=["eccc"])

_WMS_IMAGE_LOCKS: dict[str, asyncio.Lock] = {}


def _adapter_wms_base(adapter: WeatherSourceAdapter) -> str:
    direct = getattr(adapter, "wms_base", None)
    if isinstance(direct, str) and direct:
        return direct
    live_adapter = getattr(adapter, "live_adapter", None)
    nested = getattr(live_adapter, "wms_base", None)
    if isinstance(nested, str) and nested:
        return nested
    raise HTTPException(status_code=400, detail="Adapter does not support WMS")


def _build_wms_params(
    layer_name: str,
    bbox: str,
    width: int,
    height: int,
    crs: str,
    time: str | None,
    style: str | None,
    format: str,
    transparent: bool,
) -> dict[str, str]:
    params = {
        "service": "WMS",
        "version": "1.3.0",
        "request": "GetMap",
        "layers": layer_name,
        "crs": crs,
        "bbox": bbox,
        "width": str(width),
        "height": str(height),
        "format": format,
        "transparent": "TRUE" if transparent else "FALSE",
    }
    if style is not None:
        params["styles"] = style
    if time:
        params["time"] = time
    return params


def _wms_image_cache_key(base_url: str, params: dict[str, str]) -> str:
    serialized = json.dumps(
        {"url": base_url, "params": params},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _wms_image_cache_paths(cache_dir: str, cache_key: str) -> tuple[Path, Path]:
    root = Path(cache_dir) / "eccc_geomet_wms_images"
    return root / f"{cache_key}.bin", root / f"{cache_key}.json"


def _read_wms_image_cache(
    cache_dir: str,
    cache_key: str,
) -> tuple[bytes, str, datetime, datetime] | None:
    data_path, meta_path = _wms_image_cache_paths(cache_dir, cache_key)
    if not data_path.exists() or not meta_path.exists():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return (
            data_path.read_bytes(),
            str(meta["content_type"]),
            datetime.fromisoformat(meta["retrieved_at"]),
            datetime.fromisoformat(meta["expires_at"]),
        )
    except Exception:  # noqa: BLE001
        return None


def _write_wms_image_cache(
    cache_dir: str,
    cache_key: str,
    content: bytes,
    content_type: str,
    retrieved_at: datetime,
    expires_at: datetime,
) -> None:
    data_path, meta_path = _wms_image_cache_paths(cache_dir, cache_key)
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_bytes(content)
    meta_path.write_text(
        json.dumps(
            {
                "content_type": content_type,
                "retrieved_at": retrieved_at.isoformat(),
                "expires_at": expires_at.isoformat(),
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )


def _wms_image_ttl_seconds(time: str | None) -> int:
    settings = get_settings()
    if time:
        return max(60, settings.eccc_wms_timed_image_cache_ttl_seconds)
    return max(60, settings.eccc_wms_image_cache_ttl_seconds)


def _cached_wms_response(
    content: bytes,
    content_type: str,
    expires_at: datetime,
    cache_status: str,
) -> Response:
    now = datetime.now(UTC)
    max_age = max(60 if cache_status == "stale" else 0, int((expires_at - now).total_seconds()))
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "cache-control": f"public, max-age={min(max_age, 86400)}",
            "x-canwxlab-cache": cache_status,
        },
    )


def _upstream_headers(accept: str) -> dict[str, str]:
    settings = get_settings()
    return {
        "User-Agent": settings.http_user_agent,
        "Accept": accept,
    }


@router.get("/collections")
async def list_eccc_collections(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    return await adapter.list_collections()


@router.get("/ogc/curated")
async def list_curated_ogc_collections() -> dict[str, Any]:
    """Return the curated MSC GeoMet OGC API collection catalog (config only).

    For runtime availability vs live /collections, see /ogc/diagnostics.
    """
    return {"collections": load_verified_eccc_ogc_collections()}


@router.get("/ogc/diagnostics")
async def get_ogc_diagnostics(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    """Curated OGC collection diagnostics vs live MSC GeoMet /collections."""
    try:
        payload = await adapter.list_collections()
    except Exception as exc:  # noqa: BLE001
        return {
            "available_collection_count": 0,
            "probe_error": str(exc),
            "curated": build_ogc_collections_diagnostics(set()),
        }
    raw = payload.get("collections") or []
    ids: set[str] = set()
    for c in raw:
        cid = c.get("id") if isinstance(c, dict) else None
        if isinstance(cid, str):
            ids.add(cid.lower())
    return {
        "available_collection_count": len(ids),
        "probe_status": payload.get("status"),
        "curated": build_ogc_collections_diagnostics(ids),
    }


@router.get("/ogc/layers/{layer_id}/features")
async def get_ogc_layer_features(
    layer_id: str,
    bbox: str | None = Query(default=None, description="minLon,minLat,maxLon,maxLat"),
    limit: int = Query(default=500, ge=1, le=1000),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    parsed_bbox = parse_bbox_param(bbox)
    return await adapter.fetch_layer_features(layer_id=layer_id, bbox=parsed_bbox, limit=limit)


@router.get("/collections/{collection_id}")
async def get_eccc_collection(
    collection_id: str,
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    return await adapter.get_collection(collection_id)


@router.get("/wms/capabilities-summary", response_model=WmsCapabilitiesSummaryResponse)
async def get_wms_capabilities_summary(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> WmsCapabilitiesSummaryResponse:
    return await adapter.get_wms_capabilities_summary()


@router.get("/wms/layers")
async def list_wms_layers(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[WmsCapabilityLayerSummary]:
    summary = await adapter.get_wms_capabilities_summary()
    return summary.layers


@router.get("/wms/layers/{layer_name}")
async def get_wms_layer(
    layer_name: str,
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> WmsCapabilityLayerSummary:
    summary = await adapter.get_wms_capabilities_summary()
    for layer in summary.layers:
        if layer.layer_name.lower() == layer_name.lower():
            return layer
    raise HTTPException(status_code=404, detail="WMS layer not found in capabilities")


@router.get("/wms/layers/{layer_name}/times")
async def get_wms_layer_times(
    layer_name: str,
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    summary = await adapter.get_wms_capabilities_summary()
    for layer in summary.layers:
        if layer.layer_name.lower() == layer_name.lower():
            if not layer.has_time_dimension or not layer.time_extent:
                return {"layer_name": layer.layer_name, "times": []}
            times = [t.strip() for t in layer.time_extent.split(",") if t.strip()]
            return {"layer_name": layer.layer_name, "times": times}
    raise HTTPException(status_code=404, detail="WMS layer not found in capabilities")


@router.get("/wms/build-url")
async def build_wms_url(
    layer_name: str = Query(...),
    bbox: str = Query(...),
    width: int = Query(256),
    height: int = Query(256),
    crs: str = Query("EPSG:4326"),
    time: str | None = Query(None),
    style: str | None = Query(None),
    format: str = Query("image/png"),
    transparent: bool = Query(True),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, str]:
    base_url = _adapter_wms_base(adapter)
    params = _build_wms_params(
        layer_name, bbox, width, height, crs, time, style, format, transparent
    )
    return {"url": f"{base_url}?{urlencode(params)}"}


@router.get("/wms/image")
async def get_wms_image(
    layer_name: str = Query(...),
    bbox: str = Query(...),
    width: int = Query(512, ge=1, le=2048),
    height: int = Query(512, ge=1, le=2048),
    crs: str = Query("EPSG:3857"),
    time: str | None = Query(None),
    style: str | None = Query(None),
    format: str = Query("image/png"),
    transparent: bool = Query(True),
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> Response:
    base_url = _adapter_wms_base(adapter)
    params = _build_wms_params(
        layer_name, bbox, width, height, crs, time, style, format, transparent
    )
    settings = get_settings()
    cache_key = _wms_image_cache_key(base_url, params)
    cached = _read_wms_image_cache(settings.cache_dir, cache_key)
    now = datetime.now(UTC)
    if cached is not None:
        content, content_type, _retrieved_at, expires_at = cached
        if expires_at > now:
            return _cached_wms_response(content, content_type, expires_at, "hit")

    lock = _WMS_IMAGE_LOCKS.setdefault(cache_key, asyncio.Lock())
    async with lock:
        cached = _read_wms_image_cache(settings.cache_dir, cache_key)
        now = datetime.now(UTC)
        if cached is not None:
            content, content_type, _retrieved_at, expires_at = cached
            if expires_at > now:
                return _cached_wms_response(content, content_type, expires_at, "hit")

        try:
            async with httpx.AsyncClient(
                timeout=settings.http_timeout_seconds,
                headers=_upstream_headers(format),
            ) as client:
                upstream = await client.get(base_url, params=params)
                upstream.raise_for_status()
        except httpx.HTTPError as exc:
            if cached is not None:
                content, content_type, _retrieved_at, expires_at = cached
                return _cached_wms_response(content, content_type, expires_at, "stale")
            raise HTTPException(status_code=502, detail=f"WMS image fetch failed: {exc}") from exc

        content_type = upstream.headers.get("content-type", format)
        if not content_type.lower().startswith("image/"):
            detail = upstream.text[:300] if upstream.text else "WMS returned a non-image response"
            raise HTTPException(status_code=502, detail=detail)

        retrieved_at = datetime.now(UTC)
        expires_at = retrieved_at + timedelta(seconds=_wms_image_ttl_seconds(time))
        _write_wms_image_cache(
            settings.cache_dir,
            cache_key,
            upstream.content,
            content_type,
            retrieved_at,
            expires_at,
        )

        return _cached_wms_response(upstream.content, content_type, expires_at, "miss")


@router.get("/wms/diagnostics")
async def get_wms_diagnostics(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    summary = await adapter.get_wms_capabilities_summary()
    layers = summary.layers
    source = summary.source

    if source.status == "stale":
        cache_status = "stale"
    elif source.status == "live":
        cache_status = "fresh"
    else:
        cache_status = source.status
    n_time = sum(1 for layer in layers if layer.has_time_dimension)
    n_query = sum(1 for layer in layers if layer.queryable)
    curated = build_wms_curated_diagnostics(layers)
    return {
        "wms_base_url": source.homepage_url,
        "last_capabilities_fetch_status": source.status,
        "last_successful_fetch_time": source.last_successful_fetch,
        "cache_status": cache_status,
        "number_of_parsed_layers": len(layers),
        "number_of_layers_with_time_dimension": n_time,
        "number_of_queryable_layers": n_query,
        "parser_warnings": [],
        "last_error": source.message if source.error_type else None,
        "error_type": source.error_type,
        "curated_layers": curated,
    }
