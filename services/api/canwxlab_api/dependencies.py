from functools import lru_cache
from pathlib import Path

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.composite import CompositeWeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import EcccGeoMetSourceAdapter
from canwxlab_api.adapters.gibs_wmts import GibsWmtsSourceAdapter
from canwxlab_api.adapters.mock import MockWeatherSourceAdapter
from canwxlab_api.config import get_settings
from canwxlab_api.core.event_store import EventStore


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
        user_agent=settings.http_user_agent,
    )
    gibs_adapter = GibsWmtsSourceAdapter()
    return CompositeWeatherSourceAdapter(
        data_mode=settings.data_mode,
        live_enabled=settings.enable_live_eccc,
        mock_adapter=mock_adapter,
        live_adapter=live_adapter,
        gibs_adapter=gibs_adapter,
    )


def get_source_adapter() -> WeatherSourceAdapter:
    return _build_source_adapter()


_event_store: EventStore | None = None


def get_event_store() -> EventStore:
    global _event_store
    if _event_store is None:
        settings = get_settings()
        db_path = Path(settings.cache_dir) / "event_store.db"
        _event_store = EventStore(str(db_path))
    return _event_store
