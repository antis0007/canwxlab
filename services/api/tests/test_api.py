import asyncio
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.composite import CompositeWeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import EcccGeoMetSourceAdapter
from canwxlab_api.adapters.gibs_wmts import GibsWmtsSourceAdapter
from canwxlab_api.adapters.mock import MockWeatherSourceAdapter
from canwxlab_api.dependencies import get_source_adapter
from canwxlab_api.http_cache import FetchResult, JsonFileCacheClient
from canwxlab_api.main import app
from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    Observation,
    SourceStatus,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
)

client = TestClient(app)


class FailingLiveAdapter(WeatherSourceAdapter):
    async def list_sources(self) -> list[DataSource]:
        return [
            DataSource(
                source_id="eccc_geomet_ogc_api",
                name="ECCC/MSC GeoMet OGC API",
                status=SourceStatus.unavailable,
                adapter="eccc_geomet",
                attribution="ECCC",
                description="Live source",
                message="Live failed",
                is_live=False,
                is_experimental=False,
            )
        ]

    async def list_layers(self) -> list[WeatherLayer]:
        return []

    async def get_layer_metadata(self, layer_id: str) -> WeatherLayer | None:
        _ = layer_id
        return None

    async def fetch_recent_hourly_observations(
        self,
        bbox: tuple[float, float, float, float] | None = None,
        limit: int = 100,
    ) -> list[Observation]:
        _ = bbox, limit
        raise RuntimeError("live unavailable")

    async def fetch_station_observations(
        self,
        bbox: tuple[float, float, float, float] | None = None,
        limit: int = 100,
    ) -> list[Observation]:
        _ = bbox, limit
        raise RuntimeError("live unavailable")

    async def fetch_alerts(
        self,
        bbox: tuple[float, float, float, float] | None = None,
        limit: int = 100,
    ) -> list[AlertFeature]:
        _ = bbox, limit
        raise RuntimeError("live unavailable")

    async def get_wms_capabilities_summary(self) -> WmsCapabilitiesSummaryResponse:
        return WmsCapabilitiesSummaryResponse(source=(await self.list_sources())[0], layers=[])



def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"



def test_mock_adapter_still_works() -> None:
    adapter = MockWeatherSourceAdapter()
    observations = asyncio.run(adapter.fetch_station_observations(limit=3))
    alerts = asyncio.run(adapter.fetch_alerts(limit=2))

    assert len(observations) == 3
    assert all(item.source_status == SourceStatus.mock for item in observations)
    assert len(alerts) == 2
    assert all(item.source_status == SourceStatus.mock for item in alerts)



def test_hybrid_mode_falls_back_when_live_adapter_throws() -> None:
    adapter = CompositeWeatherSourceAdapter(
        data_mode="hybrid",
        live_enabled=True,
        mock_adapter=MockWeatherSourceAdapter(),
        live_adapter=FailingLiveAdapter(),
    )

    alerts = asyncio.run(adapter.fetch_alerts(limit=2))
    observations = asyncio.run(adapter.fetch_station_observations(limit=2))

    assert len(alerts) == 2
    assert all(item.source_status == SourceStatus.fallback for item in alerts)
    assert len(observations) == 2
    assert all(item.source_status == SourceStatus.fallback for item in observations)



def test_cache_returns_cached_payload(tmp_path: Path) -> None:
    calls = {"count": 0}
    seen_user_agents: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        seen_user_agents.append(request.headers.get("user-agent"))
        return httpx.Response(200, json={"ok": True, "query": str(request.url)})

    async def run_test() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            cache = JsonFileCacheClient(
                cache_dir=tmp_path,
                timeout_seconds=2.0,
                client=http_client,
                user_agent="CanWxLabTest/1.0 (+https://example.test)",
            )
            first = await cache.fetch_json(
                "https://example.test/data",
                params={"a": 1},
                ttl_seconds=300,
            )
            second = await cache.fetch_json(
                "https://example.test/data",
                params={"a": 1},
                ttl_seconds=300,
            )

            assert first.from_cache is False
            assert second.from_cache is True
            assert second.payload["ok"] is True

    asyncio.run(run_test())
    assert calls["count"] == 1
    assert seen_user_agents == ["CanWxLabTest/1.0 (+https://example.test)"]



def test_stale_cache_used_after_live_failure(tmp_path: Path) -> None:
    mode = {"fail": False}

    def handler(request: httpx.Request) -> httpx.Response:
        if mode["fail"]:
            raise httpx.ConnectError("simulated outage", request=request)
        return httpx.Response(200, json={"value": 42})

    async def run_test() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            cache = JsonFileCacheClient(cache_dir=tmp_path, timeout_seconds=2.0, client=http_client)
            first = await cache.fetch_json(
                "https://example.test/data",
                ttl_seconds=0,
            )
            mode["fail"] = True
            second = await cache.fetch_json(
                "https://example.test/data",
                ttl_seconds=0,
                allow_stale_on_error=True,
            )

            assert first.payload["value"] == 42
            assert second.payload["value"] == 42
            assert second.stale is True

    asyncio.run(run_test())



def test_sources_status_schema() -> None:
    response = client.get("/api/sources/status")
    assert response.status_code == 200
    payload = response.json()
    assert "data_mode" in payload
    assert "live_eccc_enabled" in payload
    assert isinstance(payload["sources"], list)



def test_alerts_normalized_from_mocked_geomet_payload(tmp_path: Path) -> None:
    adapter = CompositeWeatherSourceAdapter(
        data_mode="live",
        live_enabled=True,
        mock_adapter=MockWeatherSourceAdapter(),
        live_adapter=EcccGeoMetSourceAdapter(
            ogc_api_base="https://api.weather.gc.ca",
            wms_base="https://geo.weather.gc.ca/geomet",
            live_enabled=True,
            timeout_seconds=2.0,
            cache_ttl_seconds=60,
            cache_dir=str(tmp_path),
        ),
    )
    app.dependency_overrides[get_source_adapter] = lambda: adapter

    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": "alert-1",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [-114.2, 52.9],
                            [-113.4, 52.9],
                            [-113.4, 53.5],
                            [-114.2, 53.5],
                            [-114.2, 52.9],
                        ]
                    ],
                },
                "properties": {
                    "event": "Snowfall Warning",
                    "severity": "Severe",
                    "status": "Actual",
                    "headline": "Snowfall warning in effect",
                    "description": "Heavy snow expected",
                    "sent": "2026-05-14T12:00:00Z",
                },
            }
        ],
    }

    now = datetime.now(UTC)

    async def fake_fetch_items(collection_id: str, bbox, limit: int) -> FetchResult:
        _ = bbox, limit
        assert collection_id == "weather-alerts"
        return FetchResult(
            payload=payload,
            retrieved_at=now,
            expires_at=now,
            source_url="https://api.weather.gc.ca/collections/weather-alerts/items",
            attempted_at=now,
            from_cache=False,
            stale=False,
            live_fetch_succeeded=True,
        )

    adapter.live_adapter._fetch_collection_items = fake_fetch_items  # type: ignore[method-assign]
    response = client.get("/api/alerts?limit=5")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["event"] == "Snowfall Warning"
    assert body[0]["severity"] == "severe"
    assert body[0]["source_status"] == "live"


def test_ogc_layer_features_endpoint_uses_curated_collection_id(tmp_path: Path) -> None:
    adapter = CompositeWeatherSourceAdapter(
        data_mode="live",
        live_enabled=True,
        mock_adapter=MockWeatherSourceAdapter(),
        live_adapter=EcccGeoMetSourceAdapter(
            ogc_api_base="https://api.weather.gc.ca",
            wms_base="https://geo.weather.gc.ca/geomet",
            live_enabled=True,
            timeout_seconds=2.0,
            cache_ttl_seconds=60,
            cache_dir=str(tmp_path),
        ),
    )
    app.dependency_overrides[get_source_adapter] = lambda: adapter

    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": "swob-1",
                "geometry": {"type": "Point", "coordinates": [-113.5, 53.5]},
                "properties": {"stn_nam-value": "Edmonton Intl", "air_temp-value": 4.2},
            }
        ],
    }

    now = datetime.now(UTC)

    async def fake_fetch_items(collection_id: str, bbox, limit: int) -> FetchResult:
        _ = bbox, limit
        assert collection_id == "swob-realtime"
        return FetchResult(
            payload=payload,
            retrieved_at=now,
            expires_at=now,
            source_url="https://api.weather.gc.ca/collections/swob-realtime/items",
            attempted_at=now,
            from_cache=False,
            stale=False,
            live_fetch_succeeded=True,
        )

    adapter.live_adapter._fetch_collection_items = fake_fetch_items  # type: ignore[method-assign]
    response = client.get("/api/eccc/ogc/layers/eccc_swob_realtime/features?limit=5")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["collection_id"] == "swob-realtime"
    assert body["status"] == "live"
    assert len(body["features"]) == 1
    assert body["features"][0]["properties"]["_canwxlab_layer_id"] == "eccc_swob_realtime"
    # Display fields should be populated for stable client-side rendering.
    assert body["features"][0]["properties"]["_display_title"] == "Edmonton Intl"



def test_stations_normalized_from_mocked_geomet_payload(tmp_path: Path) -> None:
    adapter = CompositeWeatherSourceAdapter(
        data_mode="live",
        live_enabled=True,
        mock_adapter=MockWeatherSourceAdapter(),
        live_adapter=EcccGeoMetSourceAdapter(
            ogc_api_base="https://api.weather.gc.ca",
            wms_base="https://geo.weather.gc.ca/geomet",
            live_enabled=True,
            timeout_seconds=2.0,
            cache_ttl_seconds=60,
            cache_dir=str(tmp_path),
        ),
    )
    app.dependency_overrides[get_source_adapter] = lambda: adapter

    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": "station-1",
                "geometry": {"type": "Point", "coordinates": [-113.58, 53.31]},
                "properties": {
                    "station_id": "CYEG",
                    "station_name": "Edmonton Intl",
                    "date_time": "2026-05-14T13:00:00Z",
                    "temperature": 12.5,
                    "wind_speed": 7.0,
                    "pressure": 1011.8,
                    "elevation_m": 723,
                },
            }
        ],
    }

    now = datetime.now(UTC)

    async def fake_fetch_items(collection_id: str, bbox, limit: int) -> FetchResult:
        _ = bbox, limit
        assert collection_id == "climate-stations"
        return FetchResult(
            payload=payload,
            retrieved_at=now,
            expires_at=now,
            source_url="https://api.weather.gc.ca/collections/climate-stations/items",
            attempted_at=now,
            from_cache=False,
            stale=False,
            live_fetch_succeeded=True,
        )

    adapter.live_adapter._fetch_collection_items = fake_fetch_items  # type: ignore[method-assign]
    response = client.get("/api/observations/stations?limit=5")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["station_id"] == "CYEG"
    assert body[0]["source_status"] == "live"
    assert body[0]["values"]["temperature_2m"] == 12.5



def test_eccc_collections_uses_mocked_httpx(tmp_path: Path) -> None:
    adapter = CompositeWeatherSourceAdapter(
        data_mode="hybrid",
        live_enabled=True,
        mock_adapter=MockWeatherSourceAdapter(),
        live_adapter=EcccGeoMetSourceAdapter(
            ogc_api_base="https://api.weather.gc.ca",
            wms_base="https://geo.weather.gc.ca/geomet",
            live_enabled=True,
            timeout_seconds=2.0,
            cache_ttl_seconds=60,
            cache_dir=str(tmp_path),
        ),
    )
    app.dependency_overrides[get_source_adapter] = lambda: adapter

    payload = {
        "collections": [
            {
                "id": "weather-alerts",
                "title": "Weather alerts",
                "description": "Alert collection",
            }
        ],
        "links": [],
    }

    now = datetime.now(UTC)

    async def fake_fetch_json(
        url: str,
        params: dict,
        ttl_seconds: int,
        allow_stale_on_error: bool,
    ) -> FetchResult:
        _ = params, ttl_seconds, allow_stale_on_error
        assert url == "https://api.weather.gc.ca/collections"
        return FetchResult(
            payload=payload,
            retrieved_at=now,
            expires_at=now,
            source_url="https://api.weather.gc.ca/collections?lang=en&f=json",
            attempted_at=now,
            from_cache=False,
            stale=False,
            live_fetch_succeeded=True,
        )

    adapter.live_adapter.cache.fetch_json = fake_fetch_json  # type: ignore[method-assign]
    response = client.get("/api/eccc/collections")

    app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "live"
    assert body["collections"][0]["id"] == "weather-alerts"



def test_layers_include_canwxsim() -> None:
    response = client.get("/api/layers")
    assert response.status_code == 200
    layer_ids = {layer["layer_id"] for layer in response.json()}
    assert "canwxsim_output" in layer_ids


def test_gibs_layers_publish_time_extent_for_timeline_resolution() -> None:
    layers = asyncio.run(GibsWmtsSourceAdapter().list_layers())

    assert layers
    assert all(layer.service_type == "wmts" for layer in layers)
    assert all(isinstance(layer.metadata.get("time_extent"), str) for layer in layers)
    assert all(layer.metadata["time_extent"].endswith("/P1D") for layer in layers)


def test_cosmic_planning_routes_are_seed_labelled() -> None:
    status_response = client.get("/api/cosmic/status")
    assert status_response.status_code == 200
    status = status_response.json()
    assert status["status"] == "unavailable"
    assert all(source["data_class"] == "planned" for source in status["sources"])

    sources_response = client.get("/api/cosmic/sources")
    assert sources_response.status_code == 200
    source_ids = {source["source_id"] for source in sources_response.json()["sources"]}
    assert {"jpl_horizons", "jpl_sbdb", "celestrak"}.issubset(source_ids)

    objects_response = client.get("/api/cosmic/objects/seed")
    assert objects_response.status_code == 200
    objects = objects_response.json()
    assert objects["data_class"] == "seed"
    assert objects["star_catalog"][0]["data_class"] == "seed"
    assert objects["orbital_bodies"][0]["source_status"] == "mock"

    ephemeris_response = client.get("/api/cosmic/ephemeris", params={"body": "sun"})
    assert ephemeris_response.status_code == 200
    ephemeris = ephemeris_response.json()
    # Planning endpoint must never present empty samples as if they were live data.
    assert ephemeris["data_class"] == "unavailable"
    assert ephemeris["samples"] == []
    assert ephemeris["object_id"] == "sun"
    assert ephemeris["source_id"] == "jpl_horizons"


def test_cosmic_ephemeris_accepts_target_center_and_window_params() -> None:
    response = client.get(
        "/api/cosmic/ephemeris",
        params={
            "target": "mars",
            "center": "sun",
            "start": "2026-05-15T00:00:00Z",
            "end": "2026-05-16T00:00:00Z",
            "step_seconds": 1800,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["object_id"] == "mars"
    assert body["step_seconds"] == 1800
    assert body["data_class"] == "unavailable"
    # Provenance must surface the cache contract so callers can introspect it.
    provenance = body["provenance"]
    assert provenance["adapter"] == "cosmic_horizons"
    assert provenance["center"] == "sun"
    assert ".canwxlab" in provenance["cache_root"].replace("\\", "/")
    assert provenance["cache_path_planned"].endswith(".json")


def test_cosmic_ephemeris_handles_missing_target_gracefully() -> None:
    # Older clients may omit target entirely; the contract still returns a planning
    # shape rather than a 422 so the frontend never has to special-case the call.
    response = client.get("/api/cosmic/ephemeris")
    assert response.status_code == 200
    body = response.json()
    assert body["object_id"] == "unspecified"
    assert body["data_class"] == "unavailable"


def test_cosmic_cache_dirs_are_created_on_import() -> None:
    from pathlib import Path

    from canwxlab_api.adapters.cosmic_horizons import (
        COSMIC_CACHE_ROOT,
        ensure_cosmic_cache_dirs,
    )

    paths = ensure_cosmic_cache_dirs()
    assert paths["root"] == COSMIC_CACHE_ROOT
    assert Path(paths["horizons"]).is_dir()
    assert Path(paths["sbdb"]).is_dir()
    assert Path(paths["celestrak"]).is_dir()



def test_create_simulation_run_and_fetch_field() -> None:
    response = client.post("/api/simulations/runs", json={"duration_hours": 0.25})
    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "completed"

    field_response = client.get(f"/api/simulations/runs/{run['run_id']}/fields/temperature")
    assert field_response.status_code == 200
    field = field_response.json()
    assert field["field_name"] == "temperature"
    assert field["grid"]["width"] > 0



def test_verification_summary() -> None:
    response = client.get("/api/verification/summary")
    assert response.status_code == 200
    metrics = response.json()
    assert len(metrics) == 2
    assert {metric["model_name"] for metric in metrics} == {
        "official_forecast_mock",
        "canwxsim_mock",
    }
