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

from canwxlab_api.interp_splat import warp_midpoint

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

    @staticmethod
    def _fb_confidence(
        u_f: np.ndarray, v_f: np.ndarray, u_b: np.ndarray, v_b: np.ndarray
    ) -> np.ndarray:
        """Forward/backward consistency → [0,1]: sample the reverse flow at the
        forward-mapped position; a true match cancels, occlusions don't."""
        h, w = u_f.shape
        ys, xs = np.mgrid[0:h, 0:w]
        mx = np.clip(xs + u_f, 0, w - 1).astype(np.int64)
        my = np.clip(ys + v_f, 0, h - 1).astype(np.int64)
        fb = np.hypot(u_f + u_b[my, mx], v_f + v_b[my, mx])
        return np.clip(1.0 - fb / 2.5, 0.05, 1.0).astype(np.float32)

    def midpoint(self, frame_a: np.ndarray, frame_b: np.ndarray) -> np.ndarray:
        a = np.ascontiguousarray(frame_a)
        b = np.ascontiguousarray(frame_b)
        fwd = self._flow(a, b)
        bwd = self._flow(b, a)
        u_f, v_f = fwd[..., 0].astype(np.float32), fwd[..., 1].astype(np.float32)
        u_b, v_b = bwd[..., 0].astype(np.float32), bwd[..., 1].astype(np.float32)
        conf_f = self._fb_confidence(u_f, v_f, u_b, v_b)
        conf_b = self._fb_confidence(u_b, v_b, u_f, v_f)
        # Crack-free backward-warp synthesis (no splat seams / harsh lines).
        return warp_midpoint(a, b, u_f, v_f, conf_f, u_b, v_b, conf_b)
