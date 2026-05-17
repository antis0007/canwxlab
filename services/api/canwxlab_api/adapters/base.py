from abc import ABC, abstractmethod

from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    Observation,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
)

BBox = tuple[float, float, float, float]


class WeatherSourceAdapter(ABC):
    """Contract for public weather data adapters.

    Implementations must preserve source attribution, timestamps, units, and provenance.
    Network access should be explicit so the app can run in offline/mock mode.
    """

    @abstractmethod
    async def list_sources(self) -> list[DataSource]:
        raise NotImplementedError

    @abstractmethod
    async def list_layers(self) -> list[WeatherLayer]:
        raise NotImplementedError

    @abstractmethod
    async def get_layer_metadata(self, layer_id: str) -> WeatherLayer | None:
        raise NotImplementedError

    @abstractmethod
    async def fetch_recent_hourly_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_station_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        raise NotImplementedError

    @abstractmethod
    async def fetch_alerts(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[AlertFeature]:
        raise NotImplementedError

    async def list_collections(self) -> dict:
        return {"collections": []}

    async def get_collection(self, collection_id: str) -> dict:
        _ = collection_id
        return {}

    async def get_source_status(self) -> DataSource:
        sources = await self.list_sources()
        return sources[0]

    async def get_wms_layer_catalog(self) -> list[WeatherLayer]:
        return []

    async def get_wms_capabilities_summary(self) -> WmsCapabilitiesSummaryResponse:
        source = await self.get_source_status()
        return WmsCapabilitiesSummaryResponse(source=source, layers=[])

    async def fetch_layer_features(
        self,
        layer_id: str,
        bbox: BBox | None = None,
        limit: int = 500,
    ) -> dict:
        _ = layer_id, bbox, limit
        return {"type": "FeatureCollection", "features": [], "status": "unavailable"}
