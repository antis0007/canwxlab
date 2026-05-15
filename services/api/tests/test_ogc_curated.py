from fastapi.testclient import TestClient

from canwxlab_api.adapters.eccc_geomet import (
    build_ogc_collections_diagnostics,
    load_verified_eccc_ogc_collections,
)
from canwxlab_api.main import app

client = TestClient(app)


def test_load_curated_ogc_has_expected_entries():
    entries = load_verified_eccc_ogc_collections()
    assert isinstance(entries, list)
    ids = {e.get("id") for e in entries}
    # A representative cross-section we explicitly curate
    expected_subset = {
        "eccc_weather_alerts",
        "eccc_swob_realtime",
        "eccc_aqhi_realtime",
        "eccc_hydrometric_realtime",
        "eccc_lightning_strikes",
        "eccc_hurricane_realtime",
    }
    assert expected_subset.issubset(ids)


def test_diagnostics_unmatched_when_nothing_available():
    diag = build_ogc_collections_diagnostics(set())
    assert diag["matched_count"] == 0
    assert diag["unmatched_count"] == diag["configured_count"]


def test_diagnostics_matches_when_collection_id_present():
    diag = build_ogc_collections_diagnostics({"swob-realtime"})
    matched_ids = {m["id"] for m in diag["matched"]}
    assert "eccc_swob_realtime" in matched_ids


def test_ogc_curated_endpoint_returns_entries():
    r = client.get("/api/eccc/ogc/curated")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body.get("collections"), list)
    assert len(body["collections"]) >= 5


def test_ogc_diagnostics_endpoint_runs_in_mock_mode():
    # Default test fixture uses the mock adapter — /collections probe yields
    # an empty set, so curated entries should all land in `unmatched`.
    r = client.get("/api/eccc/ogc/diagnostics")
    assert r.status_code == 200
    body = r.json()
    assert "curated" in body
    assert body["curated"]["configured_count"] >= 5
