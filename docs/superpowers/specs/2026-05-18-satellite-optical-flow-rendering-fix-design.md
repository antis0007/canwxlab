# Satellite Optical-Flow Rendering Fix — Design

**Date:** 2026-05-18  
**Status:** design-approved  
**Scope:** Satellite composite temporal morphing, animated deck layer pop-in, satellite loading reliability

## Problem Summary

1. **Satellite frames pop in/out** — SatelliteCompositeLayer destroys old textures on every frame advance. No temporal interpolation exists between discrete WMS frames. Clouds appear to flash/fade rather than drift.
2. **Animated deck layers stutter** — `animatedDeckLayers` useMemo recreates all deck.gl layer instances on every `animationFrame` tick. With `transitions: {}`, this produces hard geometry swaps.
3. **Half the satellites fail to load** — CORS issues, no retry logic, simultaneous fetches hitting rate limits.
4. **WMS double-buffer crossfades perceptibly** — The 120ms crossfade in maplibreRaster.ts visibly fades satellite frames, which the user considers a "complete failure."

## Design

### 1. Optical-Flow Morphing Pipeline (satelliteComposite.ts)

Replace the single-texture-per-satellite model with a dual-texture temporal pipeline:

**State per satellite entry:**
```
prevTexture  — frame N (kept until frame N+2 arrives)
nextTexture  — frame N+1 (current target)
flowTexture  — optical flow field (low-res, computed once per frame pair)
```

**Pass 1 — Lucas-Kanade Optical Flow (new FBO, 1/4 viewport resolution):**

- Input: prevTexture, nextTexture
- Compute spatial gradients (Sobel 3×3) on prevTexture luminance
- Compute temporal gradient (next - prev) per-pixel
- Solve Lucas-Kanade in 5×5 window: `d = (A^T A)^-1 * A^T b`
- Output flowTexture: RG = (dx, dy) in normalized UV displacement, B = flow confidence
- Confidence threshold: discard flow vectors with low confidence (< 0.3), fall back to pure cross-dissolve for those pixels

**Pass 2 — Advected Morph (modified main compositor FS):**

For each satellite with both textures loaded:
```glsl
vec2 flow = texture(uFlowTex, vUv).rg;
vec2 advectedUV = vUv + flow * uTimeProgress;
vec4 advected = texture(prevTex, advectedUV);
vec4 nextSample = texture(nextTex, vUv);
vec4 result = mix(advected, nextSample, uTimeProgress);
```

When only one texture is loaded (startup): render it directly, no morph.

**Time progress:** Driven by `subFrameProgress` from animation.ts — the same 0→1 value that already smoothly advances between discrete 5-minute frames. At t=0, output = prev. At t=1, output = advected prev ≈ next. No fade to transparent ever.

**Memory:** 8 textures per satellite at 2048×2048 RGBA8 = 16 MB per satellite. With 4 satellites: 64 MB. Add flow textures at 256×256 RGBA8 = 256 KB each. Total: ~65 MB GPU — acceptable for modern hardware.

### 2. Animated Deck Layers — Stable Instances (MapView.tsx)

Move animated layer creation out of `useMemo([animationFrame, subFrameProgress])`:

- Create deck.gl layer instances once in a `useRef`, keyed by stable layer ID
- On each frame tick, use an imperative `useEffect` to call `layer.setProps({ data })` with the newly generated GeoJSON
- Remove `transitions: {}` from deckGrid.ts/deckParticles.ts — deck.gl's default transitions (200ms) are now safe because layer instances are stable and deck.gl will interpolate between old and new data positions
- The `subFrameProgress` interpolation in data generators (`createTemperatureGrid`, `createPressureGrid`, `createRadarBlobs`) already produces sub-frame data; the imperative update ensures deck.gl sees smooth property transitions

### 3. Satellite Loading Reliability (satelliteComposite.ts)

**CORS fix:** Route satellite WMS fetches through the existing API proxy. Change `_fetchTextures` to call `/api/eccc/wms/build-url` (returns a server-fetched image URL or base64) instead of direct WMS URLs with `<img crossorigin="anonymous">`.

**Staggered fetches:** Add 200ms delay between each satellite's fetch to avoid rate-limiting.

**Retry with backoff:** On load failure, retry up to 3 times with delays: 500ms, 1500ms, 4500ms. On final failure, show the last successfully loaded texture (stale is better than blank).

**Reduce refetch threshold:** Lower `REFETCH_THRESHOLD` from 0.25 to 0.15 for satellite layers to reduce stale-texture persistence.

### 4. WMS Double-Buffer (maplibreRaster.ts)

- Satellite-like layers already excluded via `isGeostationarySatellite()` — no change needed for them
- For non-satellite WMS: reduce `WMS_RASTER_FADE_MS` from 120ms to 50ms during playback, 100ms when paused
- The optical-flow compositor handles all satellite temporal continuity; the maplibregl raster path only serves non-satellite WMS

## Files Changed

| File | Change |
|------|--------|
| `apps/web/src/layers/renderers/satelliteComposite.ts` | Dual-texture state, optical flow FBO/pass, advected morph shader, retry logic, staggered fetches |
| `apps/web/src/components/MapView.tsx` | Stable animated layer instances via refs, imperative setProps |
| `apps/web/src/layers/renderers/deckGrid.ts` | Enable deck.gl transitions (remove `transitions: {}`) |
| `apps/web/src/layers/renderers/deckParticles.ts` | Enable deck.gl transitions (remove `transitions: {}`) |
| `apps/web/src/layers/renderers/maplibreRaster.ts` | Reduce crossfade duration for non-satellite WMS |

## Testing

- Visual: satellite animation playback at 1×, 2×, 4× speed — verify no fade-to-black, no perceptible seam
- Visual: animated deck layers (temperature, pressure, radar) — verify no pop-in between frames
- Console: verify no CORS errors for satellite WMS fetches
- Console: verify retry logic fires on transient failures
- Memory: verify GPU texture count is bounded (max 4 prev + 4 next + 4 flow = 12 textures)

## Non-Goals

- Station observation fixes (next implementation session)
- Hourly forecast panel (next implementation session)
- Full-resolution optical flow (too expensive for real-time; 1/4 res is the right tradeoff)
