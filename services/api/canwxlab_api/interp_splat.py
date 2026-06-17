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


def _backward_warp(img: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    """Bilinear backward warp: output(x) = img(x + (fx, fy)). Sampling (not
    scatter) → no cracks or pile-ups, so no harsh seams at motion boundaries."""
    h, w = img.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    sx = np.clip(xs + fx, 0, w - 1.001)
    sy = np.clip(ys + fy, 0, h - 1.001)
    x0 = sx.astype(np.int64)
    y0 = sy.astype(np.int64)
    x1 = x0 + 1
    y1 = y0 + 1
    wx = sx - x0
    wy = sy - y0
    if img.ndim == 3:
        wx = wx[..., None]
        wy = wy[..., None]
    top = img[y0, x0] * (1 - wx) + img[y0, x1] * wx
    bot = img[y1, x0] * (1 - wx) + img[y1, x1] * wx
    return top * (1 - wy) + bot * wy


def warp_midpoint(
    frame_a: np.ndarray,
    frame_b: np.ndarray,
    u_f: np.ndarray, v_f: np.ndarray, conf_f: np.ndarray,
    u_b: np.ndarray, v_b: np.ndarray, conf_b: np.ndarray,
) -> np.ndarray:
    """Synthesize the t=0.5 frame by backward-warping BOTH frames to the
    mid-time and blending by carried confidence.

    Both warps place cloud content at the same intermediate position, so where
    the flow is good they coincide and stay crisp (not a cross-fade); the blend
    is confidence-weighted so the better-tracked frame dominates and disoccluded
    regions (low confidence on one side) come from the other. Backward sampling
    means the result has no splat cracks — the source of the "harsh lines".
    """
    a = frame_a.astype(np.float32)
    b = frame_b.astype(np.float32)
    # a moves +flow_f toward b; at t=0.5 sample a half-way back along its motion.
    wa = _backward_warp(a, -0.5 * u_f, -0.5 * v_f)
    wb = _backward_warp(b, -0.5 * u_b, -0.5 * v_b)
    ca = _backward_warp(conf_f.astype(np.float32), -0.5 * u_f, -0.5 * v_f)
    cb = _backward_warp(conf_b.astype(np.float32), -0.5 * u_b, -0.5 * v_b)
    eps = 1e-3
    alpha = ((ca + eps) / (ca + cb + 2 * eps))[..., None]
    out = wa * alpha + wb * (1.0 - alpha)
    return np.clip(out, 0, 255).astype(np.uint8)


class ForwardSplatInterpolator:
    """Midpoint synthesis by confidence-weighted forward splatting."""

    def midpoint(self, frame_a: np.ndarray, frame_b: np.ndarray) -> np.ndarray:
        a = np.ascontiguousarray(frame_a)
        b = np.ascontiguousarray(frame_b)
        h, w = a.shape[:2]
        luma_a = _to_luma(a)
        luma_b = _to_luma(b)

        # Bidirectional flow: a→b moves a's pixels forward; b→a moves b's. We
        # solve both directions here, so skip compute_flow's own forward/
        # backward consistency pass. densify stays on for full-frame coverage.
        u_f, v_f, conf_f = compute_flow(luma_a, luma_b, consistency=False)
        u_b, v_b, conf_b = compute_flow(luma_b, luma_a, consistency=False)
        # Backward-warp synthesis (crack-free) rather than forward splat.
        return warp_midpoint(a, b, u_f, v_f, conf_f, u_b, v_b, conf_b)
