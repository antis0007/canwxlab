import math
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter

from canwxlab_api.models import VerificationMetric

router = APIRouter(prefix="/api/verification", tags=["verification"])


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
