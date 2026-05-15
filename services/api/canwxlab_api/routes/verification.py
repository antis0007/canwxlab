import math
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from canwxlab_api.models import VerificationMetric

router = APIRouter(prefix="/api/verification", tags=["verification"])


# --- Verification cases (in-memory, deterministic synthetic data) ---

DiffMode = Literal["A_MINUS_B", "ABSOLUTE_ERROR", "PERCENT_ERROR", "THRESHOLD_EXCEEDANCE"]


class VerificationTarget(BaseModel):
    label: str
    source_id: str
    model_name: str | None = None


class VerificationField(BaseModel):
    name: str  # e.g. "temperature_2m"
    unit: str


class ErrorMetric(BaseModel):
    mae: float
    rmse: float
    bias: float
    max_abs_error: float
    sample_count: int


class SpatialDiffSummary(BaseModel):
    field: str
    diff_mode: DiffMode
    rows: int
    cols: int
    bbox: list[float]  # [minLon, minLat, maxLon, maxLat]
    is_generated_mock: bool
    grid: list[list[float]]  # row-major, deterministic mock


class VerificationCase(BaseModel):
    case_id: str
    name: str
    created_at: datetime
    a: VerificationTarget
    b: VerificationTarget
    fields: list[VerificationField]
    bbox: list[float]
    grid_rows: int = 24
    grid_cols: int = 32
    is_generated_mock: bool = True
    notes: str = "Deterministic synthetic case — MOCK/GENERATED."


class CreateCaseRequest(BaseModel):
    name: str
    a: VerificationTarget
    b: VerificationTarget
    fields: list[VerificationField] = Field(default_factory=list)
    bbox: list[float] = Field(default_factory=lambda: [-141.0, 42.0, -52.0, 70.0])


_CASES: dict[str, VerificationCase] = {}


def _seed_default_cases() -> None:
    if _CASES:
        return
    case = VerificationCase(
        case_id="default-mock-case",
        name="Default Mock Case — GDPS vs Observations (MOCK)",
        created_at=datetime.now(UTC),
        a=VerificationTarget(
            label="GDPS (mock)",
            source_id="mock_canwxlab",
            model_name="gdps_mock",
        ),
        b=VerificationTarget(
            label="Observations (mock)",
            source_id="mock_canwxlab",
        ),
        fields=[VerificationField(name="temperature_2m", unit="degC")],
        bbox=[-141.0, 42.0, -52.0, 70.0],
    )
    _CASES[case.case_id] = case


def _generate_grid(case: VerificationCase, field: str, diff_mode: DiffMode) -> list[list[float]]:
    rows, cols = case.grid_rows, case.grid_cols
    grid: list[list[float]] = []
    seed_offset = sum(ord(c) for c in (case.case_id + field + diff_mode))
    for r in range(rows):
        row: list[float] = []
        for c in range(cols):
            base = math.sin((r + seed_offset) / 4.7) * math.cos((c + seed_offset) / 6.3)
            if diff_mode == "A_MINUS_B":
                v = base * 5.0
            elif diff_mode == "ABSOLUTE_ERROR":
                v = abs(base) * 5.0
            elif diff_mode == "PERCENT_ERROR":
                v = base * 25.0
            else:  # THRESHOLD_EXCEEDANCE
                v = 1.0 if base > 0.4 else 0.0
            row.append(round(v, 4))
        grid.append(row)
    return grid


def _metrics_from_grid(grid: list[list[float]]) -> ErrorMetric:
    flat = [v for row in grid for v in row]
    n = len(flat) or 1
    mae = sum(abs(v) for v in flat) / n
    rmse = math.sqrt(sum(v * v for v in flat) / n)
    bias = sum(flat) / n
    max_abs = max((abs(v) for v in flat), default=0.0)
    return ErrorMetric(
        mae=round(mae, 4),
        rmse=round(rmse, 4),
        bias=round(bias, 4),
        max_abs_error=round(max_abs, 4),
        sample_count=n,
    )


@router.get("/cases", response_model=list[VerificationCase])
async def list_cases() -> list[VerificationCase]:
    _seed_default_cases()
    return list(_CASES.values())


@router.post("/cases", response_model=VerificationCase)
async def create_case(req: CreateCaseRequest) -> VerificationCase:
    case = VerificationCase(
        case_id=str(uuid.uuid4()),
        name=req.name,
        created_at=datetime.now(UTC),
        a=req.a,
        b=req.b,
        fields=req.fields or [VerificationField(name="temperature_2m", unit="degC")],
        bbox=req.bbox,
    )
    _CASES[case.case_id] = case
    return case


@router.get("/cases/{case_id}", response_model=VerificationCase)
async def get_case(case_id: str) -> VerificationCase:
    _seed_default_cases()
    case = _CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    return case


@router.get("/cases/{case_id}/summary", response_model=list[ErrorMetric])
async def get_case_summary(case_id: str) -> list[ErrorMetric]:
    _seed_default_cases()
    case = _CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    return [
        _metrics_from_grid(_generate_grid(case, f.name, "A_MINUS_B"))
        for f in case.fields
    ]


@router.get("/cases/{case_id}/diff/{field_name}", response_model=SpatialDiffSummary)
async def get_case_diff(
    case_id: str,
    field_name: str,
    diff_mode: DiffMode = "ABSOLUTE_ERROR",
) -> SpatialDiffSummary:
    _seed_default_cases()
    case = _CASES.get(case_id)
    if not case:
        raise HTTPException(status_code=404, detail="case not found")
    if not any(f.name == field_name for f in case.fields):
        raise HTTPException(status_code=404, detail=f"field {field_name} not in case")
    grid = _generate_grid(case, field_name, diff_mode)
    return SpatialDiffSummary(
        field=field_name,
        diff_mode=diff_mode,
        rows=case.grid_rows,
        cols=case.grid_cols,
        bbox=case.bbox,
        is_generated_mock=True,
        grid=grid,
    )


def _metrics(
    model_name: str, source_id: str, model_values: list[float], observed: list[float]
) -> VerificationMetric:
    errors = [m - o for m, o in zip(model_values, observed, strict=True)]
    mae = sum(abs(e) for e in errors) / len(errors)
    rmse = math.sqrt(sum(e * e for e in errors) / len(errors))
    bias = sum(errors) / len(errors)
    now = datetime.now(UTC)
    return VerificationMetric(
        metric_id=f"mock-{model_name}-temperature-2m",
        source_id=source_id,
        model_name=model_name,
        variable="temperature_2m",
        region="canada_demo",
        lead_time_hours=6,
        mae=round(mae, 3),
        rmse=round(rmse, 3),
        bias=round(bias, 3),
        sample_count=len(errors),
        valid_start=now - timedelta(hours=6),
        valid_end=now,
    )


@router.get("/summary", response_model=list[VerificationMetric])
async def verification_summary() -> list[VerificationMetric]:
    observed = [12.0, 15.5, 8.4, -1.0, 18.0, 9.5]
    official_forecast = [11.2, 16.1, 7.0, -3.2, 20.5, 11.0]
    canwxsim = [12.7, 14.9, 8.0, -0.2, 17.1, 10.4]
    return [
        _metrics("official_forecast_mock", "mock_canwxlab", official_forecast, observed),
        _metrics("canwxsim_mock", "mock_canwxlab", canwxsim, observed),
    ]
