from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from xml.etree import ElementTree

from canwxlab_api.adapters.base import BBox, WeatherSourceAdapter
from canwxlab_api.http_cache import FetchResult, JsonFileCacheClient
from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    LayerServiceType,
    Observation,
    SourceStatus,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
    WmsCapabilityLayerSummary,
)

logger = logging.getLogger(__name__)

ECCC_ATTRIBUTION = "Environment and Climate Change Canada / Meteorological Service of Canada."
ECCC_LICENSE_URL = "https://eccc-msc.github.io/open-data/readme_en/"


class EcccGeoMetSourceAdapter(WeatherSourceAdapter):
    """Live-capable ECCC/MSC GeoMet source adapter with local cache fallback."""

    def __init__(
        self,
        ogc_api_base: str,
        wms_base: str,
        live_enabled: bool,
        timeout_seconds: float,
        cache_ttl_seconds: int,
        cache_dir: str,
    ) -> None:
        self.ogc_api_base = ogc_api_base.rstrip("/")
        self.wms_base = wms_base.rstrip("/")
        self.live_enabled = live_enabled
        self.cache_ttl_seconds = cache_ttl_seconds
        self.cache = JsonFileCacheClient(
            cache_dir=Path(cache_dir) / "eccc_geomet",
            timeout_seconds=timeout_seconds,
        )

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
            ttl_seconds=self.cache_ttl_seconds,
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
            ttl_seconds=self.cache_ttl_seconds,
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
            collection_id="weather-alerts",
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

        result = await self._fetch_collection_items(
            collection_id="climate-stations",
            bbox=bbox,
            limit=limit,
        )
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
                observations.append(normalized)

        return observations[: max(1, limit)]

    async def fetch_recent_hourly_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        if not self.live_enabled:
            return []

        result = await self._fetch_collection_items(
            collection_id="climate-hourly",
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
                ttl_seconds=self.cache_ttl_seconds,
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
        by_id = {layer.layer_name.lower(): layer for layer in capabilities.layers}

        definitions = [
            # TODO: Promote these placeholders to verified production layer IDs once
            #       capabilities mapping is validated across environments.
            {
                "layer_id": "eccc_radar_precipitation",
                "title": "ECCC Radar Precipitation (placeholder)",
                "variable": "radar_precipitation",
                "unit": "mm/h",
                "keywords": ["radar", "precip"],
                "description": (
                    "GeoMet radar precipitation WMS layer placeholder "
                    "pending verification."
                ),
            },
            {
                "layer_id": "eccc_radar_precipitation_type",
                "title": "ECCC Radar Precipitation Type (placeholder)",
                "variable": "radar_precipitation_type",
                "unit": "category",
                "keywords": ["radar", "precip", "type"],
                "description": (
                    "GeoMet precipitation-type radar WMS layer placeholder "
                    "pending verification."
                ),
            },
            {
                "layer_id": "eccc_goes_visible_natural",
                "title": "ECCC GOES Visible/Natural (placeholder)",
                "variable": "goes_visible_natural",
                "unit": "reflectance",
                "keywords": ["goes", "visible"],
                "description": (
                    "GeoMet GOES visible/natural colour WMS layer placeholder "
                    "pending verification."
                ),
            },
            {
                "layer_id": "eccc_goes_infrared",
                "title": "ECCC GOES Infrared (placeholder)",
                "variable": "goes_infrared",
                "unit": "kelvin",
                "keywords": ["goes", "infrared"],
                "description": "GeoMet GOES infrared WMS layer placeholder pending verification.",
            },
        ]

        weather_layers: list[WeatherLayer] = []
        for definition in definitions:
            matched = _find_wms_candidate(by_id, definition["keywords"])
            verified = matched is not None
            layer_status = capabilities.source.status if verified else SourceStatus.unavailable
            weather_layers.append(
                WeatherLayer(
                    layer_id=definition["layer_id"],
                    name=definition["title"],
                    title=definition["title"],
                    kind="raster",
                    variable=definition["variable"],
                    unit=definition["unit"],
                    source_id="eccc_geomet_wms",
                    status=layer_status,
                    adapter="eccc_geomet",
                    service_type=LayerServiceType.wms,
                    last_updated=capabilities.source.last_updated,
                    last_successful_fetch=capabilities.source.last_successful_fetch,
                    last_attempted_fetch=capabilities.source.last_attempted_fetch,
                    retrieved_at=capabilities.source.retrieved_at,
                    expires_at=capabilities.source.expires_at,
                    attribution=ECCC_ATTRIBUTION,
                    license_url=ECCC_LICENSE_URL,
                    default_opacity=0.65,
                    color_ramps=[],
                    styles=["default"],
                    wms_base_url=self.wms_base,
                    wms_layer_name=matched.layer_name if matched else None,
                    time_dimension_supported=matched.has_time_dimension if matched else False,
                    update_frequency_hint="5-10 minutes (placeholder)",
                    description=definition["description"],
                    message=(
                        f"Verified via GetCapabilities as {matched.layer_name}."
                        if matched
                        else "Layer name not verified from capabilities yet."
                    ),
                    is_live=layer_status == SourceStatus.live,
                    metadata={
                        "verified": verified,
                        "capabilities_title": matched.title if matched else None,
                        "time_extent": matched.time_extent if matched else None,
                    },
                )
            )

        return weather_layers

    async def list_layers(self) -> list[WeatherLayer]:
        source = await self._ogc_source_status()
        wms_layers = await self.get_wms_layer_catalog()

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
            ),
        ]

        return [*ogc_layers, *wms_layers]

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
            ttl_seconds=self.cache_ttl_seconds,
            allow_stale_on_error=True,
        )

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
                ttl_seconds=self.cache_ttl_seconds,
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
        or f"eccc-alert-{index}"
    )

    issued_at = _first_datetime(
        properties,
        ["sent", "effective", "published", "issued_at", "issueTime"],
        fallback=result.retrieved_at,
    )
    expires_at = _first_datetime(
        properties,
        ["expires", "end", "ends", "expiry"],
        fallback=None,
    )

    severity = _normalize_severity(str(properties.get("severity", "unknown")))
    cap_status = _normalize_cap_status(str(properties.get("status", "actual")))
    event = str(properties.get("event") or properties.get("eventType") or "Weather alert")
    headline = str(properties.get("headline") or properties.get("title") or event)

    return AlertFeature(
        alert_id=alert_id,
        source_id="eccc_geomet_ogc_api",
        source_status=source_status,
        adapter="eccc_geomet",
        event=event,
        severity=severity,
        status=cap_status,
        headline=headline,
        description=str(properties.get("description") or headline),
        issued_at=issued_at,
        expires_at=expires_at,
        geometry=geometry,
        attribution=ECCC_ATTRIBUTION,
        retrieved_at=result.retrieved_at,
        raw_properties=properties,
    )


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
        ["datetime", "date_tm", "date_time", "observed_at", "last_report"],
        fallback=result.retrieved_at,
    )
    station_id = str(
        properties.get("station_id")
        or properties.get("id")
        or properties.get("CLIMATE_IDENTIFIER")
        or properties.get("wmo_identifier")
        or feature.get("id")
        or f"station-{index}"
    )
    station_name = str(
        properties.get("station_name")
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
    # TODO: Expand field mapping with authoritative GeoMet property dictionaries per collection.
    values: dict[str, float] = {}
    units: dict[str, str] = {}
    candidates = {
        "temperature_2m": ["air_temp", "temperature", "temp", "temp_c"],
        "wind_speed_10m": ["wind_speed", "wind_spd", "wind_speed_kmh"],
        "pressure_msl": ["pressure", "pressure_msl", "station_pressure"],
    }

    for target, keys in candidates.items():
        for key in keys:
            value = _to_float(properties.get(key))
            if value is None:
                continue
            values[target] = value
            if target == "temperature_2m":
                units[target] = "degC"
            elif target == "wind_speed_10m":
                units[target] = "m/s"
                if key.endswith("kmh"):
                    values[target] = value / 3.6
            elif target == "pressure_msl":
                units[target] = "hPa"
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


def _find_wms_candidate(
    layers: dict[str, WmsCapabilityLayerSummary],
    keywords: list[str],
) -> WmsCapabilityLayerSummary | None:
    for layer in layers.values():
        haystack = f"{layer.layer_name} {layer.title or ''}".lower()
        if all(keyword in haystack for keyword in keywords):
            return layer
    return None
