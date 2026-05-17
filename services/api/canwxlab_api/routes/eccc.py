from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import (
    build_ogc_collections_diagnostics,
    build_wms_curated_diagnostics,
    load_verified_eccc_ogc_collections,
)
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import WmsCapabilitiesSummaryResponse, WmsCapabilityLayerSummary
from canwxlab_api.routes.params import parse_bbox_param

router = APIRouter(prefix="/api/eccc", tags=["eccc"])


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
    if not hasattr(adapter, "wms_base"):
        raise HTTPException(status_code=400, detail="Adapter does not support WMS")
    base_url = adapter.wms_base # type: ignore
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
        "transparent": "TRUE" if transparent else "FALSE"
    }
    if style:
        params["styles"] = style
    if time:
        params["time"] = time
        
    return {"url": f"{base_url}?{urlencode(params)}"}


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
