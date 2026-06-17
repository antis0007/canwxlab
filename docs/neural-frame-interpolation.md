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

## Backends (resolved by `frame_interp._load_default`)

1. **RAFT neural flow + forward splat** (`interp_raft.RaftInterpolator`) — the
   default when torch + torchvision are installed. RAFT (torchvision) is a
   learned dense optical-flow network that handles the large cloud motion and
   smooth interiors that Lucas-Kanade gets wrong; the accurate flow drives a
   confidence-weighted forward splat to synthesize the intermediate frame.
   Runs on CUDA when available, CPU otherwise. Weights auto-download (cached).
2. **Lucas-Kanade forward splat** (`interp_splat.ForwardSplatInterpolator`) —
   pure NumPy, always available, used when the `interp` extra is absent. Same
   splat, weaker flow.
3. Any custom model via `set_interpolator_factory` (e.g. a FILM/RIFE checkpoint
   implementing `Interpolator.midpoint`).

### Enabling RAFT

```
pip install -e '.[interp]'                                   # CPU
# or, on a CUDA host, the matching CUDA build:
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

No code change needed — `_load_default` picks RAFT automatically and falls back
to the LK splat if torch is missing or fails to load.

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
