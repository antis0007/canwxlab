"""Tests for the CelesTrak TLE adapter — parsing and caching, no network."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from canwxlab_api.adapters.cosmic_celestrak import ALLOWED_GROUPS, CelestrakTleAdapter

# Real ISS + CSS three-line records (epochs arbitrary; parse only).
SAMPLE_TLE = """ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9005
2 25544  51.6400 208.0000 0006703 130.0000 325.0000 15.50000000123456
CSS (TIANHE)
1 48274U 21035A   24001.50000000  .00021412  00000-0  23423-3 0  9990
2 48274  41.4700 100.0000 0004500 200.0000 160.0000 15.61000000 12345
"""


def test_parse_extracts_three_line_records() -> None:
    result = CelestrakTleAdapter._parse("stations", SAMPLE_TLE)
    assert result["count"] == 2
    assert result["source_status"] == "live"
    iss = result["satellites"][0]
    assert iss["name"] == "ISS (ZARYA)"
    assert iss["norad_id"] == "25544"
    assert iss["line1"].startswith("1 25544U")
    assert iss["line2"].startswith("2 25544")


def test_parse_skips_malformed_records() -> None:
    bad = "JUNK NAME\nnot a tle line\nanother bad line\n"
    result = CelestrakTleAdapter._parse("weather", bad)
    assert result["count"] == 0
    assert result["satellites"] == []


def test_unknown_group_is_degraded(tmp_path: Path) -> None:
    adapter = CelestrakTleAdapter(cache_root=tmp_path)
    result = asyncio.run(adapter.fetch_group("not-a-real-group"))
    assert result["source_status"] == "down"
    assert result["count"] == 0
    assert "allow-list" in result["error"]


def test_serves_fresh_disk_cache_without_network(tmp_path: Path) -> None:
    adapter = CelestrakTleAdapter(cache_root=tmp_path)
    fresh = CelestrakTleAdapter._parse("stations", SAMPLE_TLE)
    cache_dir = tmp_path / "cosmic" / "celestrak"
    cache_dir.mkdir(parents=True)
    (cache_dir / "stations.json").write_text(json.dumps(fresh), encoding="utf-8")

    # No upstream patch needed: a fresh disk hit must short-circuit the fetch.
    result = asyncio.run(adapter.fetch_group("stations"))
    assert result["count"] == 2
    assert result["satellites"][0]["norad_id"] == "25544"


def test_allowed_groups_nonempty() -> None:
    assert "stations" in ALLOWED_GROUPS
    assert "weather" in ALLOWED_GROUPS
