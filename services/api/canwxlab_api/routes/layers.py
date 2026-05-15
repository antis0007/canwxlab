from fastapi import APIRouter, Depends, HTTPException

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import WeatherLayer

router = APIRouter(prefix="/api/layers", tags=["layers"])


@router.get("", response_model=list[WeatherLayer])
async def list_layers(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[WeatherLayer]:
    return await adapter.list_layers()


@router.get("/{layer_id}/metadata", response_model=WeatherLayer)
async def get_layer_metadata(
    layer_id: str, adapter: WeatherSourceAdapter = Depends(get_source_adapter)
) -> WeatherLayer:
    layer = await adapter.get_layer_metadata(layer_id)
    if layer is None:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {layer_id}")
    return layer
