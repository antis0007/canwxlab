# Rendering & Fidelity Program — Queued Sub-Projects

Date: 2026-06-11
Status: Backlog (each item needs its own design spec before implementation)

Shipped 2026-06-11 (commit f7d52aa): scrub-past fetch cancellation, truthful
loading progress, 7-day historical frame archive with 4xx fallback,
ExpandableText for clipped UI (full alert zone lists), zoom-adaptive motion
vector density.

## 1. Multiresolution satellite rendering (never-blank globe)

Goal: a persistent coarse global sequence (low-res, whole-disk) always
resident under the current zoom-band sequence, with shader-level blending
across scales so no view ever renders empty while finer data loads. Coarse
frames are cheap to archive (small textures) → multi-day historical coverage
at low cost; fine tiles fill in where cached. Builds on FrameStore's grid-key
sequences; needs: per-band frame budgets, band-aware draw (sample coarse where
fine missing), prefetch priority coarse-first.

## 2. Temporal fidelity: eliminate remaining steps/fades

Audit the three remaining discontinuity sources: low-confidence crossfade
branch (replace with background-composited advection), zoom-band swap pop
(needs item 1's blended bands), and WMS raster layers (radar) stepping at
frame boundaries (candidate: move radar onto the FrameStore + crossfade
runtime, replacing the MapLibre double-buffered source machinery).

## 3. Realistic cloud + earth shaders

Photometric improvements: sun-angle-aware cloud shading from the cloud mask
(approximate normal from mask gradient), soft cloud shadows on the background
layer, Rayleigh/Mie tuning in the existing atmosphere layer, earth surface
specular for water. Constraint: keep data honest — shading must not invent
cloud structure.

## 4. UI fidelity & scaling audit

Sweep all panels for clipping/overflow (ExpandableText now exists as the
standard remedy), consistent rem-based sizing, container queries for narrow
layouts, and expand/collapse affordances on every long list.

## 5. Performance pass

Profile targets: pairGlobalFlows recompute on draw path, getBufferedRanges
allocations per frame, deck layer churn from React memo keys, flow pump
budget under load. Add a perf HUD (frame time, fetch queue, flow queue).

## 6. Encoder modernization

Migrate mp4-muxer/webm-muxer → Mediabunny; add AV1 when WebCodecs support
lands broadly.
