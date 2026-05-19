from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from canwxlab_api.core.event_store import EventStore
from canwxlab_api.dependencies import get_event_store
from canwxlab_api.main import app
from canwxlab_api.models import (
    ConfidenceLevel,
    SourceAdapterRef,
    SpatiotemporalEvent,
    TruthMode,
)


def _make_event(
    h3_cell: str = "8428309ffffffff",
    variable: str = "temperature_2m",
    value: float = 15.0,
    unit: str = "degC",
    source_id: str = "eccc_geomet_ogc_api",
    valid_from: datetime | None = None,
    observed_at: datetime | None = None,
) -> SpatiotemporalEvent:
    now = datetime.now(UTC)
    return SpatiotemporalEvent(
        event_kind="meteorological.observation",
        valid_from=valid_from or now,
        observed_at=observed_at or now,
        longitude=-113.58,
        latitude=53.31,
        h3_cell=h3_cell,
        variable=variable,
        value=value,
        unit=unit,
        source_id=source_id,
        source_adapter=SourceAdapterRef(adapter_id=source_id),
        confidence=0.8,
        confidence_level=ConfidenceLevel.confirmed,
        truth_mode=TruthMode.observed,
        attribution="Test data",
    )


class TestEvidenceRoutes:
    """Integration tests for the Phase A evidence API endpoints."""

    def test_post_events_ingest_returns_correct_counts(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
                _make_event(
                    variable="pressure_msl",
                    value=1013.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]

            response = client.post("/api/events/ingest", json=events_payload)
            assert response.status_code == 200
            body = response.json()
            assert body["events_written"] == 2
            assert body["events_skipped_duplicate"] == 0
            assert body["events_rejected_schema"] == 0
        finally:
            app.dependency_overrides.clear()

    def test_post_events_ingest_empty_rejected(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            response = client.post("/api/events/ingest", json=[])
            assert response.status_code == 400
        finally:
            app.dependency_overrides.clear()

    def test_get_events_returns_ingested_events(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    variable="temperature_2m",
                    value=18.5,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get("/api/events")
            assert response.status_code == 200
            body = response.json()
            assert len(body) == 1
            assert body[0]["variable"] == "temperature_2m"
            assert body[0]["value"] == 18.5
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_provenance_returns_chain(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    h3_cell="cell_test",
                    variable="temperature_2m",
                    value=10.0,
                    valid_from=now - timedelta(seconds=60),
                    observed_at=now - timedelta(seconds=60),
                ).model_dump(mode="json"),
                _make_event(
                    h3_cell="cell_test",
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get("/api/evidence/cell_test/temperature_2m/provenance")
            assert response.status_code == 200
            body = response.json()
            assert body["object_id"] == "cell_test/temperature_2m"
            assert body["current_value"] == 15.0  # latest event
            assert body["unit"] == "degC"
            assert body["confidence_level"] == "confirmed"
            assert len(body["events"]) == 2
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_history_returns_time_ordered(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    variable="temperature_2m",
                    value=10.0,
                    valid_from=now - timedelta(seconds=60),
                    observed_at=now - timedelta(seconds=60),
                ).model_dump(mode="json"),
                _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get("/api/evidence/8428309ffffffff/temperature_2m/history")
            assert response.status_code == 200
            body = response.json()
            assert len(body) == 2
            assert body[0]["value"] == 10.0
            assert body[1]["value"] == 15.0
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_provenance_404_for_missing_object(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            response = client.get("/api/evidence/nonexistent/temperature_2m/provenance")
            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_cells_returns_state(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    h3_cell="cell_x",
                    variable="wind_speed_10m",
                    value=8.0,
                    unit="m/s",
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get(
                "/api/evidence/cells", params={"h3": "cell_x", "variable": "wind_speed_10m"}
            )
            assert response.status_code == 200
            body = response.json()
            assert body["h3_cell"] == "cell_x"
            assert body["variable"] == "wind_speed_10m"
            assert body["value"] == 8.0
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_cells_404_for_missing(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            response = client.get(
                "/api/evidence/cells", params={"h3": "no_cell", "variable": "no_var"}
            )
            assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_get_evidence_conflicts_returns_empty_when_none(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get("/api/evidence/8428309ffffffff/temperature_2m/conflicts")
            assert response.status_code == 200
            assert response.json() == []
        finally:
            app.dependency_overrides.clear()

    def test_events_query_with_filters(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            now = datetime.now(UTC)
            events_payload = [
                _make_event(
                    variable="temperature_2m",
                    value=15.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
                _make_event(
                    variable="pressure_msl",
                    value=1013.0,
                    valid_from=now,
                    observed_at=now,
                ).model_dump(mode="json"),
            ]
            client.post("/api/events/ingest", json=events_payload)

            response = client.get("/api/events", params={"variable": "temperature_2m"})
            assert response.status_code == 200
            body = response.json()
            assert len(body) == 1
            assert body[0]["variable"] == "temperature_2m"
        finally:
            app.dependency_overrides.clear()

    def test_invalid_object_id_returns_400(self) -> None:
        store = EventStore(":memory:")
        app.dependency_overrides[get_event_store] = lambda: store
        client = TestClient(app)

        try:
            response = client.get("/api/evidence/not_enough_parts/provenance")
            assert response.status_code == 400
        finally:
            app.dependency_overrides.clear()
