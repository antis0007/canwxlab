"""Neural optical-flow frame interpolator (RAFT + forward splat).

The honest fix for "the flow looks wrong": replace Lucas-Kanade with RAFT
(torchvision), a learned dense optical-flow network that handles the large
cloud motion and smooth interiors LK fails on. The accurate dense flow then
drives the same confidence-weighted forward splat (interp_splat._splat) to
synthesize a real intermediate frame — motion-compensated, no cross-fade.

Runs on CUDA when available (the deployment GPU), CPU otherwise. Weights are
downloaded once by torchvision and cached. torch/torchvision are optional: if
absent, the pipeline falls back to the pure-NumPy LK splat
(ForwardSplatInterpolator) via frame_interp._load_default.
"""

from __future__ import annotations

import logging

import numpy as np

from canwxlab_api.interp_splat import _BASE_WEIGHT, _splat

logger = logging.getLogger(__name__)


class RaftInterpolator:
    """Midpoint synthesis: RAFT bidirectional flow → forward splat.

    Confidence is derived from forward/backward consistency (RAFT emits no
    confidence): where the two directions disagree the motion is occluded or
    wrong, so it is down-weighted in the splat.
    """

    def __init__(self) -> None:
        import torch
        from torchvision.models.optical_flow import Raft_Small_Weights, raft_small

        self._torch = torch
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = (
            raft_small(weights=Raft_Small_Weights.DEFAULT, progress=False)
            .eval()
            .to(self._device)
        )
        logger.info("RAFT interpolator loaded on %s", self._device)

    def _to_tensor(self, rgb: np.ndarray):
        t = self._torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).float()
        return (t / 255.0 * 2.0 - 1.0)[None].to(self._device)

    def _flow(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        """Dense flow a→b in pixels, shape (H, W, 2). RAFT needs spatial dims
        that are multiples of 8 and at least 128 (feature maps are downsampled
        by 8 and must be ≥16), so we reflect-pad up and crop back."""
        h, w = a.shape[:2]
        th = max(128, ((h + 7) // 8) * 8)
        tw = max(128, ((w + 7) // 8) * 8)
        ph, pw = th - h, tw - w
        ap = np.pad(a, ((0, ph), (0, pw), (0, 0)), mode="edge")
        bp = np.pad(b, ((0, ph), (0, pw), (0, 0)), mode="edge")
        with self._torch.no_grad():
            preds = self._model(self._to_tensor(ap), self._to_tensor(bp))
        flow = preds[-1][0].permute(1, 2, 0).cpu().numpy()  # H,W,2 (u,v) px
        return flow[:h, :w, :]

    def midpoint(self, frame_a: np.ndarray, frame_b: np.ndarray) -> np.ndarray:
        a = np.ascontiguousarray(frame_a)
        b = np.ascontiguousarray(frame_b)
        h, w = a.shape[:2]
        fwd = self._flow(a, b)
        bwd = self._flow(b, a)
        u_f, v_f = fwd[..., 0], fwd[..., 1]
        u_b, v_b = bwd[..., 0], bwd[..., 1]

        # Forward/backward consistency → confidence in [0,1]. Sample the backward
        # flow at the forward-mapped position; a consistent match cancels.
        ys, xs = np.mgrid[0:h, 0:w]
        mx = np.clip(xs + u_f, 0, w - 1).astype(np.int64)
        my = np.clip(ys + v_f, 0, h - 1).astype(np.int64)
        fb = np.hypot(u_f + u_b[my, mx], v_f + v_b[my, mx])
        conf_f = np.clip(1.0 - fb / 2.5, 0.05, 1.0).astype(np.float32)
        conf_b = conf_f  # symmetric enough for splat weighting

        acc_color = np.zeros((h, w, 3), dtype=np.float32)
        acc_w = np.zeros((h, w), dtype=np.float32)
        wf = (conf_f + _BASE_WEIGHT).astype(np.float32)
        wb = (conf_b + _BASE_WEIGHT).astype(np.float32)
        _splat(a, u_f.astype(np.float32), v_f.astype(np.float32), wf, 0.5, acc_color, acc_w)
        _splat(b, u_b.astype(np.float32), v_b.astype(np.float32), wb, 0.5, acc_color, acc_w)

        covered = acc_w > 1e-6
        out = np.empty((h, w, 3), dtype=np.float32)
        np.divide(acc_color, acc_w[..., None], out=out, where=covered[..., None])
        if not covered.all():
            out[~covered] = a[~covered]
        return np.clip(out, 0, 255).astype(np.uint8)
