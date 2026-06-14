"""CelesTrak TLE adapter.

Fetches satellite Two-Line Element sets from CelesTrak's GP API and hands the
frontend raw TLE lines plus a parsed header. SGP4 propagation lives in the
browser (satellite.js) — this adapter only sources and caches the elements.

CelesTrak asks clients not to poll a group faster than every couple of hours
and prefers daily refresh for most groups (TLE epochs change slowly). We honour
that with a disk cache keyed by ``(group, UTC date)`` plus a short in-process
memo so a burst of clients shares one upstream fetch.

API ref: https://celestrak.org/NORAD/documentation/gp-data-formats.php
    GET https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle

Public surface:
    CelestrakTleAdapter.fetch_group(group) -> dict  (JSON-ready TLE set)
"""

from __future__ import annotations

import json
import logging
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CELESTRAK_GP_URL = "https://celestrak.org/NORAD/elements/gp.php"

# Allow-listed groups: small, broadly useful constellations. Keeping the list
# explicit (not arbitrary passthrough) bounds upstream load and response size.
ALLOWED_GROUPS: dict[str, str] = {
    "stations": "Crewed/uncrewed space stations (ISS, CSS, …)",
    "weather": "Weather satellites (NOAA, Meteor, …)",
    "noaa": "NOAA series",
    "goes": "GOES geostationary weather satellites",
    "science": "Science missions",
    "gps-ops": "GPS operational constellation",
    "galileo": "Galileo constellation",
    "starlink": "Starlink (large — decimate client-side)",
    "active": "All active satellites (very large)",
}

# Disk cache freshness: TLE epochs drift slowly; one refresh per UTC day is the
# cadence CelesTrak recommends. The in-process memo guards bursts within a run.
DISK_TTL_SECONDS = 12 * 3600
MEMO_TTL_SECONDS = 600


class CelestrakTleAdapter:
    """Sources TLE sets from CelesTrak with disk + in-process caching."""

    def __init__(self, cache_root: Path, timeout_s: float = 15.0) -> None:
        self._dir = Path(cache_root) / "cosmic" / "celestrak"
        self._timeout = timeout_s
        self._memo: dict[str, dict[str, Any]] = {}
        self._memo_ts: dict[str, float] = {}

    async def fetch_group(self, group: str) -> dict[str, Any]:
        """Return a JSON-ready TLE set for ``group``.

        Shape: ``{group, fetched_at, source_status, count, satellites:
        [{name, line1, line2, norad_id}], attribution}``. On upstream failure
        returns the most recent cached set if any, else an empty degraded set.
        """
        key = group.lower().strip()
        if key not in ALLOWED_GROUPS:
            return self._degraded(key, f"group '{group}' not in allow-list")

        now = time.monotonic()
        memo = self._memo.get(key)
        if memo is not None and (now - self._memo_ts.get(key, 0.0)) < MEMO_TTL_SECONDS:
            return memo

        cached = self._read_disk(key)
        if cached is not None and self._fresh(cached):
            self._memo[key], self._memo_ts[key] = cached, now
            return cached

        try:
            text = await self._fetch_upstream(key)
            result = self._parse(key, text)
            self._write_disk(key, result)
        except Exception as exc:  # network, HTTP, parse — degrade, don't crash
            logger.warning("CelesTrak fetch failed for %s: %s", key, exc)
            if cached is not None:  # serve stale on failure (honest about it)
                cached["source_status"] = "degraded"
                cached["error"] = str(exc)
                result = cached
            else:
                result = self._degraded(key, str(exc))

        self._memo[key], self._memo_ts[key] = result, now
        return result

    async def _fetch_upstream(self, group: str) -> str:
        params = {"GROUP": group, "FORMAT": "tle"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            response = await client.get(CELESTRAK_GP_URL, params=params)
            response.raise_for_status()
            body = response.text
        # CelesTrak returns a plain "No GP data found" body (HTTP 200) for an
        # unknown/empty group; treat that as a failure so we don't cache junk.
        if "No GP data found" in body or len(body.strip()) < 10:
            raise ValueError("upstream returned no GP data")
        return body

    @staticmethod
    def _parse(group: str, text: str) -> dict[str, Any]:
        lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
        satellites: list[dict[str, Any]] = []
        # TLE format is repeating 3-line records: name, "1 …", "2 …".
        for i in range(0, len(lines) - 2, 3):
            name, l1, l2 = lines[i], lines[i + 1], lines[i + 2]
            if not (l1.startswith("1 ") and l2.startswith("2 ")):
                continue
            satellites.append(
                {
                    "name": name.strip(),
                    "line1": l1,
                    "line2": l2,
                    "norad_id": l1[2:7].strip(),
                }
            )
        return {
            "group": group,
            "fetched_at": datetime.now(UTC).isoformat(),
            "source_status": "live",
            "count": len(satellites),
            "satellites": satellites,
            "attribution": "CelesTrak (celestrak.org), Dr. T.S. Kelso",
            "license_url": "https://celestrak.org/publications/AIAA/2006-6753/",
        }

    @staticmethod
    def _fresh(cached: dict[str, Any]) -> bool:
        ts = cached.get("fetched_at")
        if not ts:
            return False
        try:
            age = (datetime.now(UTC) - datetime.fromisoformat(ts)).total_seconds()
        except ValueError:
            return False
        return age < DISK_TTL_SECONDS

    def _disk_path(self, group: str) -> Path:
        return self._dir / f"{group}.json"

    def _read_disk(self, group: str) -> dict[str, Any] | None:
        path = self._disk_path(group)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_disk(self, group: str, result: dict[str, Any]) -> None:
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            self._disk_path(group).write_text(
                json.dumps(result), encoding="utf-8"
            )
        except OSError as exc:
            logger.warning("CelesTrak cache write failed for %s: %s", group, exc)

    @staticmethod
    def _degraded(group: str, error: str) -> dict[str, Any]:
        return {
            "group": group,
            "fetched_at": datetime.now(UTC).isoformat(),
            "source_status": "down",
            "count": 0,
            "satellites": [],
            "error": error,
            "attribution": "CelesTrak (celestrak.org), Dr. T.S. Kelso",
        }
