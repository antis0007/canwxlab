"""Tests for neural-frame-interpolation scheduling and recursion.

The neural model needs a GPU and is not exercised here; instead a trivial
linear-average interpolator stands in for the model so the recursion structure
is verified exactly. If recursive midpoint synthesis is correct for linear
averaging, it is structurally correct for any midpoint model.
"""

from __future__ import annotations

import numpy as np

from canwxlab_api.frame_interp import (
    Interpolator,
    frac_to_time_ms,
    midpoint_fractions,
    pair_cache_key,
    png_to_rgb,
    rgb_to_png,
    synthesize_sequence,
)


class LinearAverage:
    """Stand-in interpolator: the midpoint is the pixel-wise average."""

    def midpoint(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        return ((a.astype(np.float32) + b.astype(np.float32)) / 2.0).astype(np.uint8)


def test_midpoint_fractions_excludes_endpoints_and_is_dense() -> None:
    assert midpoint_fractions(0) == []
    assert midpoint_fractions(1) == [0.5]
    assert midpoint_fractions(2) == [0.25, 0.5, 0.75]
    assert len(midpoint_fractions(4)) == 15  # 2**4 - 1


def test_frac_to_time_maps_linearly() -> None:
    assert frac_to_time_ms(1000, 2000, 0.0) == 1000
    assert frac_to_time_ms(1000, 2000, 0.5) == 1500
    assert frac_to_time_ms(1000, 2000, 1.0) == 2000


def test_cache_key_is_stable_and_sensitive() -> None:
    a = pair_cache_key("ir", "0,0,1,1", 256, "t0", "t1", 4)
    assert a == pair_cache_key("ir", "0,0,1,1", 256, "t0", "t1", 4)
    assert a != pair_cache_key("ir", "0,0,1,1", 256, "t0", "t1", 5)


def test_synthesize_sequence_count_and_fractions() -> None:
    a = np.zeros((4, 4, 3), dtype=np.uint8)
    b = np.full((4, 4, 3), 200, dtype=np.uint8)
    seq = synthesize_sequence(a, b, depth=3, interp=LinearAverage())
    assert len(seq) == 7  # 2**3 - 1
    assert sorted(seq.keys()) == midpoint_fractions(3)


def test_recursion_matches_exact_linear_interpolation() -> None:
    # With linear averaging, the recursive midpoint at frac f must equal the
    # straight linear blend a*(1-f) + b*f. This pins the recursion structure.
    a = np.zeros((2, 2, 3), dtype=np.uint8)
    b = np.full((2, 2, 3), 240, dtype=np.uint8)
    seq = synthesize_sequence(a, b, depth=3, interp=LinearAverage())
    for frac, frame in seq.items():
        expected = round(240 * frac)
        # Allow ±1 for uint8 rounding through the recursion.
        assert abs(int(frame[0, 0, 0]) - expected) <= 1, frac


def test_png_roundtrip_preserves_pixels() -> None:
    frame = (np.arange(4 * 4 * 3, dtype=np.uint8).reshape(4, 4, 3))
    restored = png_to_rgb(rgb_to_png(frame))
    assert np.array_equal(restored, frame)


def test_linear_average_satisfies_protocol() -> None:
    interp: Interpolator = LinearAverage()
    out = interp.midpoint(
        np.zeros((2, 2, 3), np.uint8), np.full((2, 2, 3), 100, np.uint8)
    )
    assert int(out[0, 0, 0]) == 50
