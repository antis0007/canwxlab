"""Dense optical flow between two satellite frames, server-side.

This is the shared motion field for the web client's temporal morphing:
computed ONCE per frame pair from a continuous IR product (smooth gradients,
valid day and night), then applied client-side to whatever visual product is
displayed — including categorical colormaps that defeat client-side flow.

Algorithm: coarse-to-fine pyramidal Lucas-Kanade, dense, pure NumPy.
Vectorized box-window normal equations per level; no per-pixel Python loops.
At the served grid (default 256²) a full pyramid solves in tens of
milliseconds, and results are cached alongside the imagery.
"""

from __future__ import annotations

import io
import re
from datetime import UTC, datetime, timedelta

import numpy as np
from PIL import Image

# Matches the client's flow texture encoding (MAX_FLOW_UV).
FLOW_ENCODE_SCALE = 0.25
DEFAULT_GRID = 256
PYRAMID_LEVELS = 4
WINDOW_RADIUS = 3
ITERATIONS = 3


_ISO_DURATION = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def parse_time_extent(extent: str) -> tuple[datetime, datetime, timedelta] | None:
    """Parse a WMS ``start/end/PTnM`` time-dimension extent into
    (start, end, step). Returns None for comma-list or unparseable extents."""
    parts = extent.strip().split("/")
    if len(parts) != 3:
        return None
    try:
        start = datetime.fromisoformat(parts[0].replace("Z", "+00:00")).astimezone(UTC)
        end = datetime.fromisoformat(parts[1].replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None
    match = _ISO_DURATION.fullmatch(parts[2].strip())
    if not match or not any(match.groups()):
        return None
    hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    step = timedelta(hours=hours, minutes=minutes, seconds=seconds)
    if step.total_seconds() <= 0:
        return None
    return start, end, step


def snap_to_grid(target: datetime, start: datetime, end: datetime, step: timedelta) -> datetime:
    """Snap a target time to the nearest grid time within [start, end]."""
    if target <= start:
        return start
    if target >= end:
        # Largest grid time at or before end.
        steps = int((end - start) / step)
        return start + steps * step
    steps = round((target - start) / step)
    return start + steps * step


def luma_from_png(png_bytes: bytes, size: int = DEFAULT_GRID) -> np.ndarray:
    """Decode a WMS PNG to a [0,1] luminance grid, alpha-premultiplied so
    transparent (no-data) pixels read as zero signal."""
    image = Image.open(io.BytesIO(png_bytes)).convert("RGBA").resize((size, size), Image.BILINEAR)
    rgba = np.asarray(image, dtype=np.float32) / 255.0
    luma = rgba[..., 0] * 0.2126 + rgba[..., 1] * 0.7152 + rgba[..., 2] * 0.0722
    return luma * rgba[..., 3]


def _box_filter(arr: np.ndarray, radius: int) -> np.ndarray:
    """Separable box filter via cumulative sums — O(n) regardless of radius."""
    size = 2 * radius + 1

    def along(a: np.ndarray, axis: int) -> np.ndarray:
        padded = np.pad(a, [(radius + 1, radius) if ax == axis else (0, 0) for ax in range(a.ndim)],
                        mode="edge")
        csum = np.cumsum(padded, axis=axis)
        upper = np.take(csum, range(size, csum.shape[axis]), axis=axis)
        lower = np.take(csum, range(0, csum.shape[axis] - size), axis=axis)
        return (upper - lower) / size

    return along(along(arr, 0), 1)


def _pyr_down(arr: np.ndarray) -> np.ndarray:
    h, w = arr.shape
    h2, w2 = h // 2 * 2, w // 2 * 2
    a = arr[:h2, :w2]
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) * 0.25


def _warp(arr: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    """Bilinear backward warp: sample arr at (x+u, y+v)."""
    h, w = arr.shape
    yy, xx = np.meshgrid(np.arange(h, dtype=np.float32), np.arange(w, dtype=np.float32),
                         indexing="ij")
    sx = np.clip(xx + u, 0, w - 1.001)
    sy = np.clip(yy + v, 0, h - 1.001)
    x0 = sx.astype(np.int32)
    y0 = sy.astype(np.int32)
    fx = sx - x0
    fy = sy - y0
    top = arr[y0, x0] * (1 - fx) + arr[y0, x0 + 1] * fx
    bottom = arr[y0 + 1, x0] * (1 - fx) + arr[y0 + 1, x0 + 1] * fx
    return top * (1 - fy) + bottom * fy


def _lk_refine(prev: np.ndarray, nxt: np.ndarray, u: np.ndarray, v: np.ndarray,
               radius: int, iterations: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Iterative dense LK refinement of an initial flow at one pyramid level."""
    gy, gx = np.gradient(prev)
    a11 = _box_filter(gx * gx, radius)
    a12 = _box_filter(gx * gy, radius)
    a22 = _box_filter(gy * gy, radius)
    det = a11 * a22 - a12 * a12
    trace = a11 + a22
    valid = det > 1e-9

    for _ in range(iterations):
        warped = _warp(prev, u, v)
        it = nxt - warped
        b1 = _box_filter(gx * it, radius)
        b2 = _box_filter(gy * it, radius)
        du = np.where(valid, (a22 * b1 - a12 * b2) / np.maximum(det, 1e-9), 0.0)
        dv = np.where(valid, (-a12 * b1 + a11 * b2) / np.maximum(det, 1e-9), 0.0)
        # Bounded update per iteration keeps the linearization honest.
        u = u + np.clip(du, -2.0, 2.0)
        v = v + np.clip(dv, -2.0, 2.0)

    # Confidence: texture energy (corner-ness) × residual agreement.
    residual = np.abs(nxt - _warp(prev, u, v))
    texture = np.clip(trace * 250.0, 0.0, 1.0)
    agreement = np.clip(1.0 - residual * 12.0, 0.0, 1.0)
    conf = texture * agreement * valid.astype(np.float32)
    return u, v, conf


def _upsample_flow(u: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    img = Image.fromarray(u.astype(np.float32), mode="F").resize(
        (shape[1], shape[0]), Image.BILINEAR)
    return np.asarray(img, dtype=np.float32)


def compute_flow(prev: np.ndarray, nxt: np.ndarray,
                 levels: int = PYRAMID_LEVELS) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Coarse-to-fine dense flow prev→next in pixels at full grid resolution."""
    pyr_prev = [prev]
    pyr_next = [nxt]
    for _ in range(levels - 1):
        pyr_prev.append(_pyr_down(pyr_prev[-1]))
        pyr_next.append(_pyr_down(pyr_next[-1]))

    u = np.zeros_like(pyr_prev[-1])
    v = np.zeros_like(pyr_prev[-1])
    conf = np.zeros_like(pyr_prev[-1])
    for level in range(levels - 1, -1, -1):
        p, n = pyr_prev[level], pyr_next[level]
        if u.shape != p.shape:
            u = _upsample_flow(u, p.shape) * 2.0
            v = _upsample_flow(v, p.shape) * 2.0
        u, v, conf = _lk_refine(p, n, u, v, WINDOW_RADIUS, ITERATIONS)

    # _lk_refine solves prev(x + u) = next(x): u is the backward sampling map.
    # The public contract is forward motion prev→next, so negate once here.
    return -u, -v, conf


def encode_flow_rgba(u: np.ndarray, v: np.ndarray, conf: np.ndarray) -> bytes:
    """Pack flow into the client texture format: rg = flow in texture-UV per
    interval (0.5-centered, scale FLOW_ENCODE_SCALE), b = confidence.
    Alpha is OCCLUSION in the client shader — low confidence doubles as the
    occlusion signal (cloud forming/dissipating breaks brightness constancy,
    which is exactly where LK confidence collapses). Raw RGBA bytes; the
    client uploads them directly with no image decode."""
    h, w = u.shape
    u_uv = np.clip(u / w, -FLOW_ENCODE_SCALE, FLOW_ENCODE_SCALE)
    v_uv = np.clip(v / h, -FLOW_ENCODE_SCALE, FLOW_ENCODE_SCALE)
    conf_q = np.round(np.clip(conf, 0.0, 1.0) * 255).astype(np.uint8)
    rgba = np.empty((h, w, 4), dtype=np.uint8)
    rgba[..., 0] = np.round((u_uv / (2 * FLOW_ENCODE_SCALE) + 0.5) * 255)
    rgba[..., 1] = np.round((v_uv / (2 * FLOW_ENCODE_SCALE) + 0.5) * 255)
    rgba[..., 2] = conf_q
    rgba[..., 3] = 255 - conf_q
    return rgba.tobytes()
