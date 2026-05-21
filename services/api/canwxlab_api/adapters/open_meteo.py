"""Open-Meteo free weather forecast adapter.

Provides point-based current conditions and hourly forecasts from the Open-Meteo
NWP ensemble (no API key required, 10 km resolution, updated hourly).

Endpoint: https://api.open-meteo.com/v1/forecast
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from canwxlab_api.http_cache import JsonFileCacheClient

logger = logging.getLogger(__name__)

OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"

CURRENT_VARIABLES = (
    "temperature_2m,relative_humidity_2m,apparent_temperature,"
    "precipitation,weather_code,wind_speed_10m,wind_direction_10m,"
    "wind_gusts_10m,surface_pressure,dew_point_2m"
)
HOURLY_VARIABLES = (
    "temperature_2m,relative_humidity_2m,apparent_temperature,"
    "precipitation_probability,precipitation,weather_code,cloud_cover,"
    "wind_speed_10m,wind_direction_10m,wind_gusts_10m,"
    "surface_pressure,dew_point_2m,uv_index"
)

# kPa conversion: Open-Meteo gives hPa
_HPA_TO_KPA = 0.1

# Current conditions TTL: 10 min; hourly forecast TTL: 30 min
_CURRENT_TTL_S = 600
_HOURLY_TTL_S = 1800


class OpenMeteoAdapter:
    def __init__(
        self,
        cache_dir: str | Path = ".cache/open_meteo",
        timeout_seconds: float = 15.0,
        user_agent: str | None = None,
    ) -> None:
        self._client = JsonFileCacheClient(
            cache_dir=Path(cache_dir),
            timeout_seconds=timeout_seconds,
            user_agent=user_agent,
        )

    async def fetch_current(self, lat: float, lon: float) -> dict[str, Any] | None:
        """Return current weather at (lat, lon) or None on failure."""
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "current": CURRENT_VARIABLES,
            "wind_speed_unit": "kmh",
            "precipitation_unit": "mm",
            "timezone": "UTC",
        }
        try:
            result = await self._client.fetch_json(
                OPEN_METEO_BASE, params=params, ttl_seconds=_CURRENT_TTL_S
            )
            raw = result.payload
            cur = raw.get("current", {})
            return {
                "temperature_c": _f(cur, "temperature_2m"),
                "apparent_temperature_c": _f(cur, "apparent_temperature"),
                "dewpoint_c": _f(cur, "dew_point_2m"),
                "relative_humidity_pct": _f(cur, "relative_humidity_2m"),
                "wind_speed_kmh": _f(cur, "wind_speed_10m"),
                "wind_direction_deg": _f(cur, "wind_direction_10m"),
                "wind_gusts_kmh": _f(cur, "wind_gusts_10m"),
                "surface_pressure_kpa": _kpa(cur, "surface_pressure"),
                "precipitation_mm": _f(cur, "precipitation"),
                "weather_code": _i(cur, "weather_code"),
                "source": "open_meteo",
                "retrieved_at": result.retrieved_at.isoformat(),
            }
        except Exception:
            logger.exception("open_meteo current fetch failed lat=%s lon=%s", lat, lon)
            return None

    async def fetch_hourly(
        self, lat: float, lon: float, hours: int = 48
    ) -> list[dict[str, Any]]:
        """Return hourly forecast slots for the next `hours` hours."""
        forecast_days = min(16, max(1, (hours + 23) // 24 + 1))
        params = {
            "latitude": round(lat, 4),
            "longitude": round(lon, 4),
            "hourly": HOURLY_VARIABLES,
            "wind_speed_unit": "kmh",
            "precipitation_unit": "mm",
            "timezone": "UTC",
            "forecast_days": forecast_days,
            "past_hours": 6,
        }
        try:
            result = await self._client.fetch_json(
                OPEN_METEO_BASE, params=params, ttl_seconds=_HOURLY_TTL_S
            )
            raw = result.payload
            hourly = raw.get("hourly", {})
            times: list[str] = hourly.get("time", [])
            now_iso = datetime.now(UTC).strftime("%Y-%m-%dT%H:00")

            slots: list[dict[str, Any]] = []
            for i, t in enumerate(times):
                # Include past_hours slots and up to `hours` future slots.
                is_past = t < now_iso
                slot: dict[str, Any] = {
                    "time": f"{t}:00Z",
                    "temperature_c": _idx(hourly, "temperature_2m", i),
                    "apparent_temperature_c": _idx(hourly, "apparent_temperature", i),
                    "dewpoint_c": _idx(hourly, "dew_point_2m", i),
                    "relative_humidity_pct": _idx(hourly, "relative_humidity_2m", i),
                    "wind_speed_kmh": _idx(hourly, "wind_speed_10m", i),
                    "wind_direction_deg": _idx(hourly, "wind_direction_10m", i),
                    "wind_gusts_kmh": _idx(hourly, "wind_gusts_10m", i),
                    "precipitation_probability_pct": _idx(hourly, "precipitation_probability", i),
                    "precipitation_mm": _idx(hourly, "precipitation", i),
                    "weather_code": _idx_i(hourly, "weather_code", i),
                    "cloud_cover_pct": _idx(hourly, "cloud_cover", i),
                    "surface_pressure_kpa": _kpa_idx(hourly, "surface_pressure", i),
                    "uv_index": _idx(hourly, "uv_index", i),
                    "source": "observed" if is_past else "forecast",
                }
                slots.append(slot)
                if not is_past and len([s for s in slots if s["source"] == "forecast"]) >= hours:
                    break
            return slots
        except Exception:
            logger.exception("open_meteo hourly fetch failed lat=%s lon=%s", lat, lon)
            return []


# ── helpers ──────────────────────────────────────────────────────────────────

def _f(obj: dict, key: str) -> float | None:
    v = obj.get(key)
    return float(v) if v is not None else None


def _i(obj: dict, key: str) -> int | None:
    v = obj.get(key)
    return int(v) if v is not None else None


def _kpa(obj: dict, key: str) -> float | None:
    v = _f(obj, key)
    return round(v * _HPA_TO_KPA, 2) if v is not None else None


def _idx(obj: dict, key: str, i: int) -> float | None:
    arr = obj.get(key)
    if not arr or i >= len(arr):
        return None
    v = arr[i]
    return float(v) if v is not None else None


def _idx_i(obj: dict, key: str, i: int) -> int | None:
    arr = obj.get(key)
    if not arr or i >= len(arr):
        return None
    v = arr[i]
    return int(v) if v is not None else None


def _kpa_idx(obj: dict, key: str, i: int) -> float | None:
    v = _idx(obj, key, i)
    return round(v * _HPA_TO_KPA, 2) if v is not None else None
