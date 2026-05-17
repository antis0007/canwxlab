from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from canwxlab_api.adapters.base import BBox, WeatherSourceAdapter
from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    Observation,
    SourceStatus,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
)

logger = logging.getLogger(__name__)


class CompositeWeatherSourceAdapter(WeatherSourceAdapter):
    """Mode-aware adapter orchestration for mock/live/hybrid data behavior.

    PHASE-A-TODO: Override emit_events() to fan out to the active adapter
    (live or mock based on data_mode) and pass results through the event store
    before returning.  This is the single chokepoint where every ingested
    observation enters the event log — the composite is the natural place
    to enforce schema validation, dedup, and provenance tagging.
    """

    # PHASE-A-TODO: accept an EventStore dependency in __init__ so emit_events
    # can append to the log directly:
    #   def __init__(self, ..., event_store: EventStore | None = None):

    def __init__(
        self,
        data_mode: str,
        live_enabled: bool,
        mock_adapter: WeatherSourceAdapter,
        live_adapter: WeatherSourceAdapter,
    ) -> None:
        self.data_mode = data_mode
        self.live_enabled = live_enabled
        self.mock_adapter = mock_adapter
        self.live_adapter = live_adapter
        self._alerts_fallback_active = False
        self._stations_fallback_active = False
        self._hourly_fallback_active = False
        self._last_fallback_message: str | None = None
        self._last_fallback_at: datetime | None = None

    async def list_sources(self) -> list[DataSource]:
        mock_sources = await self.mock_adapter.list_sources()
        live_sources = await self.live_adapter.list_sources()

        if self._last_fallback_message:
            fallback_source = next(
                (item for item in mock_sources if item.source_id == "mock_canwxlab"),
                None,
            )
            if fallback_source is not None:
                fallback_source = fallback_source.model_copy(
                    update={
                        "status": SourceStatus.fallback,
                        "message": self._last_fallback_message,
                        "last_attempted_fetch": self._last_fallback_at,
                        "last_updated": self._last_fallback_at,
                    }
                )
                mock_sources = [
                    fallback_source if item.source_id == "mock_canwxlab" else item
                    for item in mock_sources
                ]

        if self.data_mode == "mock":
            return [*mock_sources, *live_sources]
        return [*live_sources, *mock_sources]

    async def list_layers(self) -> list[WeatherLayer]:
        mock_layers = await self.mock_adapter.list_layers()
        live_layers = await self.live_adapter.list_layers()

        if self._alerts_fallback_active:
            mock_layers = [
                layer.model_copy(
                    update={
                        "status": SourceStatus.fallback,
                        "message": "Live alerts unavailable; showing mock fallback.",
                    }
                )
                if layer.layer_id == "mock_alerts"
                else layer
                for layer in mock_layers
            ]
        if self._stations_fallback_active:
            mock_layers = [
                layer.model_copy(
                    update={
                        "status": SourceStatus.fallback,
                        "message": "Live station source unavailable; showing mock fallback.",
                    }
                )
                if layer.layer_id == "mock_stations"
                else layer
                for layer in mock_layers
            ]

        return [*mock_layers, *live_layers]

    async def get_layer_metadata(self, layer_id: str) -> WeatherLayer | None:
        for layer in await self.list_layers():
            if layer.layer_id == layer_id:
                return layer
        return None

    async def fetch_recent_hourly_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        if self.data_mode == "mock":
            return await self.mock_adapter.fetch_recent_hourly_observations(
                bbox=bbox,
                limit=limit,
            )

        async def live_fetch() -> list[Observation]:
            return await self.live_adapter.fetch_recent_hourly_observations(
                bbox=bbox,
                limit=limit,
            )

        async def mock_fetch() -> list[Observation]:
            return await self.mock_adapter.fetch_recent_hourly_observations(
                bbox=bbox,
                limit=limit,
            )

        observations = await self._with_optional_fallback(
            fallback_flag="hourly",
            primary=live_fetch,
            fallback=mock_fetch,
        )
        return [
            observation.model_copy(
                update={
                    "source_status": SourceStatus.fallback,
                    "quality_flags": [*observation.quality_flags, "fallback"],
                }
            )
            if self._hourly_fallback_active
            else observation
            for observation in observations
        ]

    async def fetch_station_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        if self.data_mode == "mock":
            return await self.mock_adapter.fetch_station_observations(
                bbox=bbox,
                limit=limit,
            )

        async def live_fetch() -> list[Observation]:
            return await self.live_adapter.fetch_station_observations(
                bbox=bbox,
                limit=limit,
            )

        async def mock_fetch() -> list[Observation]:
            return await self.mock_adapter.fetch_station_observations(
                bbox=bbox,
                limit=limit,
            )

        observations = await self._with_optional_fallback(
            fallback_flag="stations",
            primary=live_fetch,
            fallback=mock_fetch,
        )
        return [
            observation.model_copy(
                update={
                    "source_status": SourceStatus.fallback,
                    "quality_flags": [*observation.quality_flags, "fallback"],
                }
            )
            if self._stations_fallback_active
            else observation
            for observation in observations
        ]

    async def fetch_alerts(self, bbox: BBox | None = None, limit: int = 100) -> list[AlertFeature]:
        if self.data_mode == "mock":
            return await self.mock_adapter.fetch_alerts(bbox=bbox, limit=limit)

        async def live_fetch() -> list[AlertFeature]:
            return await self.live_adapter.fetch_alerts(bbox=bbox, limit=limit)

        async def mock_fetch() -> list[AlertFeature]:
            return await self.mock_adapter.fetch_alerts(bbox=bbox, limit=limit)

        alerts = await self._with_optional_fallback(
            fallback_flag="alerts",
            primary=live_fetch,
            fallback=mock_fetch,
        )
        return [
            alert.model_copy(update={"source_status": SourceStatus.fallback})
            if self._alerts_fallback_active
            else alert
            for alert in alerts
        ]

    async def list_collections(self) -> dict:
        if self.data_mode == "mock":
            return {
                "status": SourceStatus.mock,
                "message": "Mock mode active: live ECCC collections disabled.",
                "collections": [],
            }

        try:
            return await self.live_adapter.list_collections()
        except Exception as exc:  # noqa: BLE001
            if self.data_mode == "hybrid":
                return {
                    "status": SourceStatus.fallback,
                    "message": f"Live collections unavailable in hybrid mode: {exc}",
                    "collections": [],
                }
            return {
                "status": SourceStatus.unavailable,
                "message": f"Live collections unavailable: {exc}",
                "collections": [],
            }

    async def get_collection(self, collection_id: str) -> dict:
        if self.data_mode == "mock":
            return {
                "status": SourceStatus.mock,
                "message": "Mock mode active: live ECCC collection lookup disabled.",
                "collection": None,
            }

        try:
            return await self.live_adapter.get_collection(collection_id)
        except Exception as exc:  # noqa: BLE001
            if self.data_mode == "hybrid":
                return {
                    "status": SourceStatus.fallback,
                    "message": f"Live collection unavailable in hybrid mode: {exc}",
                    "collection": None,
                }
            return {
                "status": SourceStatus.unavailable,
                "message": f"Live collection unavailable: {exc}",
                "collection": None,
            }

    async def get_source_status(self) -> DataSource:
        if self.data_mode == "mock":
            sources = await self.mock_adapter.list_sources()
            return sources[0]
        return await self.live_adapter.get_source_status()

    async def get_wms_layer_catalog(self) -> list[WeatherLayer]:
        return await self.live_adapter.get_wms_layer_catalog()

    async def get_wms_capabilities_summary(self) -> WmsCapabilitiesSummaryResponse:
        if self.data_mode == "mock":
            summary = await self.live_adapter.get_wms_capabilities_summary()
            summary.source = summary.source.model_copy(
                update={
                    "status": SourceStatus.mock,
                    "message": "Mock mode active: live WMS capabilities lookup disabled.",
                    "is_live": False,
                }
            )
            return summary
        return await self.live_adapter.get_wms_capabilities_summary()

    async def fetch_layer_features(
        self,
        layer_id: str,
        bbox: BBox | None = None,
        limit: int = 500,
    ) -> dict:
        if self.data_mode == "mock":
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "status": SourceStatus.mock,
                "features": [],
                "message": "Mock mode active: live OGC feature lookup disabled.",
            }

        if self.data_mode == "hybrid" and not self.live_enabled:
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "status": SourceStatus.fallback,
                "features": [],
                "message": "Live ECCC data disabled; no generic mock feature fallback exists.",
            }

        try:
            return await self.live_adapter.fetch_layer_features(
                layer_id=layer_id,
                bbox=bbox,
                limit=limit,
            )
        except Exception as exc:  # noqa: BLE001
            status = (
                SourceStatus.fallback
                if self.data_mode == "hybrid"
                else SourceStatus.unavailable
            )
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "status": status,
                "features": [],
                "message": f"Live OGC feature request failed ({type(exc).__name__}): {exc}",
            }

    async def _with_optional_fallback(
        self,
        fallback_flag: str,
        primary: Callable[[], Awaitable[list[Any]]],
        fallback: Callable[[], Awaitable[list[Any]]],
    ) -> list[Any]:
        if self.data_mode == "live":
            try:
                result = await primary()
                self._set_fallback_flag(fallback_flag, False)
                return result
            except Exception as exc:  # noqa: BLE001
                logger.warning("Live request failed without fallback: %s", exc)
                self._set_fallback_flag(fallback_flag, False)
                self._last_fallback_message = (
                    f"Live request failed ({type(exc).__name__}); no mock fallback in live mode."
                )
                self._last_fallback_at = datetime.now(UTC)
                return []

        if self.data_mode == "hybrid" and not self.live_enabled:
            message = "Live ECCC data disabled; using mock fallback in hybrid mode."
            self._mark_fallback(fallback_flag, message)
            return await fallback()

        try:
            result = await primary()
            self._set_fallback_flag(fallback_flag, False)
            return result
        except Exception as exc:  # noqa: BLE001
            if self.data_mode != "hybrid":
                self._set_fallback_flag(fallback_flag, False)
                raise
            message = f"Live ECCC request failed ({type(exc).__name__}): using mock fallback."
            logger.warning(message)
            self._mark_fallback(fallback_flag, message)
            return await fallback()

    def _set_fallback_flag(self, fallback_flag: str, value: bool) -> None:
        if fallback_flag == "alerts":
            self._alerts_fallback_active = value
        elif fallback_flag == "stations":
            self._stations_fallback_active = value
        elif fallback_flag == "hourly":
            self._hourly_fallback_active = value

    def _mark_fallback(self, fallback_flag: str, message: str) -> None:
        self._set_fallback_flag(fallback_flag, True)
        self._last_fallback_message = message
        self._last_fallback_at = datetime.now(UTC)
