from __future__ import annotations

import logging
import tomllib
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from canwxlab_api.adapters.base import BBox, WeatherSourceAdapter
from canwxlab_api.http_cache import FetchResult, JsonFileCacheClient
from canwxlab_api.models import (
    AlertFeature,
    ConfidenceLevel,
    DataSource,
    LayerKind,
    LayerServiceType,
    Observation,
    SourceAdapterRef,
    SourceStatus,
    SpatiotemporalEvent,
    TruthMode,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
    WmsCapabilityLayerSummary,
)

try:
    import h3

    def _h3_cell(lat: float, lng: float, resolution: int = 5) -> str:
        return h3.latlng_to_cell(lat, lng, resolution)
except ImportError:
    def _h3_cell(lat: float, lng: float, resolution: int = 5) -> str:
        _ = lat, lng, resolution
        return ""

logger = logging.getLogger(__name__)

ECCC_ATTRIBUTION = "Environment and Climate Change Canada / Meteorological Service of Canada."
ECCC_LICENSE_URL = "https://eccc-msc.github.io/open-data/readme_en/"
ECCC_CATALOG_TTL_SECONDS = 6 * 60 * 60
ECCC_WMS_CAPABILITIES_TTL_SECONDS = 6 * 60 * 60
ECCC_STATION_CATALOG_TTL_SECONDS = 24 * 60 * 60
ECCC_OBSERVATION_TTL_SECONDS = 15 * 60
ECCC_REALTIME_TTL_SECONDS = 5 * 60


class EcccGeoMetSourceAdapter(WeatherSourceAdapter):
    """Live-capable ECCC/MSC GeoMet source adapter with local cache fallback."""

    # GEOMET-TODO: Keep this adapter the Phase 1 priority. Add curated ingestion for radar,
    # satellite/GOES products, model grids, hydrometric, lightning, AQHI, wildfire/smoke,
    # historical climate, and Datamart-only products where OGC API/WMS is insufficient.
    # GEOMET-TODO: Preserve source URL, retrieval time, cache state, layer time dimension,
    # and license/provenance on every normalized product.

    def __init__(
        self,
        ogc_api_base: str,
        wms_base: str,
        live_enabled: bool,
        timeout_seconds: float,
        cache_ttl_seconds: int,
        cache_dir: str,
        user_agent: str | None = None,
    ) -> None:
        self.ogc_api_base = ogc_api_base.rstrip("/")
        self.wms_base = wms_base.rstrip("/")
        self.live_enabled = live_enabled
        self.cache_ttl_seconds = cache_ttl_seconds
        self.cache = JsonFileCacheClient(
            cache_dir=Path(cache_dir) / "eccc_geomet",
            timeout_seconds=timeout_seconds,
            user_agent=user_agent,
        )

    async def emit_events(
        self, bbox: BBox | None = None, limit: int = 500
    ) -> list[SpatiotemporalEvent]:
        if not self.live_enabled:
            return []

        observations = await self.fetch_station_observations(bbox=bbox, limit=limit)
        events: list[SpatiotemporalEvent] = []
        source_ref = SourceAdapterRef(
            adapter_id="eccc_geomet",
            adapter_version="0.1.0",
        )

        for obs in observations:
            h3_cell = _h3_cell(obs.latitude, obs.longitude, 5)
            confidence = 0.7 if obs.source_status == SourceStatus.live else 0.5
            conf_level = (
                ConfidenceLevel.confirmed
                if confidence >= 0.7
                else ConfidenceLevel.estimated
            )

            for var, val in obs.values.items():
                unit = obs.units.get(var, "")
                events.append(
                    SpatiotemporalEvent(
                        event_kind="meteorological.observation",
                        valid_from=obs.observed_at,
                        observed_at=obs.observed_at,
                        longitude=obs.longitude,
                        latitude=obs.latitude,
                        elevation_m=obs.elevation_m,
                        h3_cell=h3_cell,
                        variable=var,
                        value=val,
                        unit=unit,
                        source_id="eccc_geomet_ogc_api",
                        source_adapter=source_ref,
                        confidence=confidence,
                        confidence_level=conf_level,
                        truth_mode=TruthMode.observed,
                        attribution=ECCC_ATTRIBUTION,
                        license_url="https://eccc-msc.github.io/open-data/readme_en/",
                        raw_properties={
                            "station_id": obs.station_id,
                            "station_name": obs.station_name,
                            "quality_flags": obs.quality_flags,
                        },
                    )
                )
        return events

    async def get_source_status(self) -> DataSource:
        return await self._ogc_source_status()

    async def list_sources(self) -> list[DataSource]:
        return [
            await self._ogc_source_status(),
            (await self.get_wms_capabilities_summary()).source,
        ]

    async def list_collections(self) -> dict[str, Any]:
        if not self.live_enabled:
            return {
                "status": SourceStatus.unavailable,
                "message": "Live ECCC data disabled.",
                "collections": [],
            }

        result = await self.cache.fetch_json(
            self._ogc_url("/collections"),
            params={"lang": "en", "f": "json"},
            ttl_seconds=self._catalog_ttl_seconds(),
            allow_stale_on_error=True,
        )
        return {
            "status": SourceStatus.stale if result.stale else SourceStatus.live,
            "retrieved_at": result.retrieved_at,
            "expires_at": result.expires_at,
            "collections": result.payload.get("collections", []),
            "links": result.payload.get("links", []),
            "source_url": result.source_url,
        }

    async def get_collection(self, collection_id: str) -> dict[str, Any]:
        if not self.live_enabled:
            return {
                "status": SourceStatus.unavailable,
                "message": "Live ECCC data disabled.",
                "collection": None,
            }

        result = await self.cache.fetch_json(
            self._ogc_url(f"/collections/{collection_id}"),
            params={"lang": "en", "f": "json"},
            ttl_seconds=self._catalog_ttl_seconds(),
            allow_stale_on_error=True,
        )
        return {
            "status": SourceStatus.stale if result.stale else SourceStatus.live,
            "retrieved_at": result.retrieved_at,
            "expires_at": result.expires_at,
            "collection": result.payload,
            "source_url": result.source_url,
        }

    async def fetch_alerts(self, bbox: BBox | None = None, limit: int = 100) -> list[AlertFeature]:
        return await self.fetch_weather_alerts(bbox=bbox, limit=limit)

    async def fetch_weather_alerts(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[AlertFeature]:
        if not self.live_enabled:
            return []

        result = await self._fetch_collection_items(
            collection_id=_collection_id_for_layer(
                "eccc_weather_alerts",
                fallback="weather-alerts",
            ),
            bbox=bbox,
            limit=limit,
        )
        source_status = SourceStatus.stale if result.stale else SourceStatus.live
        features = result.payload.get("features", [])
        alerts: list[AlertFeature] = []

        for index, feature in enumerate(features):
            try:
                normalized = _normalize_alert_feature(feature, result, source_status, index)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "alert_feature_skipped",
                    extra={
                        "event": "alert_feature_skipped",
                        "error_type": type(exc).__name__,
                        "error_message": str(exc),
                    },
                )
                continue
            if normalized is not None:
                alerts.append(normalized)

        return alerts[: max(1, limit)]

    async def fetch_station_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        if not self.live_enabled:
            return []

        collection_candidates = [
            ("eccc_swob_realtime", "swob-realtime"),
            ("eccc_climate_stations", "climate-stations"),
        ]
        last_error: Exception | None = None
        merged: list[Observation] = []
        seen_keys: set[tuple[str, str]] = set()
        for layer_id, fallback in collection_candidates:
            try:
                result = await self._fetch_collection_items(
                    collection_id=_collection_id_for_layer(layer_id, fallback=fallback),
                    bbox=bbox,
                    limit=limit,
                )
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                continue

            source_status = SourceStatus.stale if result.stale else SourceStatus.live
            features = result.payload.get("features", [])
            observations: list[Observation] = []

            for index, feature in enumerate(features):
                try:
                    normalized = _normalize_station_feature(feature, result, source_status, index)
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "station_feature_skipped",
                        extra={
                            "event": "station_feature_skipped",
                            "error_type": type(exc).__name__,
                            "error_message": str(exc),
                        },
                    )
                    continue
                if normalized is not None:
                    key = (normalized.station_id, normalized.observed_at.isoformat())
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    observations.append(normalized)

            if observations:
                merged.extend(observations)

        if merged:
            return merged[: max(1, limit)]
        if last_error is not None:
            raise last_error
        return []

    async def fetch_recent_hourly_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        if not self.live_enabled:
            return []

        result = await self._fetch_collection_items(
            collection_id=_collection_id_for_layer(
                "eccc_climate_hourly",
                fallback="climate-hourly",
            ),
            bbox=bbox,
            limit=limit,
        )
        source_status = SourceStatus.stale if result.stale else SourceStatus.live
        features = result.payload.get("features", [])
        observations: list[Observation] = []

        for index, feature in enumerate(features):
            try:
                normalized = _normalize_hourly_feature(feature, result, source_status, index)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "hourly_feature_skipped",
                    extra={
                        "event": "hourly_feature_skipped",
                        "error_type": type(exc).__name__,
                        "error_message": str(exc),
                    },
                )
                continue
            if normalized is not None:
                observations.append(normalized)

        return observations[: max(1, limit)]

    async def get_wms_capabilities_summary(self) -> WmsCapabilitiesSummaryResponse:
        source = self._disabled_source(
            source_id="eccc_geomet_wms",
            name="ECCC/MSC GeoMet WMS",
            homepage_url=self.wms_base,
            message="Live ECCC data disabled.",
        )
        if not self.live_enabled:
            return WmsCapabilitiesSummaryResponse(source=source, layers=[])

        params = {
            "SERVICE": "WMS",
            "REQUEST": "GetCapabilities",
            "VERSION": "1.3.0",
        }

        try:
            result = await self.cache.fetch_text(
                self.wms_base,
                params=params,
                ttl_seconds=self._wms_capabilities_ttl_seconds(),
                allow_stale_on_error=True,
            )
            layers = _parse_wms_layers(result.payload)
            status = SourceStatus.stale if result.stale else SourceStatus.live
            source = DataSource(
                source_id="eccc_geomet_wms",
                name="ECCC/MSC GeoMet WMS",
                status=status,
                adapter="eccc_geomet",
                last_updated=result.retrieved_at,
                last_successful_fetch=result.retrieved_at,
                last_attempted_fetch=result.attempted_at,
                retrieved_at=result.retrieved_at,
                expires_at=result.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                homepage_url=self.wms_base,
                description="WMS capabilities endpoint for radar/satellite raster layers.",
                message=(
                    "Cached WMS capabilities used after fetch error."
                    if result.stale
                    else "Live WMS capabilities fetched successfully."
                ),
                error_type=result.error_type,
                is_live=status == SourceStatus.live,
            )
            return WmsCapabilitiesSummaryResponse(source=source, layers=layers)
        except Exception as exc:  # noqa: BLE001
            return WmsCapabilitiesSummaryResponse(
                source=DataSource(
                    source_id="eccc_geomet_wms",
                    name="ECCC/MSC GeoMet WMS",
                    status=SourceStatus.unavailable,
                    adapter="eccc_geomet",
                    attribution=ECCC_ATTRIBUTION,
                    license_url=ECCC_LICENSE_URL,
                    homepage_url=self.wms_base,
                    description="WMS capabilities endpoint for radar/satellite raster layers.",
                    message=f"WMS capabilities unavailable: {exc}",
                    error_type=type(exc).__name__,
                    is_live=False,
                ),
                layers=[],
            )

    async def get_wms_layer_catalog(self) -> list[WeatherLayer]:
        capabilities = await self.get_wms_capabilities_summary()
        by_name = {layer.layer_name.lower(): layer for layer in capabilities.layers}

        curated = load_verified_eccc_wms_layers()

        weather_layers: list[WeatherLayer] = []
        for definition in curated:
            matched = _resolve_curated_layer(by_name, definition.get("candidate_layer_names", []))
            verified = matched is not None
            layer_status = capabilities.source.status if verified else SourceStatus.unavailable
            unit_by_product = {
                "radar": "mm/h",
                "satellite": "reflectance",
                "temperature": "degC",
                "wind": "m/s",
                "precipitation": "mm",
                "cloud": "ratio",
            }
            product = definition.get("intended_product_type", "")
            unit = unit_by_product.get(product, "")
            description = definition.get(
                "notes",
                f"Curated ECCC WMS layer ({product or 'unknown product type'}).",
            )
            keywords_legacy = [product] if product else []
            weather_layers.append(
                WeatherLayer(
                    layer_id=definition["id"],
                    name=definition["title"],
                    title=definition["title"],
                    kind="raster",
                    variable=product or "unknown",
                    unit=unit,
                    source_id="eccc_geomet_wms",
                    status=layer_status,
                    adapter="eccc_geomet",
                    service_type=LayerServiceType.wms,
                    last_updated=capabilities.source.last_updated,
                    last_successful_fetch=capabilities.source.last_successful_fetch,
                    last_attempted_fetch=capabilities.source.last_attempted_fetch,
                    retrieved_at=capabilities.source.retrieved_at,
                    expires_at=capabilities.source.expires_at,
                    attribution=definition.get("attribution") or ECCC_ATTRIBUTION,
                    license_url=ECCC_LICENSE_URL,
                    default_opacity=_curated_default_opacity(product),
                    color_ramps=[],
                    styles=matched.styles if matched and matched.styles else [],
                    wms_base_url=self.wms_base,
                    wms_layer_name=matched.layer_name if matched else None,
                    time_dimension_supported=matched.has_time_dimension if matched else False,
                    update_frequency_hint=None,
                    description=description,
                    message=_curated_match_message(matched, definition),
                    is_live=layer_status == SourceStatus.live,
                    metadata={
                        "curated": True,
                        "verified_runtime": verified,
                        "candidate_layer_names": definition.get("candidate_layer_names", []),
                        "intended_product_type": product,
                        "capabilities_title": matched.title if matched else None,
                        "time_extent": matched.time_extent if matched else None,
                        "styles": matched.styles if matched else [],
                        "legend_url": matched.legend_url if matched else None,
                        "bounding_boxes": matched.bounding_boxes if matched else {},
                        "wms_bounds_lonlat": (
                            _wms_bounds_lonlat(matched.bounding_boxes) if matched else None
                        ),
                        # legacy field for back-compat
                        "keywords": keywords_legacy,
                    },
                )
            )

        return weather_layers

    async def _available_ogc_collection_ids(self) -> set[str]:
        """Return the set of collection ids reported by GeoMet /collections.

        Best-effort: returns the empty set on any error so that callers fall
        through to the `unavailable` path without raising.
        """
        try:
            payload = await self.list_collections()
        except Exception as exc:  # noqa: BLE001
            logger.warning("OGC /collections probe failed: %s", exc)
            return set()
        collections = payload.get("collections") or []
        ids: set[str] = set()
        for c in collections:
            cid = c.get("id") if isinstance(c, dict) else None
            if isinstance(cid, str):
                ids.add(cid.lower())
        return ids

    async def get_curated_ogc_layer_catalog(self) -> list[WeatherLayer]:
        """Build WeatherLayer entries for the curated OGC API collections.

        Each curated entry resolves against live /collections (exact match,
        case-insensitive). Missing entries are surfaced as `unavailable`.
        """
        source = await self._ogc_source_status()
        available = await self._available_ogc_collection_ids()
        curated = load_verified_eccc_ogc_collections()

        kind_map = {
            "polygon": LayerKind.polygon,
            "point": LayerKind.point,
            "vector": LayerKind.vector,
            "raster": LayerKind.raster,
        }

        layers: list[WeatherLayer] = []
        for entry in curated:
            cid = entry.get("collection_id") or ""
            present = bool(cid) and cid.lower() in available
            layer_status = source.status if present else SourceStatus.unavailable
            kind = kind_map.get(entry.get("kind") or "point", LayerKind.point)
            layer = WeatherLayer(
                layer_id=entry.get("id") or f"eccc_ogc_{cid}",
                name=entry.get("title") or cid,
                title=entry.get("title") or cid,
                kind=kind,
                variable=entry.get("variable") or "unknown",
                unit=entry.get("unit") or "",
                source_id="eccc_geomet_ogc_api",
                status=layer_status,
                adapter="eccc_geomet",
                service_type=LayerServiceType.ogc_api,
                last_updated=source.last_updated,
                last_successful_fetch=source.last_successful_fetch,
                last_attempted_fetch=source.last_attempted_fetch,
                retrieved_at=source.retrieved_at,
                expires_at=source.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                default_opacity=0.85,
                color_ramps=[],
                description=entry.get("description") or "MSC GeoMet OGC API collection.",
                message=(
                    f"Resolved against live /collections as {cid}."
                    if present
                    else f"Curated collection_id '{cid}' not present in live /collections."
                ),
                is_live=present and layer_status == SourceStatus.live,
                metadata={
                    "curated": True,
                    "ogc_collection_id": cid,
                    "verified_runtime": present,
                    "category_hint": entry.get("category"),
                },
            )
            layers.append(layer)
        return layers

    async def list_layers(self) -> list[WeatherLayer]:
        source = await self._ogc_source_status()
        wms_layers = await self.get_wms_layer_catalog()
        curated_ogc = await self.get_curated_ogc_layer_catalog()

        ogc_layers = [
            WeatherLayer(
                layer_id="eccc_weather_alerts",
                name="ECCC Weather Alerts",
                title="ECCC Weather Alerts",
                kind="polygon",
                variable="alerts",
                unit="category",
                source_id="eccc_geomet_ogc_api",
                status=source.status,
                adapter="eccc_geomet",
                service_type=LayerServiceType.ogc_api,
                last_updated=source.last_updated,
                last_successful_fetch=source.last_successful_fetch,
                last_attempted_fetch=source.last_attempted_fetch,
                retrieved_at=source.retrieved_at,
                expires_at=source.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                default_opacity=0.62,
                color_ramps=["alert_severity"],
                description="Official ECCC alert polygons via GeoMet OGC API items.",
                message=source.message,
                error_type=source.error_type,
                is_live=source.status == SourceStatus.live,
                metadata={
                    "curated": True,
                    "ogc_collection_id": _collection_id_for_layer(
                        "eccc_weather_alerts",
                        fallback="weather-alerts",
                    ),
                    "category_hint": "alert",
                    "verified_runtime": source.status in {SourceStatus.live, SourceStatus.stale},
                },
            ),
            WeatherLayer(
                layer_id="eccc_climate_stations",
                name="ECCC Climate Stations",
                title="ECCC Climate Stations",
                kind="point",
                variable="surface_observations",
                unit="mixed",
                source_id="eccc_geomet_ogc_api",
                status=source.status,
                adapter="eccc_geomet",
                service_type=LayerServiceType.ogc_api,
                last_updated=source.last_updated,
                last_successful_fetch=source.last_successful_fetch,
                last_attempted_fetch=source.last_attempted_fetch,
                retrieved_at=source.retrieved_at,
                expires_at=source.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                default_opacity=1.0,
                color_ramps=["thermal"],
                description="ECCC climate station point features from GeoMet collections.",
                message=source.message,
                error_type=source.error_type,
                is_live=source.status == SourceStatus.live,
                metadata={
                    "curated": True,
                    "ogc_collection_id": _collection_id_for_layer(
                        "eccc_climate_stations",
                        fallback="climate-stations",
                    ),
                    "category_hint": "observation",
                    "verified_runtime": source.status in {SourceStatus.live, SourceStatus.stale},
                },
            ),
            WeatherLayer(
                layer_id="eccc_climate_hourly",
                name="ECCC Climate Hourly Observations",
                title="ECCC Climate Hourly Observations",
                kind="point",
                variable="hourly_observations",
                unit="mixed",
                source_id="eccc_geomet_ogc_api",
                status=source.status,
                adapter="eccc_geomet",
                service_type=LayerServiceType.ogc_api,
                last_updated=source.last_updated,
                last_successful_fetch=source.last_successful_fetch,
                last_attempted_fetch=source.last_attempted_fetch,
                retrieved_at=source.retrieved_at,
                expires_at=source.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                default_opacity=1.0,
                color_ramps=["thermal"],
                description="Recent hourly climate observations from GeoMet collections.",
                message=source.message,
                error_type=source.error_type,
                is_live=source.status == SourceStatus.live,
                metadata={
                    "curated": True,
                    "ogc_collection_id": _collection_id_for_layer(
                        "eccc_climate_hourly",
                        fallback="climate-hourly",
                    ),
                    "category_hint": "observation",
                    "verified_runtime": source.status in {SourceStatus.live, SourceStatus.stale},
                },
            ),
        ]

        # Append curated OGC collection entries that aren't already represented
        # by the hardcoded `ogc_layers` block. Hardcoded entries win on
        # layer_id collision because they preserve existing test contracts.
        existing_ids = {layer.layer_id for layer in ogc_layers}
        extra_curated = [layer for layer in curated_ogc if layer.layer_id not in existing_ids]

        return [*ogc_layers, *extra_curated, *wms_layers]

    async def get_layer_metadata(self, layer_id: str) -> WeatherLayer | None:
        for layer in await self.list_layers():
            if layer.layer_id == layer_id:
                return layer
        return None

    async def _fetch_collection_items(
        self,
        collection_id: str,
        bbox: BBox | None,
        limit: int,
    ) -> FetchResult:
        params: dict[str, Any] = {
            "lang": "en",
            "f": "json",
            "limit": max(1, min(limit, 1000)),
        }
        if bbox is not None:
            params["bbox"] = ",".join(str(part) for part in bbox)

        return await self.cache.fetch_json(
            self._ogc_url(f"/collections/{collection_id}/items"),
            params=params,
            ttl_seconds=self._collection_items_ttl_seconds(collection_id),
            allow_stale_on_error=True,
        )

    async def fetch_layer_features(
        self,
        layer_id: str,
        bbox: BBox | None = None,
        limit: int = 500,
    ) -> dict[str, Any]:
        collection_id = _collection_id_for_layer(layer_id)
        if collection_id is None:
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "status": SourceStatus.unavailable,
                "features": [],
                "message": f"No curated OGC collection is configured for layer '{layer_id}'.",
            }

        if not self.live_enabled:
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "collection_id": collection_id,
                "status": SourceStatus.unavailable,
                "features": [],
                "message": "Live ECCC data disabled.",
            }

        try:
            result = await self._fetch_collection_items(
                collection_id=collection_id,
                bbox=bbox,
                limit=limit,
            )
        except Exception as exc:  # noqa: BLE001
            return {
                "type": "FeatureCollection",
                "layer_id": layer_id,
                "collection_id": collection_id,
                "status": SourceStatus.unavailable,
                "features": [],
                "message": f"OGC feature collection unavailable: {exc}",
                "error_type": type(exc).__name__,
            }

        status = SourceStatus.stale if result.stale else SourceStatus.live
        features = []
        for feature in result.payload.get("features", []):
            if not isinstance(feature, dict):
                continue
            if not isinstance(feature.get("geometry"), dict):
                continue
            properties = feature.get("properties")
            if not isinstance(properties, dict):
                properties = {}
            display = _derive_display_properties(layer_id, properties)
            features.append(
                {
                    **feature,
                    "properties": {
                        **properties,
                        **display,
                        "_canwxlab_layer_id": layer_id,
                        "_canwxlab_collection_id": collection_id,
                        "_canwxlab_source_status": status,
                        "_canwxlab_source_url": result.source_url,
                    },
                }
            )

        return {
            "type": "FeatureCollection",
            "layer_id": layer_id,
            "collection_id": collection_id,
            "status": status,
            "retrieved_at": result.retrieved_at,
            "expires_at": result.expires_at,
            "source_url": result.source_url,
            "features": features,
            "message": (
                "Cached OGC features used after fetch error."
                if result.stale
                else "Live OGC features fetched successfully."
            ),
        }

    def _disabled_source(
        self,
        source_id: str,
        name: str,
        homepage_url: str,
        message: str,
    ) -> DataSource:
        return DataSource(
            source_id=source_id,
            name=name,
            status=SourceStatus.unavailable,
            adapter="eccc_geomet",
            attribution=ECCC_ATTRIBUTION,
            license_url=ECCC_LICENSE_URL,
            homepage_url=homepage_url,
            description="ECCC/MSC GeoMet public weather geospatial data source.",
            message=message,
            is_live=False,
        )

    async def _ogc_source_status(self) -> DataSource:
        if not self.live_enabled:
            return self._disabled_source(
                source_id="eccc_geomet_ogc_api",
                name="ECCC/MSC GeoMet OGC API",
                homepage_url=self.ogc_api_base,
                message="Live ECCC data disabled.",
            )

        try:
            result = await self.cache.fetch_json(
                self._ogc_url("/collections"),
                params={"lang": "en", "f": "json"},
                ttl_seconds=self._catalog_ttl_seconds(),
                allow_stale_on_error=True,
            )
            status = SourceStatus.stale if result.stale else SourceStatus.live
            return DataSource(
                source_id="eccc_geomet_ogc_api",
                name="ECCC/MSC GeoMet OGC API",
                status=status,
                adapter="eccc_geomet",
                last_updated=result.retrieved_at,
                last_successful_fetch=result.retrieved_at,
                last_attempted_fetch=result.attempted_at,
                retrieved_at=result.retrieved_at,
                expires_at=result.expires_at,
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                homepage_url=self.ogc_api_base,
                description="ECCC/MSC GeoMet OGC API collections and items endpoints.",
                message=(
                    "Cached OGC data used after fetch error."
                    if result.stale
                    else "Live OGC API reachable."
                ),
                error_type=result.error_type,
                is_live=status == SourceStatus.live,
            )
        except Exception as exc:  # noqa: BLE001
            return DataSource(
                source_id="eccc_geomet_ogc_api",
                name="ECCC/MSC GeoMet OGC API",
                status=SourceStatus.unavailable,
                adapter="eccc_geomet",
                attribution=ECCC_ATTRIBUTION,
                license_url=ECCC_LICENSE_URL,
                homepage_url=self.ogc_api_base,
                description="ECCC/MSC GeoMet OGC API collections and items endpoints.",
                message=f"OGC API unavailable: {exc}",
                error_type=type(exc).__name__,
                is_live=False,
            )

    def _ogc_url(self, path: str) -> str:
        return f"{self.ogc_api_base}{path}"

    def _catalog_ttl_seconds(self) -> int:
        return max(self.cache_ttl_seconds, ECCC_CATALOG_TTL_SECONDS)

    def _wms_capabilities_ttl_seconds(self) -> int:
        return max(self.cache_ttl_seconds, ECCC_WMS_CAPABILITIES_TTL_SECONDS)

    def _collection_items_ttl_seconds(self, collection_id: str) -> int:
        lowered = collection_id.lower()
        if "climate-stations" in lowered or lowered.endswith("-stations"):
            return max(self.cache_ttl_seconds, ECCC_STATION_CATALOG_TTL_SECONDS)
        if "climate-hourly" in lowered or "hourly" in lowered:
            return max(self.cache_ttl_seconds, ECCC_OBSERVATION_TTL_SECONDS)
        if any(
            marker in lowered
            for marker in (
                "weather-alerts",
                "swob-realtime",
                "aqhi",
                "hydrometric",
                "hurricane",
            )
        ):
            return max(self.cache_ttl_seconds, ECCC_REALTIME_TTL_SECONDS)
        return max(self.cache_ttl_seconds, ECCC_OBSERVATION_TTL_SECONDS)


def _normalize_alert_feature(
    feature: dict[str, Any],
    result: FetchResult,
    source_status: SourceStatus,
    index: int,
) -> AlertFeature | None:
    properties = feature.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return None

    alert_id = str(
        feature.get("id")
        or properties.get("identifier")
        or properties.get("cap:identifier")
        or properties.get("id")
        or f"eccc-alert-{index}"
    )

    # MSC GeoMet `weather-alerts` properties use Canadian-specific names;
    # CAP-style names are kept as fallbacks for compatibility with synthetic
    # / partner feeds.
    issued_at = _first_datetime(
        properties,
        [
            "publication_datetime",
            "validity_datetime",
            "sent",
            "effective",
            "published",
            "issued_at",
            "issueTime",
        ],
        fallback=result.retrieved_at,
    )
    expires_at = _first_datetime(
        properties,
        [
            "expiration_datetime",
            "event_end_datetime",
            "expires",
            "end",
            "ends",
            "expiry",
        ],
        fallback=None,
    )

    alert_type = str(properties.get("alert_type") or "").strip().lower()
    severity_raw = str(properties.get("severity") or _severity_from_alert_type(alert_type))
    severity = _normalize_severity(severity_raw)
    cap_status = _normalize_cap_status(str(properties.get("status", "actual")))

    name_en = (
        properties.get("alert_name_en")
        or properties.get("alert_short_name_en")
        or properties.get("event")
        or properties.get("eventType")
    )
    event = str(name_en or "Weather alert")

    headline_en = (
        properties.get("headline")
        or properties.get("title")
        or _format_alert_headline(event, alert_type, properties.get("alert_code"))
    )
    headline = str(headline_en)

    description = str(
        properties.get("alert_text_en")
        or properties.get("description")
        or headline
    )

    return AlertFeature(
        alert_id=alert_id,
        source_id="eccc_geomet_ogc_api",
        source_status=source_status,
        adapter="eccc_geomet",
        event=event,
        severity=severity,
        status=cap_status,
        headline=headline,
        description=description,
        issued_at=issued_at,
        expires_at=expires_at,
        geometry=geometry,
        attribution=ECCC_ATTRIBUTION,
        retrieved_at=result.retrieved_at,
        raw_properties=properties,
    )


def _severity_from_alert_type(alert_type: str) -> str:
    """Map ECCC `alert_type` (warning/watch/advisory/statement) to CAP severity."""
    mapping = {
        "warning": "severe",
        "watch": "moderate",
        "advisory": "moderate",
        "statement": "minor",
        "ended": "minor",
    }
    return mapping.get(alert_type, "unknown")


def _derive_display_properties(layer_id: str, properties: dict[str, Any]) -> dict[str, Any]:
    """Produce a stable, renderer-friendly subset of property fields.

    Curated OGC collections each carry their own GeoMet property vocabulary.
    Surface the most useful label/value/timestamp under known keys so the
    web client can render tooltips without knowing per-collection schemas.
    """
    display: dict[str, Any] = {}

    def first(*keys: str) -> Any:
        for key in keys:
            value = properties.get(key)
            if value not in (None, ""):
                return value
        return None

    # --- weather alerts ----------------------------------------------------
    if layer_id == "eccc_weather_alerts":
        name = first("alert_name_en", "alert_short_name_en", "event")
        atype = first("alert_type") or ""
        code = first("alert_code")
        text = first("alert_text_en", "description", "headline")
        if name:
            display["_display_title"] = (
                f"{name} {atype}".strip()
                if atype and atype.lower() not in str(name).lower()
                else str(name)
            )
        if code:
            display["_display_subtitle"] = f"Code: {code}"
        if text:
            display["_display_body"] = text
        display["_display_event_kind"] = "alert"

    # --- AQHI observations / forecasts ------------------------------------
    elif layer_id in {"eccc_aqhi_realtime", "eccc_aqhi_forecasts"}:
        location = first("location_name_en", "location_name", "station_name_en", "station_name")
        aqhi = first("aqhi", "aqhi_value", "value")
        observed = first("observation_datetime", "forecast_datetime", "datetime")
        if location:
            display["_display_title"] = str(location)
        if aqhi is not None:
            display["_display_subtitle"] = f"AQHI {aqhi}"
        if observed:
            display["_display_body"] = f"Observed/Forecast: {observed}"
        display["_display_event_kind"] = "aqhi"

    # --- Hydrometric realtime / daily -------------------------------------
    elif layer_id.startswith("eccc_hydrometric"):
        station = first("STATION_NAME", "station_name", "STATION_NUMBER")
        level = first("LEVEL", "water_level", "WATER_LEVEL")
        discharge = first("DISCHARGE", "DISCHARGE_VALUE", "discharge")
        when = first("DATETIME", "datetime")
        if station:
            display["_display_title"] = str(station)
        bits: list[str] = []
        if level is not None:
            bits.append(f"Level {level} m")
        if discharge is not None:
            bits.append(f"Discharge {discharge} m³/s")
        if bits:
            display["_display_subtitle"] = " · ".join(bits)
        if when:
            display["_display_body"] = f"Observed: {when}"
        display["_display_event_kind"] = "hydrometric"

    # --- SWOB-ML surface observations -------------------------------------
    elif layer_id == "eccc_swob_realtime":
        station = first("stn_nam-value", "stn_nam", "station_name")
        air_temp = first("air_temp-value", "air_temp", "temperature")
        wind_spd = first("wnd_spd-value", "wnd_spd", "wind_speed")
        wind_dir = first("wnd_dir-value", "wnd_dir", "wind_direction")
        visibility = first("vis-value", "visibility", "visib-value")
        when = first("date_tm-value", "date_tm", "datetime")
        if station:
            display["_display_title"] = str(station)
        bits = []
        if air_temp is not None:
            bits.append(f"Temp {air_temp} °C")
        if wind_spd is not None:
            if wind_dir is not None:
                bits.append(f"Wind {wind_dir}° @ {wind_spd} km/h")
            else:
                bits.append(f"Wind {wind_spd} km/h")
        if visibility is not None:
            try:
                vis_km = round(float(visibility) / 1000, 1)
                bits.append(f"Vis {vis_km} km")
            except (ValueError, TypeError):
                pass
        if bits:
            display["_display_subtitle"] = " · ".join(bits)
        if when:
            display["_display_body"] = f"Observed: {when}"
        display["_display_event_kind"] = "surface_obs"

    # --- Hurricane (CHC) variants -----------------------------------------
    elif layer_id.startswith("eccc_hurricane"):
        name = first("storm_name", "name", "stormname")
        cat = first("category", "intensity_category")
        wind = first("max_wind_kt", "max_wind", "windspeed", "windspeed_kt")
        when = first("datetime", "valid_time", "forecast_time")
        if name:
            display["_display_title"] = str(name)
        bits = []
        if cat is not None:
            bits.append(f"Cat {cat}")
        if wind is not None:
            bits.append(f"Max wind {wind} kt")
        if bits:
            display["_display_subtitle"] = " · ".join(bits)
        if when:
            display["_display_body"] = f"Time: {when}"
        display["_display_event_kind"] = "tropical_system"

    return display


def _format_alert_headline(event: str, alert_type: str, alert_code: Any) -> str:
    event_titled = event.strip()
    # Many GeoMet names already end with "warning"/"watch" so don't double up.
    if alert_type and alert_type not in event_titled.lower():
        composed = f"{event_titled} {alert_type}".strip()
    else:
        composed = event_titled or "Weather alert"
    if isinstance(alert_code, str) and alert_code:
        return f"{composed} ({alert_code})"
    return composed


def _normalize_station_feature(
    feature: dict[str, Any],
    result: FetchResult,
    source_status: SourceStatus,
    index: int,
) -> Observation | None:
    point = _feature_point(feature)
    if point is None:
        return None
    longitude, latitude = point

    properties = feature.get("properties")
    if not isinstance(properties, dict):
        properties = {}

    observed_at = _first_datetime(
        properties,
        [
            "datetime",
            "date_tm",
            "date_tm-value",
            "date_time",
            "observed_at",
            "last_report",
        ],
        fallback=result.retrieved_at,
    )
    station_id = str(
        properties.get("station_id")
        or properties.get("stn_id-value")
        or properties.get("msc_id-value")
        or properties.get("wmo_id-value")
        or properties.get("clim_id-value")
        or properties.get("id")
        or properties.get("CLIMATE_IDENTIFIER")
        or properties.get("wmo_identifier")
        or feature.get("id")
        or f"station-{index}"
    )
    station_name = str(
        properties.get("station_name")
        or properties.get("stn_nam-value")
        or properties.get("stn_nam")
        or properties.get("name")
        or properties.get("STATION_NAME")
        or station_id
    )

    values, units = _extract_observation_values(properties)
    flags = ["eccc_geomet"]
    if source_status == SourceStatus.stale:
        flags.append("stale")

    return Observation(
        observation_id=f"station-{station_id}-{observed_at.isoformat()}",
        station_id=station_id,
        station_name=station_name,
        latitude=latitude,
        longitude=longitude,
        elevation_m=_to_float(properties.get("elevation") or properties.get("elevation_m")),
        observed_at=observed_at,
        values=values,
        units=units,
        source_id="eccc_geomet_ogc_api",
        source_status=source_status,
        adapter="eccc_geomet",
        quality_flags=flags,
        retrieved_at=result.retrieved_at,
        expires_at=result.expires_at,
        raw_properties=properties,
    )


def _normalize_hourly_feature(
    feature: dict[str, Any],
    result: FetchResult,
    source_status: SourceStatus,
    index: int,
) -> Observation | None:
    observation = _normalize_station_feature(feature, result, source_status, index)
    if observation is None:
        return None
    return observation.model_copy(
        update={
            "observation_id": (
                f"hourly-{observation.station_id}-{observation.observed_at.isoformat()}"
            ),
            "quality_flags": [*observation.quality_flags, "hourly"],
        }
    )


def _extract_observation_values(
    properties: dict[str, Any],
) -> tuple[dict[str, float], dict[str, str]]:
    values: dict[str, float] = {}
    units: dict[str, str] = {}

    # Build a case-insensitive lookup: the same property may appear as
    # "TEMP", "Temp", or "temp" depending on the GeoMet collection.
    lower_props: dict[str, Any] = {k.lower(): v for k, v in properties.items()}

    def _get(key: str) -> Any:
        return lower_props.get(key.lower())

    candidates: dict[str, list[tuple[str, str | None]]] = {
        "temperature_2m": [
            ("air_temp-value", "degC"),
            ("air_temp", "degC"),
            ("temperature", "degC"),
            ("temp", "degC"),
            ("temp_c", "degC"),
        ],
        "wind_speed_10m": [
            ("wnd_spd-value", "km/h"),
            ("wind_speed", "km/h"),
            ("wind_spd", "km/h"),
            ("wind_speed_kmh", "km/h"),
        ],
        "wind_direction_10m": [
            ("wnd_dir-value", "deg"),
            ("wind_direction", "deg"),
            ("wind_dir", "deg"),
        ],
        "wind_gust_10m": [
            ("wnd_gust_spd-value", "km/h"),
            ("max_wnd_spd-value", "km/h"),
            ("gust_spd-value", "km/h"),
            ("wind_gust_speed", "km/h"),
            ("peak_wind_speed", "km/h"),
            ("gust_speed", "km/h"),
        ],
        "pressure_msl": [
            ("mslp-value", "hPa"),
            ("sea_level_pressure-value", "hPa"),
            ("pressure", "hPa"),
            ("pressure_msl", "hPa"),
            ("station_pressure", "kPa"),
            ("stn_pres-value", "kPa"),
        ],
        "relative_humidity_2m": [
            ("rel_hum-value", "%"),
            ("relative_humidity", "%"),
            ("rel_hum", "%"),
        ],
        "dewpoint_2m": [
            ("dew_point-value", "degC"),
            ("dwpt_temp-value", "degC"),
            ("dewpoint", "degC"),
            ("dew_point", "degC"),
        ],
        "precipitation_1h": [
            ("pcpn_amt_pst1hr-value", "mm"),
            ("precipitation_amount_past_1_hour", "mm"),
            ("rnfl_amt_pst1hr-value", "mm"),
            ("rain_amt_pst1hr-value", "mm"),
            ("precip_1hr", "mm"),
        ],
        "precipitation_24h": [
            ("pcpn_amt_pst24hr-value", "mm"),
            ("precipitation_amount_past_24_hours", "mm"),
            ("rnfl_amt_pst24hr-value", "mm"),
            ("precip_24hr", "mm"),
        ],
        "snow_depth": [
            ("snow_dpth-value", "cm"),
            ("snow_depth", "cm"),
            ("snw_dpth-value", "cm"),
            ("SNOW_GRND", "cm"),
        ],
        "visibility": [
            ("vis-value", "m"),
            ("visibility", "m"),
            ("visib-value", "m"),
            ("VISIBILITY", "m"),
        ],
        "air_quality_index": [
            ("aqhi", "index"),
            ("aqhi_value", "index"),
            ("air_quality_health_index", "index"),
        ],
    }

    for target, keys in candidates.items():
        for key, raw_unit in keys:
            value = _to_float(_get(key))
            if value is None:
                continue
            if target in {"wind_speed_10m", "wind_gust_10m"} and raw_unit == "km/h":
                value = value / 3.6
                units[target] = "m/s"
            elif target == "pressure_msl" and raw_unit == "kPa":
                value = value * 10.0
                units[target] = "hPa"
            else:
                units[target] = raw_unit or ""
            values[target] = value
            break

    return values, units


def _feature_point(feature: dict[str, Any]) -> tuple[float, float] | None:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return None

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if geometry_type == "Point" and isinstance(coordinates, list) and len(coordinates) >= 2:
        if isinstance(coordinates[0], (int, float)) and isinstance(coordinates[1], (int, float)):
            return float(coordinates[0]), float(coordinates[1])

    points = _flatten_points(coordinates)
    if not points:
        return None

    avg_lon = sum(point[0] for point in points) / len(points)
    avg_lat = sum(point[1] for point in points) / len(points)
    return avg_lon, avg_lat


def _flatten_points(value: Any) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []

    if isinstance(value, list):
        if (
            len(value) == 2
            and isinstance(value[0], (int, float))
            and isinstance(value[1], (int, float))
        ):
            points.append((float(value[0]), float(value[1])))
        else:
            for child in value:
                points.extend(_flatten_points(child))
    return points


def _first_datetime(
    properties: dict[str, Any],
    keys: list[str],
    fallback: datetime | None,
) -> datetime | None:
    for key in keys:
        raw = properties.get(key)
        parsed = _parse_datetime(raw)
        if parsed is not None:
            return parsed
    return fallback


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UTC)
    if not isinstance(value, str):
        return None

    text = value.strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _normalize_severity(value: str) -> str:
    lowered = value.strip().lower()
    if lowered in {"minor", "moderate", "severe", "extreme"}:
        return lowered
    if lowered in {"unknown", "none", ""}:
        return "unknown"
    return "unknown"


def _normalize_cap_status(value: str) -> str:
    lowered = value.strip().lower()
    if lowered in {"actual", "exercise", "system", "test", "draft"}:
        return lowered
    return "actual"


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _parse_wms_layers(xml_text: str) -> list[WmsCapabilityLayerSummary]:
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError:
        return []

    namespace = ""
    if root.tag.startswith("{") and "}" in root.tag:
        namespace = root.tag.split("}", 1)[0] + "}"

    summaries: list[WmsCapabilityLayerSummary] = []
    seen: set[str] = set()

    for layer in root.findall(f".//{namespace}Layer"):
        name = layer.findtext(f"{namespace}Name")
        if not name:
            continue
        lowered = name.lower()
        if lowered in seen:
            continue
        seen.add(lowered)

        title = layer.findtext(f"{namespace}Title")
        abstract = layer.findtext(f"{namespace}Abstract")
        queryable = layer.attrib.get("queryable") == "1"
        
        styles = []
        legend_url = None
        for style in layer.findall(f"{namespace}Style"):
            style_name = style.findtext(f"{namespace}Name")
            if style_name:
                styles.append(style_name)
            
            if not legend_url:
                legend_url_elem = style.find(f".//{namespace}LegendURL//{namespace}OnlineResource")
                if legend_url_elem is not None:
                    legend_url = legend_url_elem.attrib.get("{http://www.w3.org/1999/xlink}href")
        
        dimensions = {}
        has_time = False
        time_extent = None
        
        for dimension in layer.findall(f"{namespace}Dimension"):
            dim_name = dimension.attrib.get("name")
            if dim_name:
                dimensions[dim_name] = (dimension.text or "").strip()
                if dim_name.lower() == "time":
                    has_time = True
                    time_extent = dimensions[dim_name] or None

        if not has_time:
            for extent in layer.findall(f"{namespace}Extent"):
                ext_name = extent.attrib.get("name")
                if ext_name and ext_name.lower() == "time":
                    has_time = True
                    time_extent = (extent.text or "").strip() or None
                    break

        bounding_boxes = {}
        for bbox in layer.findall(f"{namespace}BoundingBox"):
            crs = bbox.attrib.get("CRS") or bbox.attrib.get("SRS")
            if crs:
                try:
                    bounding_boxes[crs] = [
                        float(bbox.attrib.get("minx", 0)),
                        float(bbox.attrib.get("miny", 0)),
                        float(bbox.attrib.get("maxx", 0)),
                        float(bbox.attrib.get("maxy", 0)),
                    ]
                except ValueError:
                    pass

        summaries.append(
            WmsCapabilityLayerSummary(
                layer_name=name,
                title=title,
                abstract=abstract,
                styles=styles,
                dimensions=dimensions,
                bounding_boxes=bounding_boxes,
                legend_url=legend_url,
                queryable=queryable,
                has_time_dimension=has_time,
                time_extent=time_extent,
            )
        )

    return summaries


def _curated_match_message(
    matched: WmsCapabilityLayerSummary | None,
    definition: dict[str, Any],
) -> str:
    if matched is not None:
        return f"Resolved against GetCapabilities as {matched.layer_name}."
    candidates = definition.get("candidate_layer_names") or []
    rendered = ", ".join(candidates) if candidates else "(none)"
    return (
        "Curated layer not present in fetched GetCapabilities; "
        f"candidates tried: {rendered}."
    )


def _curated_default_opacity(product: str) -> float:
    if product == "radar":
        return 0.82
    if product == "satellite":
        return 0.72
    if product == "temperature":
        return 0.58
    return 0.68


def _wms_bounds_lonlat(bounding_boxes: dict[str, list[float]]) -> list[float] | None:
    for crs in ("CRS:84", "OGC:CRS84", "EPSG:4326"):
        bbox = bounding_boxes.get(crs)
        if not bbox or len(bbox) != 4:
            continue
        minx, miny, maxx, maxy = bbox
        if (
            crs == "EPSG:4326"
            and max(abs(minx), abs(maxx)) <= 90
            and max(abs(miny), abs(maxy)) <= 180
        ):
            return [miny, minx, maxy, maxx]
        return [minx, miny, maxx, maxy]
    return None


def _resolve_curated_layer(
    by_name_lower: dict[str, WmsCapabilityLayerSummary],
    candidate_layer_names: list[str],
) -> WmsCapabilityLayerSummary | None:
    """Exact-match resolver against parsed capabilities (case-insensitive).

    No keyword/substring matching. Returns the first candidate present in
    capabilities or None.
    """
    for candidate in candidate_layer_names:
        if not candidate:
            continue
        match = by_name_lower.get(candidate.lower())
        if match is not None:
            return match
    return None


def _collection_id_for_layer(layer_id: str, fallback: str | None = None) -> str | None:
    for entry in load_verified_eccc_ogc_collections():
        if entry.get("id") == layer_id:
            value = entry.get("collection_id")
            return value if isinstance(value, str) and value else fallback
    return fallback


_VERIFIED_WMS_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "verified_eccc_wms_layers.toml"
)

_VERIFIED_OGC_CONFIG_PATH = (
    Path(__file__).resolve().parent.parent / "data" / "verified_eccc_ogc_collections.toml"
)


@lru_cache(maxsize=1)
def load_verified_eccc_ogc_collections() -> list[dict[str, Any]]:
    """Load curated MSC GeoMet OGC API collection definitions from TOML config."""
    path = _VERIFIED_OGC_CONFIG_PATH
    if not path.exists():
        logger.warning("Verified ECCC OGC config missing at %s", path)
        return []
    try:
        with path.open("rb") as fp:
            data = tomllib.load(fp)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to parse %s: %s", path, exc)
        return []
    entries = data.get("collection") or []
    if not isinstance(entries, list):
        return []
    return entries


def build_ogc_collections_diagnostics(
    available_collection_ids: set[str],
) -> dict[str, Any]:
    """Diagnostics: which curated OGC collections are present in /collections."""
    curated = load_verified_eccc_ogc_collections()
    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for entry in curated:
        cid = entry.get("collection_id")
        record = {
            "id": entry.get("id"),
            "title": entry.get("title"),
            "collection_id": cid,
            "category": entry.get("category"),
            "kind": entry.get("kind"),
        }
        if cid and cid.lower() in available_collection_ids:
            matched.append(record)
        else:
            unmatched.append(
                {**record, "reason": "collection_id not present in live /collections"}
            )
    return {
        "configured_count": len(curated),
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "matched": matched,
        "unmatched": unmatched,
        "parsed_collection_count": len(available_collection_ids),
    }


@lru_cache(maxsize=1)
def load_verified_eccc_wms_layers() -> list[dict[str, Any]]:
    """Load curated ECCC WMS layer definitions from TOML config.

    Returns a list of dicts; missing config yields an empty list (callers
    must handle gracefully).
    """
    path = _VERIFIED_WMS_CONFIG_PATH
    if not path.exists():
        logger.warning("Verified ECCC WMS config missing at %s", path)
        return []
    try:
        with path.open("rb") as fp:
            data = tomllib.load(fp)
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to parse %s: %s", path, exc)
        return []
    entries = data.get("layer") or []
    if not isinstance(entries, list):
        return []
    return entries


def build_wms_curated_diagnostics(
    parsed_layers: list[WmsCapabilityLayerSummary],
) -> dict[str, Any]:
    """Diagnostics: which curated layers matched/unmatched vs parsed capabilities."""
    by_name_lower = {layer.layer_name.lower(): layer for layer in parsed_layers}
    curated = load_verified_eccc_wms_layers()
    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for entry in curated:
        candidates = entry.get("candidate_layer_names", [])
        resolved = _resolve_curated_layer(by_name_lower, candidates)
        if resolved is not None:
            matched.append(
                {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "candidate_layer_names": candidates,
                    "matched_layer_name": resolved.layer_name,
                    "has_time_dimension": resolved.has_time_dimension,
                }
            )
        else:
            unmatched.append(
                {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "candidate_layer_names": candidates,
                    "reason": "no candidate present in parsed GetCapabilities",
                }
            )
    return {
        "configured_count": len(curated),
        "matched_count": len(matched),
        "unmatched_count": len(unmatched),
        "matched": matched,
        "unmatched": unmatched,
        "parsed_layer_count": len(parsed_layers),
    }
