"""Unit tests for the server-side dense optical flow module."""

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from canwxlab_api.motion_flow import (
    FLOW_ENCODE_SCALE,
    compute_flow,
    densify_flow,
    encode_flow_rgba,
    parse_time_extent,
    snap_to_grid,
)


def gaussian_blob_field(size: int, cx: float, cy: float, sigma: float = 6.0) -> np.ndarray:
    yy, xx = np.meshgrid(np.arange(size), np.arange(size), indexing="ij")
    blob = np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * sigma**2))
    # Two blobs so the field has structure away from one point.
    blob2 = np.exp(-((xx - cx - 30) ** 2 + (yy - cy + 20) ** 2) / (2 * sigma**2))
    return (blob + blob2).astype(np.float32)


def test_recovers_known_translation() -> None:
    size = 128
    shift_x, shift_y = 5.0, -3.0
    prev = gaussian_blob_field(size, 50, 70)
    nxt = gaussian_blob_field(size, 50 + shift_x, 70 + shift_y)

    u, v, conf = compute_flow(prev, nxt)

    # Evaluate where the signal lives (confidence-weighted mean).
    weight = conf * (prev > 0.05)
    assert weight.sum() > 0
    mean_u = float((u * weight).sum() / weight.sum())
    mean_v = float((v * weight).sum() / weight.sum())
    assert mean_u == pytest.approx(shift_x, abs=1.0)
    assert mean_v == pytest.approx(shift_y, abs=1.0)


def test_zero_motion_yields_near_zero_flow() -> None:
    prev = gaussian_blob_field(128, 60, 60)
    u, v, conf = compute_flow(prev, prev.copy())
    weight = conf * (prev > 0.05)
    assert float(np.abs(u * weight).sum() / max(weight.sum(), 1e-6)) < 0.3
    assert float(np.abs(v * weight).sum() / max(weight.sum(), 1e-6)) < 0.3


def test_flat_field_has_zero_confidence() -> None:
    flat = np.full((64, 64), 0.5, dtype=np.float32)
    _u, _v, conf = compute_flow(flat, flat)
    # Densify must NOT coax a featureless field into motion: no confident flow
    # anywhere → confidence stays zero, so the morph leaves it static.
    assert float(conf.max()) == pytest.approx(0.0, abs=1e-3)


def test_densify_fills_low_confidence_regions_smoothly() -> None:
    size = 48
    u = np.zeros((size, size), dtype=np.float32)
    v = np.zeros((size, size), dtype=np.float32)
    conf = np.zeros((size, size), dtype=np.float32)
    # A confident motion patch in the center; everything else unknown.
    u[20:28, 20:28] = 4.0
    conf[20:28, 20:28] = 0.9

    du, dv, dconf = densify_flow(u, v, conf)

    # Center kept (measured motion not smeared away).
    assert du[24, 24] == pytest.approx(4.0, abs=0.6)
    assert dconf[24, 24] == pytest.approx(0.9, abs=0.1)
    # Nearby-but-unknown region inherits motion and clears the static gate.
    assert du[16, 24] > 0.3
    assert dconf[16, 24] >= 0.06
    # Far featureless corner is not coaxed into motion.
    assert dconf[0, 0] == pytest.approx(0.0, abs=1e-3)
    assert np.all(np.isfinite(du)) and np.all(np.isfinite(dv))


def test_encode_flow_rgba_roundtrip() -> None:
    size = 32
    u = np.full((size, size), 2.0, dtype=np.float32)  # 2 px east
    v = np.full((size, size), -1.0, dtype=np.float32)
    conf = np.full((size, size), 0.8, dtype=np.float32)

    raw = encode_flow_rgba(u, v, conf)
    rgba = np.frombuffer(raw, dtype=np.uint8).reshape(size, size, 4)

    decoded_u_uv = (rgba[0, 0, 0] / 255.0 - 0.5) * (2 * FLOW_ENCODE_SCALE)
    decoded_v_uv = (rgba[0, 0, 1] / 255.0 - 0.5) * (2 * FLOW_ENCODE_SCALE)
    assert decoded_u_uv == pytest.approx(2.0 / size, abs=1.5 / 255)
    assert decoded_v_uv == pytest.approx(-1.0 / size, abs=1.5 / 255)
    assert rgba[0, 0, 2] == pytest.approx(204, abs=1)
    # Alpha = occlusion = inverse confidence in the client shader.
    assert rgba[0, 0, 3] == pytest.approx(51, abs=1)


def test_parse_time_extent_interval() -> None:
    parsed = parse_time_extent("2026-06-10T20:20:00Z/2026-06-13T02:20:00Z/PT10M")
    assert parsed is not None
    start, end, step = parsed
    assert start == datetime(2026, 6, 10, 20, 20, tzinfo=UTC)
    assert end == datetime(2026, 6, 13, 2, 20, tzinfo=UTC)
    assert step == timedelta(minutes=10)


def test_parse_time_extent_rejects_comma_list() -> None:
    assert parse_time_extent("2026-06-10T20:20:00Z,2026-06-10T20:30:00Z") is None


def test_snap_to_grid_rounds_to_nearest_and_clamps() -> None:
    start = datetime(2026, 6, 13, 1, 0, tzinfo=UTC)
    end = datetime(2026, 6, 13, 2, 20, tzinfo=UTC)
    step = timedelta(minutes=10)

    # Off-grid :18:30 → nearest grid time :20:00.
    target = datetime(2026, 6, 13, 1, 18, 30, tzinfo=UTC)
    assert snap_to_grid(target, start, end, step) == datetime(2026, 6, 13, 1, 20, tzinfo=UTC)

    # Past the end clamps to the last grid time.
    future = datetime(2026, 6, 13, 2, 48, 30, tzinfo=UTC)
    assert snap_to_grid(future, start, end, step) == datetime(2026, 6, 13, 2, 20, tzinfo=UTC)

    # Before the start clamps to start.
    past = datetime(2026, 6, 13, 0, 30, tzinfo=UTC)
    assert snap_to_grid(past, start, end, step) == start
