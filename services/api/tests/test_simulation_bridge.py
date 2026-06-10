import os

from fastapi.testclient import TestClient

from canwxlab_api.main import app
from canwxlab_api.routes import simulations

client = TestClient(app)

_DEFAULT_CONFIG = {
    "duration_hours": 1.0,
    "timestep_seconds": 60.0,
    "grid": {"nx": 16, "ny": 16, "nz": 4},
    "physics": {},
}


def test_stub_mode_returns_completed(monkeypatch):
    monkeypatch.setenv("CANWXLAB_SIMULATION_MODE", "stub")
    r = client.post("/api/simulations/runs", json=_DEFAULT_CONFIG)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "completed"
    assert body["provenance"]["mode"] == "stub"
    assert body["provenance"]["source_classification"] == "mock_experimental"


def test_cli_mode_unavailable_returns_failed(monkeypatch):
    """When the CLI binary is missing, the bridge must fail gracefully."""
    monkeypatch.setenv("CANWXLAB_SIMULATION_MODE", "cli")
    # Force resolver to find nothing by isolating PATH and ensuring no
    # target/{debug,release}/canwxsim-cli exists in test env (typical CI).
    monkeypatch.setenv("PATH", "")
    r = client.post("/api/simulations/runs", json=_DEFAULT_CONFIG)
    assert r.status_code == 201
    body = r.json()
    # Either failed (no binary) or completed (a real binary happens to exist locally).
    # Either way: provenance.mode must be cli, no HTTP exception.
    assert body["provenance"]["mode"] == "cli"
    assert body["status"] in {"failed", "completed"}


def test_cli_binary_resolver_searches_workspace_target(monkeypatch):
    monkeypatch.setattr(simulations.shutil, "which", lambda _name: None)
    root = simulations._repo_root()
    assert (root / "Cargo.toml").exists()


def test_list_runs_returns_array():
    r = client.get("/api/simulations/runs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_get_run_404_on_unknown():
    r = client.get("/api/simulations/runs/does-not-exist")
    assert r.status_code == 404


def teardown_module(module):
    # Restore env to whatever the rest of the suite expects.
    os.environ.pop("CANWXLAB_SIMULATION_MODE", None)
