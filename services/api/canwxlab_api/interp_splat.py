"""Forward softmax-splatting frame interpolator (CPU, pure NumPy).

The best *non-neural* technique for video-style motion with no cross-fade: take
dense bidirectional optical flow, then **forward-warp (splat)** both frames to
the target time. Each output pixel receives real, motion-displaced source
pixels — clouds are placed at their intermediate position, not dissolved.
Overlaps are resolved by confidence-weighted accumulation (a poor-man's softmax
splat); disocclusion holes are filled from a source frame, never by fading.

This is registered as the default `Interpolator` backend so the interpolation
pipeline produces real frames with no GPU. A neural FILM/RIFE backend can
replace it via ``frame_interp.set_interpolator_factory`` for higher quality.

Flow comes from :func:`canwxlab_api.motion_flow.compute_flow`, which returns
forward motion a→b in pixels plus a [0,1] confidence.
"""

from __future__ import annotations

import numpy as np

from canwxlab_api.motion_flow import compute_flow

# Baseline weight so zero-confidence pixels still deposit (avoids holes); real
# confidence rides on top so trustworthy motion dominates overlaps.
_BASE_WEIGHT = 0.05
_LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _to_luma(rgb: np.ndarray) -> np.ndarray:
    return (rgb.astype(np.float32) / 255.0) @ _LUMA


def _splat(
    rgb: np.ndarray,
    u: np.ndarray,
    v: np.ndarray,
    weight: np.ndarray,
    t: float,
    acc_color: np.ndarray,
    acc_w: np.ndarray,
) -> None:
    """Bilinearly forward-splat ``rgb`` displaced by ``t*(u,v)`` into the
    accumulators. Vectorized scatter via ``np.add.at`` — no Python pixel loop."""
    h, w = u.shape
    ys, xs = np.mgrid[0:h, 0:w]
    tx = xs + t * u
    ty = ys + t * v
    x0 = np.floor(tx).astype(np.int64)
    y0 = np.floor(ty).astype(np.int64)
    fx = tx - x0
    fy = ty - y0

    flat_color = acc_color.reshape(-1, 3)
    flat_w = acc_w.reshape(-1)
    rgb_f = rgb.astype(np.float32)

    for dy in (0, 1):
        for dx in (0, 1):
            xn = x0 + dx
            yn = y0 + dy
            bw = (fx if dx else 1.0 - fx) * (fy if dy else 1.0 - fy)
            wgt = bw * weight
            valid = (xn >= 0) & (xn < w) & (yn >= 0) & (yn < h) & (wgt > 0)
            idx = (yn * w + xn)[valid]
            wv = wgt[valid]
            np.add.at(flat_color, idx, rgb_f[valid] * wv[:, None])
            np.add.at(flat_w, idx, wv)


class ForwardSplatInterpolator:
    """Midpoint synthesis by confidence-weighted forward splatting."""

    def midpoint(self, frame_a: np.ndarray, frame_b: np.ndarray) -> np.ndarray:
        a = np.ascontiguousarray(frame_a)
        b = np.ascontiguousarray(frame_b)
        h, w = a.shape[:2]
        luma_a = _to_luma(a)
        luma_b = _to_luma(b)

        # Bidirectional flow: a→b moves a's pixels forward; b→a moves b's. We
        # already solve both directions here, so skip compute_flow's own
        # forward/backward consistency pass (it would solve each direction
        # twice). densify stays on for full-frame coverage.
        u_f, v_f, conf_f = compute_flow(luma_a, luma_b, consistency=False)
        u_b, v_b, conf_b = compute_flow(luma_b, luma_a, consistency=False)

        acc_color = np.zeros((h, w, 3), dtype=np.float32)
        acc_w = np.zeros((h, w), dtype=np.float32)
        _splat(a, u_f, v_f, conf_f + _BASE_WEIGHT, 0.5, acc_color, acc_w)
        _splat(b, u_b, v_b, conf_b + _BASE_WEIGHT, 0.5, acc_color, acc_w)

        covered = acc_w > 1e-6
        out = np.empty((h, w, 3), dtype=np.float32)
        np.divide(acc_color, acc_w[..., None], out=out, where=covered[..., None])
        # Disocclusion holes: fill from frame a (a single real source, not a
        # fade). Rare once both frames splat with the baseline weight.
        if not covered.all():
            out[~covered] = a[~covered]
        return np.clip(out, 0, 255).astype(np.uint8)
