from fastapi.testclient import TestClient

from canwxlab_api.main import app

client = TestClient(app)


def test_list_cases_seeds_default():
    r = client.get("/api/verification/cases")
    assert r.status_code == 200
    data = r.json()
    assert any(c["case_id"] == "default-mock-case" for c in data)


def test_get_case_summary():
    r = client.get("/api/verification/cases/default-mock-case/summary")
    assert r.status_code == 200
    metrics = r.json()
    assert len(metrics) >= 1
    assert "mae" in metrics[0]


def test_get_case_diff_absolute_error_is_nonnegative():
    r = client.get(
        "/api/verification/cases/default-mock-case/diff/temperature_2m",
        params={"diff_mode": "ABSOLUTE_ERROR"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_generated_mock"] is True
    assert body["rows"] > 0
    assert body["cols"] > 0
    # absolute error grid must be >= 0 everywhere
    for row in body["grid"]:
        for v in row:
            assert v >= 0.0


def test_create_case_returns_new_id():
    r = client.post(
        "/api/verification/cases",
        json={
            "name": "test-case",
            "a": {"label": "A", "source_id": "x"},
            "b": {"label": "B", "source_id": "y"},
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["case_id"]
    assert body["name"] == "test-case"


def test_unknown_field_returns_404():
    r = client.get("/api/verification/cases/default-mock-case/diff/no_such_field")
    assert r.status_code == 404
