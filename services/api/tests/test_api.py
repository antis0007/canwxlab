import asyncio
from datetime import UTC, datetime
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from canwxlab_api.adapters.base import WeatherSourceAdapter
from canwxlab_api.adapters.composite import CompositeWeatherSourceAdapter
from canwxlab_api.adapters.eccc_geomet import EcccGeoMetSourceAdapter
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

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(200, json={"ok": True, "query": str(request.url)})

    async def run_test() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            cache = JsonFileCacheClient(cache_dir=tmp_path, timeout_seconds=2.0, client=http_client)
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
