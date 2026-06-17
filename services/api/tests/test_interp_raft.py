"""RAFT neural-flow interpolator. Skipped when torch/torchvision are absent."""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image, ImageFilter

pytest.importorskip("torch")
pytest.importorskip("torchvision")

from canwxlab_api.interp_raft import RaftInterpolator  # noqa: E402

MARGIN = 14


def _texture(size: int, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = rng.integers(0, 256, (size, size), dtype=np.uint8)
    smooth = np.asarray(Image.fromarray(n).filter(ImageFilter.GaussianBlur(2)), dtype=np.uint8)
    return np.repeat(smooth[..., None], 3, axis=2)


def _interior(img: np.ndarray) -> np.ndarray:
    return img[MARGIN:-MARGIN, MARGIN:-MARGIN].astype(np.float32)


# One shared model load (RAFT init is the slow part).
_INTERP = RaftInterpolator()


def test_raft_midpoint_moves_content_halfway() -> None:
    size, shift = 128, 8
    a = _texture(size)
    b = np.roll(a, shift, axis=1)
    mid = _INTERP.midpoint(a, b)

    ref_half = np.roll(a, shift // 2, axis=1).astype(np.float32)
    crossfade = 0.5 * a.astype(np.float32) + 0.5 * b.astype(np.float32)
    err_half = np.abs(_interior(mid) - _interior(ref_half)).mean()
    err_source = np.abs(_interior(mid) - _interior(a)).mean()
    err_crossfade = np.abs(_interior(mid) - _interior(crossfade)).mean()

    # Neural flow places content at the true intermediate position, far better
    # than the source (no motion) or a cross-fade (no motion + lost contrast).
    assert err_half < err_source
    assert err_half < err_crossfade
    assert err_half < 3.0


def test_raft_static_scene_preserved() -> None:
    tex = _texture(96, seed=2)
    mid = _INTERP.midpoint(tex, tex)
    assert np.abs(_interior(mid) - _interior(tex)).mean() < 6


def test_raft_output_shape_dtype() -> None:
    tex = _texture(72, seed=3)
    mid = _INTERP.midpoint(tex, np.roll(tex, 5, axis=1))
    assert mid.shape == tex.shape and mid.dtype == np.uint8
