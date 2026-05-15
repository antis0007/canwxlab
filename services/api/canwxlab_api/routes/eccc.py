from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import WmsCapabilitiesSummaryResponse, WmsCapabilityLayerSummary

router = APIRouter(prefix="/api/eccc", tags=["eccc"])


@router.get("/collections")
async def list_eccc_collections(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> dict[str, Any]:
    return await adapter.list_collections()


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
