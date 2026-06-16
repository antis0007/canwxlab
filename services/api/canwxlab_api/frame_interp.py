"""Neural frame interpolation for satellite cloud video.

Satellite products publish a frame every ~5–10 min. To play them back as
seamless video we synthesize intermediate frames between each pair of
keyframes. The chosen approach is recursive midpoint synthesis (FILM-style):
a model that interpolates the t=0.5 frame is applied recursively, yielding
``2**depth - 1`` evenly spaced intermediates at fractions ``k / 2**depth``.

This module splits cleanly into:
  - **pure scheduling/encoding** (fractions, times, cache keys, PNG<->array) —
    fully unit-testable with no model and no GPU;
  - **the model boundary** (`Interpolator` protocol + `load_interpolator`) —
    the only part that needs torch/CUDA, imported lazily and guarded so the
    rest of the service runs without the heavy dependency.

The recursion is verified in tests against a trivial linear-average stub, so
its correctness is established independently of the neural model.
"""

from __future__ import annotations

import hashlib
import io
import logging
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

logger = logging.getLogger(__name__)

# Recursion depth caps: depth d emits 2**d - 1 intermediate frames per pair.
# d=4 → 15 intermediates (16 sub-steps) is smooth at typical playback rates
# without exploding synthesis cost / cache size.
MAX_DEPTH = 6
DEFAULT_DEPTH = 4


class InterpUnavailable(RuntimeError):
    """Raised when no neural interpolation backend is installed/loadable."""


class Interpolator(Protocol):
    """Synthesizes the temporal midpoint of two RGB frames.

    Implementations take two ``(H, W, 3)`` uint8 arrays and return the
    ``t=0.5`` frame as the same shape/dtype. Recursion in this module turns a
    midpoint-only model into an arbitrarily dense sequence.
    """

    def midpoint(self, frame_a: np.ndarray, frame_b: np.ndarray) -> np.ndarray: ...


# ── Pure scheduling ────────────────────────────────────────────────────────

def midpoint_fractions(depth: int) -> list[float]:
    """Sorted interpolation fractions for recursive midpoint synthesis.

    depth d → ``[k / 2**d for k in 1 .. 2**d - 1]`` (excludes the 0 and 1
    endpoints, which are the real keyframes).
    """
    if depth < 1:
        return []
    denom = 1 << depth
    return [k / denom for k in range(1, denom)]


def frac_to_time_ms(t0_ms: int, t1_ms: int, frac: float) -> int:
    """Linear map of a [0,1] fraction to a timestamp between two keyframes."""
    return int(round(t0_ms + (t1_ms - t0_ms) * frac))


def pair_cache_key(layer: str, bbox: str, size: int, t0: str, t1: str, depth: int) -> str:
    raw = f"{layer}|{bbox}|{size}|{t0}|{t1}|d{depth}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


# ── Recursion (pure given an Interpolator) ─────────────────────────────────

def synthesize_sequence(
    frame_a: np.ndarray,
    frame_b: np.ndarray,
    depth: int,
    interp: Interpolator,
) -> dict[float, np.ndarray]:
    """Recursive midpoint synthesis → ``{frac: frame}`` for all intermediates.

    Applies ``interp.midpoint`` to bisect each sub-interval ``depth`` times.
    Total model evaluations: ``2**depth - 1`` (each frac computed once). The
    recursion is structural — with a linear-average interpolator the output is
    exact linear interpolation, which the tests assert.
    """
    if depth < 1:
        return {}
    out: dict[float, np.ndarray] = {}

    def bisect(left: np.ndarray, right: np.ndarray, lo: float, hi: float, d: int) -> None:
        if d == 0:
            return
        mid_frame = interp.midpoint(left, right)
        mid_frac = (lo + hi) / 2.0
        out[mid_frac] = mid_frame
        bisect(left, mid_frame, lo, mid_frac, d - 1)
        bisect(mid_frame, right, mid_frac, hi, d - 1)

    bisect(frame_a, frame_b, 0.0, 1.0, depth)
    return out


# ── PNG <-> array (pure) ───────────────────────────────────────────────────

def png_to_rgb(data: bytes) -> np.ndarray:
    """Decode PNG bytes to an ``(H, W, 3)`` uint8 RGB array."""
    from PIL import Image

    with Image.open(io.BytesIO(data)) as img:
        return np.asarray(img.convert("RGB"), dtype=np.uint8)


def rgb_to_png(frame: np.ndarray) -> bytes:
    """Encode an ``(H, W, 3)`` uint8 RGB array to PNG bytes."""
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(np.asarray(frame, dtype=np.uint8)).save(buf, format="PNG")
    return buf.getvalue()


# ── Model boundary (lazy, guarded) ─────────────────────────────────────────

_INTERPOLATOR: Interpolator | None = None
_LOAD_FAILED: str | None = None
# Test/override hook so the pipeline can be exercised without a GPU model.
_FACTORY_OVERRIDE: Callable[[], Interpolator] | None = None


def set_interpolator_factory(factory: Callable[[], Interpolator] | None) -> None:
    """Inject an Interpolator factory (used by tests / alternate backends)."""
    global _INTERPOLATOR, _LOAD_FAILED, _FACTORY_OVERRIDE
    _FACTORY_OVERRIDE = factory
    _INTERPOLATOR = None
    _LOAD_FAILED = None


def load_interpolator() -> Interpolator:
    """Return the process-wide interpolator, loading it once.

    Resolution order: an injected factory (tests / custom backends), else the
    RIFE backend. Raises :class:`InterpUnavailable` with a clear reason if no
    backend can be loaded — callers degrade to the shader morph.
    """
    global _INTERPOLATOR, _LOAD_FAILED
    if _INTERPOLATOR is not None:
        return _INTERPOLATOR
    if _LOAD_FAILED is not None:
        raise InterpUnavailable(_LOAD_FAILED)

    factory = _FACTORY_OVERRIDE or _load_rife
    try:
        _INTERPOLATOR = factory()
    except Exception as exc:  # torch/CUDA/model-weights absent
        _LOAD_FAILED = str(exc)
        logger.warning("frame interpolator unavailable: %s", exc)
        raise InterpUnavailable(_LOAD_FAILED) from exc
    return _INTERPOLATOR


def _load_rife() -> Interpolator:
    """Load the RIFE PyTorch backend (requires the optional ``interp`` extra
    and CUDA on the host). Imported lazily so the base service never depends on
    torch."""
    raise InterpUnavailable(
        "no neural interpolation backend installed; install the GPU 'interp' "
        "extra (torch + RIFE weights) and register it via set_interpolator_factory"
    )
