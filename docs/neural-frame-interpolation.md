# Neural frame interpolation (cloud video)

Satellite products publish a frame every ~5–10 min. To play clouds back as
seamless video we synthesize intermediate frames between each keyframe pair
using a neural interpolator (FILM/RIFE class), pre-render them on the GPU, and
cache them to disk. The client then plays a dense frame sequence instead of
morphing across the gap in a shader.

## Architecture

```
keyframe t0 ─┐
             ├─► [Interpolator.midpoint] ──recursive bisection (depth d)──► 2^d−1 frames
keyframe t1 ─┘            (GPU, off the event loop)         │
                                                            ▼
                                          disk cache  .canwxlab/cache/interp/<key>/f*.png
                                                            │
                                   GET /api/v1/interp/manifest ──► frame list + URLs
                                   GET /api/v1/interp/frame    ──► cached PNG
```

- **Pure, tested core** (`canwxlab_api/frame_interp.py`): fraction scheduling,
  recursive midpoint synthesis, PNG⇄array, cache keys. Verified against a
  linear-average stub — correctness is independent of the model.
- **Model boundary**: the `Interpolator` protocol (`midpoint(a, b) -> frame`).
  Everything GPU lives behind it; the base service has no torch dependency.
- **Honest degradation**: with no backend installed the manifest returns
  `available: false` and the client falls back to the shader morph.

## Enabling the model on a GPU host

1. Install the extra: `pip install -e '.[interp]'` (pulls torch).
2. Implement an `Interpolator` and register it at startup, e.g. in a small
   startup hook:

```python
import numpy as np, torch
from canwxlab_api.frame_interp import set_interpolator_factory

class RifeInterpolator:
    def __init__(self):
        self.model = load_rife_model().cuda().eval()  # your RIFE/FILM weights

    @torch.inference_mode()
    def midpoint(self, a: np.ndarray, b: np.ndarray) -> np.ndarray:
        ta = torch.from_numpy(a).permute(2, 0, 1)[None].float().cuda() / 255
        tb = torch.from_numpy(b).permute(2, 0, 1)[None].float().cuda() / 255
        mid = self.model(ta, tb, timestep=0.5)        # FILM/RIFE forward
        out = (mid[0].clamp(0, 1) * 255).byte().permute(1, 2, 0).cpu().numpy()
        return out

set_interpolator_factory(RifeInterpolator)  # lazy: constructed on first use
```

The factory is constructed once, lazily, on the first synthesis request.

## Why this hits the quality bar

- **No ghosting**: the model synthesizes occlusion-aware intermediates (clouds
  forming/dissipating are generated, not cross-faded), unlike warp+blend.
- **No 5-min gaps**: `depth=4` emits 15 intermediates per pair (16 sub-steps).
- **Lakes/water static**: background separation stays the client's job; only
  moving cloud structure is synthesized between keyframes.
- **Fast loading**: synthesis is cached per pair; clients stream finished PNGs
  (cheap) instead of computing flow every frame.

## Verifying

The pipeline (synthesis → cache → serve, and degradation) is covered by
`tests/test_frame_interp.py` and `tests/test_interp_routes.py` using a stub
interpolator — no GPU required for CI. Visual quality must be confirmed on the
GPU host with the real model.
