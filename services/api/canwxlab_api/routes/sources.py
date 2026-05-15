from fastapi import APIRouter, Depends

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.config import get_settings
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.models import DataSource, SourceStatusResponse

router = APIRouter(prefix="/api/sources", tags=["sources"])


@router.get("", response_model=list[DataSource])
async def list_sources(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> list[DataSource]:
    return await adapter.list_sources()


@router.get("/status", response_model=SourceStatusResponse)
async def source_status(
    adapter: WeatherSourceAdapter = Depends(get_source_adapter),
) -> SourceStatusResponse:
    settings = get_settings()
    return SourceStatusResponse(
        data_mode=settings.data_mode,
        live_eccc_enabled=settings.enable_live_eccc,
        sources=await adapter.list_sources(),
    )
