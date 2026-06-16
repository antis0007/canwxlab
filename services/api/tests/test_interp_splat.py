"""Forward-splat interpolator.

The splat *mechanism* (forward-warp content by t*flow, no cross-fade) is tested
directly with a known injected flow — independent of optical-flow quality,
which is covered by test_motion_flow. A separate test confirms a static scene
is preserved end-to-end through the real flow path.
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageFilter

from canwxlab_api.interp_splat import ForwardSplatInterpolator, _splat

MARGIN = 12


def _texture(size: int, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = rng.integers(0, 256, (size, size), dtype=np.uint8)
    smooth = np.asarray(Image.fromarray(n).filter(ImageFilter.GaussianBlur(2)), dtype=np.uint8)
    return np.repeat(smooth[..., None], 3, axis=2)


def _interior(img: np.ndarray) -> np.ndarray:
    return img[MARGIN:-MARGIN, MARGIN:-MARGIN].astype(np.float32)


def _warp(frame: np.ndarray, u: float, v: float, t: float) -> np.ndarray:
    """Forward-splat a single frame by t*(u,v) via the production splat."""
    h, w = frame.shape[:2]
    acc_color = np.zeros((h, w, 3), dtype=np.float32)
    acc_w = np.zeros((h, w), dtype=np.float32)
    _splat(frame, np.full((h, w), u, np.float32), np.full((h, w), v, np.float32),
           np.ones((h, w), np.float32), t, acc_color, acc_w)
    covered = acc_w > 1e-6
    out = np.zeros((h, w, 3), np.float32)
    np.divide(acc_color, acc_w[..., None], out=out, where=covered[..., None])
    return out


def test_splat_translates_content_by_t_times_flow() -> None:
    # Known uniform flow of +8 px in x at t=0.5 → content shifts +4 px, and is
    # much closer to the 4-px-shifted reference than to the unshifted source.
    tex = _texture(96)
    warped = _warp(tex, u=8.0, v=0.0, t=0.5)
    ref_shift = np.roll(tex, 4, axis=1).astype(np.float32)

    err_shift = np.abs(_interior(warped) - _interior(ref_shift)).mean()
    err_source = np.abs(_interior(warped) - _interior(tex)).mean()
    assert err_shift < err_source
    assert err_shift < 6.0  # sub-pixel-accurate bilinear splat


def test_splat_is_not_a_crossfade() -> None:
    # Two translated frames: a true splat of each lands content at the shifted
    # position. A cross-fade (0.5a+0.5b) would instead show both, losing
    # contrast. Confirm the warped frame keeps the source's contrast.
    tex = _texture(96, seed=3)
    shifted = np.roll(tex, 8, axis=1)
    warped = _warp(tex, u=8.0, v=0.0, t=1.0)  # fully to the shifted position
    crossfade = 0.5 * tex.astype(np.float32) + 0.5 * shifted.astype(np.float32)

    # Warped matches the real shifted frame far better than the cross-fade does
    # to either source; and preserves standard deviation (contrast).
    err = np.abs(_interior(warped) - _interior(shifted)).mean()
    assert err < 6.0
    assert _interior(warped).std() > _interior(crossfade).std()


def test_static_scene_is_preserved_end_to_end() -> None:
    tex = _texture(48, seed=1)
    mid = ForwardSplatInterpolator().midpoint(tex, tex)
    assert np.abs(_interior(mid) - _interior(tex)).mean() < 6


def test_output_shape_and_dtype() -> None:
    tex = _texture(32)
    mid = ForwardSplatInterpolator().midpoint(tex, np.roll(tex, 3, axis=1))
    assert mid.shape == tex.shape
    assert mid.dtype == np.uint8
