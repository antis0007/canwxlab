from functools import lru_cache

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.composite import CompositeWeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import EcccGeoMetSourceAdapter
from canwxlab_api.adapters.mock import MockWeatherSourceAdapter
from canwxlab_api.config import get_settings


@lru_cache
def _build_source_adapter() -> WeatherSourceAdapter:
    settings = get_settings()
    mock_adapter = MockWeatherSourceAdapter()
    live_adapter = EcccGeoMetSourceAdapter(
        ogc_api_base=settings.eccc_ogc_api_base,
        wms_base=settings.eccc_wms_base,
        live_enabled=settings.enable_live_eccc,
        timeout_seconds=settings.http_timeout_seconds,
        cache_ttl_seconds=settings.cache_ttl_seconds,
        cache_dir=settings.cache_dir,
    )
    return CompositeWeatherSourceAdapter(
        data_mode=settings.data_mode,
        live_enabled=settings.enable_live_eccc,
        mock_adapter=mock_adapter,
        live_adapter=live_adapter,
    )


def get_source_adapter() -> WeatherSourceAdapter:
    return _build_source_adapter()
