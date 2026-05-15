from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from canwxlab_api.models import (
    RunStatus,
    SimulationConfig,
    SimulationDiagnostics,
    SimulationRun,
)
from canwxlab_api.sample_fields import generate_grid_field

router = APIRouter(prefix="/api/simulations", tags=["simulations"])

_RUNS: dict[str, SimulationRun] = {}


@router.post("/runs", response_model=SimulationRun, status_code=201)
async def create_simulation_run(config: SimulationConfig) -> SimulationRun:
    """Create a deterministic completed sample run.

    The production path will enqueue a worker job that invokes the Rust engine through CLI,
    FFI, or a dedicated simulation worker. The request path must not compile Rust or block on
    expensive simulations.
    """
    now = datetime.now(UTC)
    run_id = f"sim-{uuid4().hex[:12]}"
    run = SimulationRun(
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
            stability_warnings=[]
            if config.timestep_seconds <= 120
            else ["Large timestep for demo grid"],
        ),
        fields_url=f"/api/simulations/runs/{run_id}/fields/temperature",
        provenance={
            "mode": "mock",
            "engine": "canwxsim_sample_stub",
            "note": (
                "API scaffold returns deterministic sample fields. "
                "Rust engine integration is a worker TODO."
            ),
        },
    )
    _RUNS[run_id] = run
    return run


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
