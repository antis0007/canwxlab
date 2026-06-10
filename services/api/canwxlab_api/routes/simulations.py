import json
import logging
import math
import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from canwxlab_api.models import (
    RunStatus,
    SimulationConfig,
    SimulationDiagnostics,
    SimulationRun,
)
from canwxlab_api.sample_fields import generate_grid_field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

_RUNS: dict[str, SimulationRun] = {}
_RUN_FIELDS: dict[str, dict[str, dict[str, Any]]] = {}


def _repo_root() -> Path:
    # simulations.py → routes → canwxlab_api → api → services → repo root
    return Path(__file__).resolve().parents[4]


def _resolve_cli_binary() -> str | None:
    """Locate canwxsim-cli without compiling at request time.

    Search order: PATH → repo `target/release/canwxsim-cli[.exe]`
                → repo `target/debug/canwxsim-cli[.exe]`.
    """
    on_path = shutil.which("canwxsim-cli")
    if on_path:
        return on_path
    repo_root = _repo_root()
    exe = "canwxsim-cli.exe" if os.name == "nt" else "canwxsim-cli"
    for sub in ("target/release", "target/debug"):
        candidate = repo_root / sub / exe
        if candidate.is_file():
            return str(candidate)
    return None


def _build_stub_run(config: SimulationConfig, run_id: str, now: datetime) -> SimulationRun:
    return SimulationRun(
        run_id=run_id,
        status=RunStatus.completed,
        config=config,
        created_at=now,
        updated_at=now,
        completed_at=now,
        diagnostics=SimulationDiagnostics(
            steps_completed=_step_count(config),
            min_pressure_height=984.2,
            max_pressure_height=1029.8,
            min_temperature=263.15,
            max_temperature=298.15,
            min_moisture=0.0,
            max_moisture=0.022,
            max_wind_speed=18.4,
            water_budget_error=0.003,
            stability_warnings=(
                [] if config.timestep_seconds <= 120 else ["Large timestep for demo grid"]
            ),
        ),
        fields_url=f"/api/simulations/runs/{run_id}/fields/temperature",
        provenance={
            "mode": "stub",
            "engine": "canwxsim_sample_stub",
            "source_classification": "mock_experimental",
            "note": "Deterministic sample fields — EXPERIMENTAL, not operational NWP.",
        },
    )


def _step_count(config: SimulationConfig) -> int:
    return max(1, int(math.ceil(config.duration_hours * 3600 / config.timestep_seconds)))


def _reshape_field(
    values: list[float],
    width: int,
    height: int,
    transform=lambda value: value,
) -> list[list[float]]:
    rows: list[list[float]] = []
    for y in range(height):
        start = y * width
        row = [round(float(transform(value)), 4) for value in values[start : start + width]]
        rows.append(row)
    return rows


def _fields_from_cli_payload(payload: dict[str, Any], run_id: str) -> dict[str, dict[str, Any]]:
    grid = payload.get("grid") or {}
    state = payload.get("state") or {}
    width = int(grid.get("width") or 0)
    height = int(grid.get("height") or 0)
    if width <= 0 or height <= 0:
        return {}

    def list_field(name: str) -> list[float]:
        raw = state.get(name)
        return raw if isinstance(raw, list) and len(raw) == width * height else []

    u = list_field("u_wind")
    v = list_field("v_wind")
    wind_speed = [math.hypot(float(a), float(b)) for a, b in zip(u, v)] if u and v else []

    base_grid = {
        "width": width,
        "height": height,
        "bbox": [-141.0, 41.0, -52.0, 83.0],
        "crs": "EPSG:4326",
        "dx_m": grid.get("dx_m"),
        "dy_m": grid.get("dy_m"),
    }
    generated_at = datetime.now(UTC).isoformat()
    provenance = {
        "mode": "cli",
        "engine": "canwxsim-cli",
        "source_classification": "experimental",
        "run_id": run_id,
        "note": "CanWxSim sandbox output — EXPERIMENTAL, not operational NWP.",
    }

    fields: dict[str, dict[str, Any]] = {}
    field_specs = {
        "temperature": (list_field("temperature"), "degC", lambda kelvin: kelvin - 273.15),
        "precipitation": (list_field("precipitation"), "model_water", lambda value: value),
        "cloud_water": (list_field("cloud_water"), "model_water", lambda value: value),
        "wind_speed": (wind_speed, "m/s", lambda value: value),
    }
    for field_name, (values, units, transform) in field_specs.items():
        if not values:
            continue
        fields[field_name] = {
            "field_name": field_name,
            "status": "experimental",
            "units": units,
            "generated_at": generated_at,
            "grid": base_grid,
            "values": _reshape_field(values, width, height, transform),
            "provenance": provenance,
        }
    return fields

def _invoke_cli_run(
    config: SimulationConfig, run_id: str, now: datetime, cli_path: str
) -> SimulationRun:
    """Invoke canwxsim-cli synchronously.

    Best-effort: any failure (non-zero exit, timeout, exception) yields a
    `failed` run with diagnostic context — never raises HTTP 500.
    """
    args = [
        cli_path,
        "run-sample",
        "--duration-hours",
        str(config.duration_hours),
        "--timestep-seconds",
        str(config.timestep_seconds),
        "--width",
        "64",
        "--height",
        "64",
    ]
    try:
        proc = subprocess.run(  # noqa: S603
            args,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("canwxsim-cli invocation failed: %s", exc)
        return SimulationRun(
            run_id=run_id,
            status=RunStatus.failed,
            config=config,
            created_at=now,
            updated_at=datetime.now(UTC),
            fields_url=None,
            provenance={
                "mode": "cli",
                "engine": "canwxsim-cli",
                "cli_path": cli_path,
                "error": str(exc),
                "source_classification": "experimental",
                "note": "CLI invocation failed — EXPERIMENTAL.",
            },
        )

    status = RunStatus.completed if proc.returncode == 0 else RunStatus.failed
    diagnostics: SimulationDiagnostics | None = None
    if status == RunStatus.completed:
        try:
            payload = json.loads(proc.stdout or "{}")
            raw_diag = payload.get("diagnostics") or {}
            diagnostics = SimulationDiagnostics(**raw_diag)
            _RUN_FIELDS[run_id] = _fields_from_cli_payload(payload, run_id)
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            status = RunStatus.failed
            diagnostics = None
            logger.warning("canwxsim-cli returned invalid JSON: %s", exc)

    return SimulationRun(
        run_id=run_id,
        status=status,
        config=config,
        created_at=now,
        updated_at=datetime.now(UTC),
        completed_at=datetime.now(UTC) if status == RunStatus.completed else None,
        diagnostics=diagnostics,
        fields_url=(
            f"/api/simulations/runs/{run_id}/fields/temperature"
            if status == RunStatus.completed
            else None
        ),
        provenance={
            "mode": "cli",
            "engine": "canwxsim-cli",
            "cli_path": cli_path,
            "returncode": proc.returncode,
            "source_classification": "experimental",
            "stdout_tail": (proc.stdout or "")[-512:],
            "stderr_tail": (proc.stderr or "")[-512:],
            "note": "Invoked canwxsim-cli — EXPERIMENTAL, not operational NWP.",
        },
    )


@router.post("/runs", response_model=SimulationRun, status_code=201)
async def create_simulation_run(config: SimulationConfig) -> SimulationRun:
    """Create a simulation run.

    Mode is selected via CANWXLAB_SIMULATION_MODE: "stub" (default, deterministic
    in-process) or "cli" (subprocess invocation of canwxsim-cli). When the CLI
    binary is unavailable in cli mode, the run is recorded as `failed` rather
    than raising an exception.
    """
    now = datetime.now(UTC)
    run_id = f"sim-{uuid4().hex[:12]}"
    mode = (os.environ.get("CANWXLAB_SIMULATION_MODE") or "stub").lower()

    if mode == "cli":
        cli_path = _resolve_cli_binary()
        if cli_path is None:
            run = SimulationRun(
                run_id=run_id,
                status=RunStatus.failed,
                config=config,
                created_at=now,
                updated_at=now,
                fields_url=None,
                provenance={
                    "mode": "cli",
                    "engine": "canwxsim-cli",
                    "error": "canwxsim-cli binary not found on PATH or in target/{debug,release}",
                    "source_classification": "experimental",
                    "note": "Build the Rust workspace or install the binary to enable cli mode.",
                },
            )
        else:
            run = _invoke_cli_run(config, run_id, now, cli_path)
    else:
        run = _build_stub_run(config, run_id, now)

    _RUNS[run_id] = run
    return run


@router.get("/runs", response_model=list[SimulationRun])
async def list_simulation_runs() -> list[SimulationRun]:
    return list(_RUNS.values())


@router.get("/runs/{run_id}", response_model=SimulationRun)
async def get_simulation_run(run_id: str) -> SimulationRun:
    run = _RUNS.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"Unknown simulation run: {run_id}")
    return run


@router.get("/runs/{run_id}/fields/{field_name}")
async def get_simulation_field(run_id: str, field_name: str) -> dict:
    if run_id not in _RUNS:
        raise HTTPException(status_code=404, detail=f"Unknown simulation run: {run_id}")
    allowed = {"temperature", "precipitation", "wind_speed", "cloud_water"}
    if field_name not in allowed:
        raise HTTPException(status_code=404, detail=f"Unknown field: {field_name}")

    run_fields = _RUN_FIELDS.get(run_id) or {}
    if field_name in run_fields:
        return run_fields[field_name]

    field = generate_grid_field(field_name=field_name)
    field["status"] = "mock_experimental"
    field["provenance"] = {
        "mode": "stub",
        "engine": "canwxsim_sample_stub",
        "source_classification": "mock_experimental",
        "run_id": run_id,
        "note": "Deterministic sample field — EXPERIMENTAL, not operational NWP.",
    }
    return field
