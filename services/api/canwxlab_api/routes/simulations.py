import logging
import os
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
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


def _resolve_cli_binary() -> str | None:
    """Locate canwxsim-cli without compiling at request time.

    Search order: PATH → repo `target/release/canwxsim-cli[.exe]`
                → repo `target/debug/canwxsim-cli[.exe]`.
    """
    on_path = shutil.which("canwxsim-cli")
    if on_path:
        return on_path
    repo_root = Path(__file__).resolve().parents[3]
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
            steps_completed=max(1, int(config.duration_hours * 3600 / config.timestep_seconds)),
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
            "note": "Deterministic sample fields — EXPERIMENTAL.",
        },
    )


def _invoke_cli_run(
    config: SimulationConfig, run_id: str, now: datetime, cli_path: str
) -> SimulationRun:
    """Invoke canwxsim-cli synchronously.

    Best-effort: any failure (non-zero exit, timeout, exception) yields a
    `failed` run with diagnostic context — never raises HTTP 500.
    """
    args = [
        cli_path,
        "--duration-hours",
        str(config.duration_hours),
        "--timestep-seconds",
        str(config.timestep_seconds),
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
                "note": "CLI invocation failed — EXPERIMENTAL.",
            },
        )

    status = RunStatus.completed if proc.returncode == 0 else RunStatus.failed
    return SimulationRun(
        run_id=run_id,
        status=status,
        config=config,
        created_at=now,
        updated_at=datetime.now(UTC),
        completed_at=datetime.now(UTC) if status == RunStatus.completed else None,
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
            "stdout_tail": (proc.stdout or "")[-512:],
            "stderr_tail": (proc.stderr or "")[-512:],
            "note": "Invoked canwxsim-cli — EXPERIMENTAL.",
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
    return generate_grid_field(field_name=field_name)
