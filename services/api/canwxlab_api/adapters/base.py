from abc import ABC, abstractmethod

from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    Observation,
    SpatiotemporalEvent,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
)

BBox = tuple[float, float, float, float]


class WeatherSourceAdapter(ABC):
    """Contract for public weather data adapters.

    Implementations must preserve source attribution, timestamps, units, and provenance.
    Network access should be explicit so the app can run in offline/mock mode.

    PHASE-A-TODO: Add emit_events() as the canonical ingestion pathway.
    All adapters should emit SpatiotemporalEvent instances that flow into the
    append-only event log.  The existing fetch_* methods become convenience
    wrappers that call emit_events() internally, then produce the legacy
    Observation / WeatherLayer models as materialized views for backward compat.
    """

    # ── Phase A: Event emission contract ──────────────────────────────────
    # PHASE-A-TODO: Implement emit_events() on EcccGeoMetSourceAdapter,
    # MockSourceAdapter, and CompositeWeatherSourceAdapter.
    # Each adapter converts its native data into SpatiotemporalEvent records.
    # The event store (event_store.py) appends them and returns an
    # EventIngestionResult.  This runs in the same request cycle for now;
    # a later optimization can move it to an async worker.

    async def emit_events(
        self, bbox: BBox | None = None, limit: int = 500
    ) -> list[SpatiotemporalEvent]:
        """Emit canonical events for the current fetch window.

        Default returns empty — adapters opt in as they gain event support.
        PHASE-A-TODO: Override in EcccGeoMetSourceAdapter to normalize
        OGC API observations / WMS frames into SpatiotemporalEvent.
        """
        _ = bbox, limit
        return []

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
