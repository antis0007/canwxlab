# Satellite Flow Overhaul + Video/GIF Export — Design Spec

Date: 2026-06-09
Status: Implemented (merged to main 2026-06-10)

Implementation amendments:
- No MediaRecorder fallback for video export: it cannot produce
  frame-accurate timestamps for stepped offline rendering. The UI disables
  WebM/MP4 when WebCodecs is unavailable; GIF remains.
- Motion sampling stays synchronous at fetch time instead of a worker; GPU
  flow is amortized one pass per frame via the pipeline pump, which removed
  the jank the worker was meant to address.
- Zoom-band handoff swaps when the new grid pair is ready instead of a
  150 ms crossfade, keeping the composite shader within WebGL2's 16
  guaranteed texture units (satellite slots reduced 4 → 3).
- Added (root-cause find during implementation): periodic layer-catalog
  refresh so sliding WMS time extents (radar ~3 h) track upstream retention.
Scope: apps/web satellite compositor, animation timeline, export pipeline

## Problem

The satellite optical-flow animation freezes after a few seconds of playback, then
stops entirely. Even when running, motion is choppy and stepped rather than
seamless, lakes and other static landmarks get advected along with clouds
("smeary mess"), and low-resolution source imagery produces hallucinated
small-scale cloud motion that does not exist in the data. The existing GIF export
produces broken output (blank/stale frames) and its UI is minimal.

### Root causes (diagnosed in `apps/web/src/layers/renderers/satelliteComposite.ts`)

1. **Buffer starvation.** `MAX_IN_FLIGHT_FRAMES_PER_SATELLITE = 1`, total
   in-flight cap 2, preload window only ±1/+2 frames around the current WMS
   template. At 2× playback speed the playhead crosses one 10-minute satellite
   interval per ~1 s of wall time while each WMS fetch takes 3–5 s. The buffer
   drains within seconds; `selectDrawPair` degrades to a static `prev === next`
   pair and the image freezes.
2. **No playback/data synchronization.** `progressForPair` produces phase > 1;
   the shader extrapolates briefly, then freezes on the next sample when
   confidence < 0.08. Nothing throttles or pauses the playhead when data is
   missing.
3. **Pair-switch deadlock.** `shouldSwitchSatelliteDrawPair` only allows pair
   swaps within a ±0.055 phase window. A fast playhead can skip the window
   between draws, leaving the layer stuck on a stale active pair.
4. **Viewport-anchored fetches.** Frame BBOX is the padded viewport; any pan or
   zoom invalidates the whole buffer and destroys flow history.
5. **Hallucinated fine-scale motion.** Dense flow is computed on a fixed
   512-px grid regardless of native imagery resolution (~2 km for GOES). When
   zoomed past native resolution, Lucas–Kanade locks onto resampling noise and
   PNG quantization, inventing small swirls. There is no smoothness
   regularization and the cornerness confidence gate passes on interpolation
   artifacts.
6. **Static-feature smear.** Flow treats every luminous pixel as cloud; lakes,
   coastlines, and snowfields are advected along with clouds.
7. **Discrete stepping / jank.** Per-playhead-step React churn (renderPlan →
   `satelliteWmsSig` effect → template push), pair handoff without ready flow,
   and synchronous main-thread work (`getImageData` motion sampling, GPU flow
   passes on the draw path).
8. **GIF export broken.** (a) `drawImage` from WebGL canvases outside the
   render callback returns blank without `preserveDrawingBuffer`; (b)
   `onRequestFrame` resolves after a blind 250 ms sleep with no readiness
   signal; (c) the tiny satellite buffer means every exported frame triggers
   fresh fetches.

## Goals

- Seamless, continuous cloud motion with no freezes, steps, or visible
  keyframes during playback of a buffered loop.
- Physically honest motion: no flow finer than the native data resolution, no
  advection of static terrain/water, occlusion-aware handling of cloud
  formation/dissipation.
- Video-player buffering model: the playhead never enters unbuffered time;
  buffering is visible on the timeline.
- Working export of the selected view area over a selected time range as GIF,
  WebM, and MP4 with a quality-focused UI.

## Non-goals (queued as separate specs)

- Cloud analysis tools (tracking, classification, measurements).
- Server-side motion product (flow stays client-GPU; interfaces should not
  preclude a future server product).

## Architecture

Approach: targeted overhaul of the existing layer (chosen over clean rewrite
and neural interpolation). `satelliteComposite.ts` (3 096 lines) is split into
three modules with clear boundaries:

| Module | Responsibility |
|---|---|
| `apps/web/src/layers/renderers/satellite/frameStore.ts` | Time-indexed frame ring buffer, fetch scheduling, eviction, buffered-range reporting |
| `apps/web/src/layers/renderers/satellite/flowPipeline.ts` | GPU pyramid optical flow, cloud/background separation, confidence + occlusion masks |
| `apps/web/src/layers/renderers/satellite/satelliteComposite.ts` | deck.gl layer: draw, uniforms, pure time-indexed pair lookup (thin) |

### 1. Frame store

- **Snapped BBOX grid.** Fetch bounds are quantized to a power-of-two mercator
  grid keyed by zoom band (one quad per band, not a tile pyramid). Panning
  within a grid cell causes zero invalidation. Crossing a zoom band fetches a
  new sequence while the old sequence keeps rendering until the new one is
  drawable.
- **Time-window prefetch.** Target buffer = loop window clamped to 3 h
  (18 frames × 10 min per satellite), fetched outward from the playhead.
  Up to 4 parallel fetches per satellite, 8 total. `MAX_RETAINED_FRAMES` → 40.
- **Buffered-range reporting.** `getBufferedRanges(): {startMs, endMs}[]` per
  satellite drives the timeline UI and the playhead clamp.
  `whenTimeBuffered(ms): Promise<void>` supports the exporter.

### 2. Playback sync (video-player model)

- `useAnimationTimeline` receives `bufferedRanges`; the rAF tick clamps
  playhead advance to the buffered edge and exposes `isBuffering`.
- Timeline UI renders the buffered region (shaded band) and a buffering
  indicator on the Play control. Looping wraps within the buffered span.
- Pair selection becomes a pure time lookup `framesAt(timelineMs)` against the
  ring buffer. `shouldSwitchSatelliteDrawPair`, `activePairKey`, and related
  deadlock machinery are deleted. Zoom-band sequence handoff is allowed at any
  phase via a 150 ms screen-space crossfade.
- Playhead movement triggers no React-side satellite work: WMS templates are
  pushed once per loop window, not per frame slot.

### 3. Flow pipeline

- **Coarse-to-fine pyramid.** 4 levels (64 → 128 → 256 → 512); each level runs
  Lucas–Kanade refinement on the upsampled coarser estimate. Replaces the
  single coarse seed + same-resolution refinement.
- **Native-resolution cap (hallucination fix).** Effective source GSD is
  computed from the WMS request (mercator meters per texture pixel vs ~2 000 m
  GOES native). The finest pyramid level is capped so one flow texel ≥ one
  native satellite pixel; finer levels are skipped when the view is zoomed past
  native resolution.
- **Smoothness regularization.** Confidence-weighted vector-median/diffusion
  pass after each pyramid level removes residual swirl noise.
- **Cloud/background separation (smear fix).** Per buffered sequence, a
  clear-sky background composite is maintained on the GPU: temporal
  minimum/percentile for visible products, temporal median/mode for IR
  (coldest-pixel-wins is wrong there); selectable per product type. A per-pixel
  cloud mask (frame minus background, hysteresis-thresholded) gates both flow
  compute and warping. The morph shader composites
  `mix(staticBackground, warpedCloudLayer, cloudAlpha)` so lakes and terrain
  stay pinned while clouds move over them.
- **Forward–backward consistency.** Flow is computed in both directions at the
  final level; mismatched pixels form an occlusion mask, and the shader
  cross-dissolves those pixels instead of warping (honest rendering of
  convection growth/decay).
- **Temporal continuity.** The existing Hermite C1 velocity blending across
  keyframes is retained, fed by the time-indexed pair chain.
- **Scheduling.** Flow is computed for all buffered adjacent pairs ahead of the
  playhead in an idle-priority queue (≥3 pairs ahead), one pyramid level per
  rAF idle slice. Pair handoff happens only when the next pair's flow is ready
  (guaranteed reachable because of the buffer clamp). Motion sampling
  (`getImageData`) moves to a worker with `OffscreenCanvas`.

### 4. Export (GIF + WebM + MP4)

- **Capture.** Pixels are read synchronously inside MapLibre's `render`-event
  callback for the exact frame the export controller requested (no global
  `preserveDrawingBuffer` cost).
- **Readiness.** Per exported frame: `await frameStore.whenTimeBuffered(ms)`
  plus map `idle`. The blind 250 ms sleep is removed.
- **Sub-frame morphing.** The exporter steps the timeline at the output-fps
  interval through `setTimelineSample`, so exports contain the same morphed
  in-between frames as live playback.
- **Encoders.** Common `FrameSink` interface with three implementations:
  - GIF via gifenc: Floyd–Steinberg dithering toggle, global-palette mode
    (sampled across frames to stop palette flicker) with per-frame palette
    fallback, up to 15 fps.
  - WebM (VP9) and MP4 (H.264) via WebCodecs `VideoEncoder` +
    `webm-muxer`/`mp4-muxer`; `MediaRecorder` fallback when WebCodecs is
    unavailable.
- **UI (GifExportPanel rework → ExportPanel).** Drag-rectangle area selection
  on the map; time range initialized from loop markers with editable start/end;
  format selector (GIF/WebM/MP4); fps presets (5/10/15; video formats may go
  higher); resolution presets (480/720/full); live estimated file size;
  progress bar with cancel.

## Error handling

- Fetch failures: existing retry ladder and failed-URL cooldown are retained in
  the frame store; a gap in buffered ranges simply shortens the playable span
  shown on the timeline (no freeze).
- Flow compute failure for a pair: pair falls back to whole-interval crossfade
  (existing behavior), logged once.
- WebGL context loss: layer rebuilds frame store from the HTTP cache
  (`cachedGetImageBlob` already caches blobs for 30 min).
- Export: per-frame timeout (e.g. 15 s) fails the export with a clear error
  rather than hanging; cancel aborts cleanly and releases the encoder.

## Testing

- **Frame store:** unit tests for grid snapping, prefetch ordering around the
  playhead, eviction policy, buffered-range math, `whenTimeBuffered`.
- **Flow:** extend `satelliteComposite.test.ts` — native-resolution cap math,
  pyramid level selection, forward–backward mask logic, background-composite
  selection per product type.
- **Playback:** extend `animation.test.ts` — playhead clamp at buffer edge,
  resume on buffer growth, loop within buffered span, no React commits from
  playhead motion.
- **Export:** readiness-await and FrameSink logic unit-tested; Playwright
  manual verification that captured frames are non-blank and morphed.

## Implementation order

1. Frame store module + tests (foundation; fixes freeze).
2. Playback sync + timeline buffered UI.
3. Flow pipeline rebuild (pyramid, resolution cap, regularization).
4. Cloud/background separation + occlusion handling.
5. Export capture/readiness fix (GIF working again).
6. WebM/MP4 encoders + ExportPanel UI.
