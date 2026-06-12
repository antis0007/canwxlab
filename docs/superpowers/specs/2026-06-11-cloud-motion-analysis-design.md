# Cloud Motion Analysis: Vector Overlay + Probe — Design Spec

Date: 2026-06-11
Status: Approved (scope selected by user: tools 1+2)
Scope: apps/web — first cloud-analysis sub-project from the 2026-06-09 satellite flow overhaul follow-ups.

## Problem

The optical-flow pipeline derives a dense cloud motion field, but it is
invisible to the operator except as morphing. Professional meteorological
displays expose derived motion directly: atmospheric motion vector (AMV)
style arrow fields and point interrogation of speed/direction.

## Goals

1. **Motion vector overlay**: arrow field over the satellite layer showing
   cloud motion direction and speed, confidence-gated, toggleable.
2. **Cloud motion probe**: clicking the map adds cloud motion speed (km/h),
   direction (compass bearing, "from" convention like wind), flow confidence,
   and cloud probability to the existing right inspector.

## Non-goals

Area statistics, cell tracking/nowcast (later specs). No new GPU passes —
both tools read fields the pipeline already computes.

## Architecture

### Data path: GPU flow field → CPU sample grid

`FlowPipeline` gains a CPU read-back of a ready pair's packed flow texture
(rg = encoded flow UV, b = confidence, a = occlusion) and bgMask texture
(a = cloud probability):

```
readMotionField(pairKey): MotionField | null
interface MotionField {
  width: number; height: number;        // flow texture dims
  data: Uint8Array;                      // RGBA flow texture pixels
  cloud: Uint8Array | null;              // RGBA bgMask pixels (a = cloud)
  mercBounds: [w, s, e, n];              // frame quad bounds
  intervalMs: number;                    // nextTimeMs - prevTimeMs
}
```

- Read lazily via `device.readPixelsToArrayWebGL(framebuffer)` on first
  request per pair; cached on the pair record; freed by existing prune.
- Decoding to physical units is pure math in a new module
  `apps/web/src/layers/renderers/satellite/motionField.ts`:
  - flow UV → mercator displacement: `du × mercWidth`, `dv × mercHeight`
    (texture v is flipped vs mercator y — same convention as `mercToTexUv`).
  - mercator m → true ground m: multiply by `cos(lat)` (Web Mercator scale).
  - speed m/s = ground displacement / (intervalMs/1000); direction =
    meteorological "from" bearing.
  - Sample reads bilinear-free nearest texel; gates: confidence ≥ 0.15,
    occlusion < 0.5 for vectors (probe reports raw values with confidence).

### Vector overlay

- `SatelliteCompositeLayer.getMotionVectors(viewMercBounds, maxCount)`:
  for each active entry's current draw pair with a ready flow result, sample
  an evenly spaced grid (target ≈ 24 × 16 across the viewport) from the
  decoded MotionField; emit
  `{ lon, lat, speedMps, bearingDeg, confidence }` for samples passing gates.
- Rendering: deck.gl `LineLayer` (shaft) + `IconLayer`-free triangle head via
  a second short `LineLayer` segment pair — implemented as one
  `createMotionVectorLayers(vectors)` helper in
  `apps/web/src/layers/renderers/motionVectors.ts` returning deck layers.
  Arrow length ∝ min(speed, 120 km/h) mapped to ~12–48 px at current zoom
  (computed in mercator meters from viewport scale). Color by speed
  (existing thermal-style ramp constants, fixed 4-stop ramp inline).
- Refresh cadence: vectors rebuilt when the active pair key or grid changes,
  NOT per animation frame (MapView memo keyed on a `motionVectorsVersion`
  counter the layer bumps when a pair's flow becomes ready / pair switches).
  Static per scene — matches professional AMV display behavior.
- Toggle: TopBar chip "VECT" next to the NIGHT/terminator control, state in
  App (`motionVectorsVisible`, persisted to localStorage
  `canwxlab.motionVectors.v1`).

### Probe

- `SatelliteCompositeLayer.probeMotionAt(lon, lat): MotionProbe | null`
  where `MotionProbe = { speedMps, speedKmh, bearingDeg, bearingCardinal,
  confidence, cloudProbability, satelliteId, validTime }`. First entry whose
  frame bounds contain the point wins; null when no ready flow.
- MapView click handler already builds the inspector payload; it adds
  `motionProbe` to the payload via the satellite layer ref.
- RightInspector renders a "CLOUD MOTION" block: `42 km/h from WSW (247°)`,
  confidence %, cloud probability %. Hidden when probe null.

## Error handling

- `readPixelsToArrayWebGL` failure (context loss): log once, return null —
  probe shows nothing, vectors skip the pair.
- Vectors capped at `maxCount` (default 512) to bound deck layer size.
- All decoding guards non-finite inputs; zero-interval pairs return null.

## Testing

- `motionField.test.ts`: UV→m/s conversion incl. cos(lat) and v-flip;
  bearing convention (flow toward east = wind *from* west = 270°);
  confidence/occlusion gating; grid sampling bounds.
- `motionVectors.test.ts`: arrow geometry (length clamp, head angle),
  speed→color stops, vector count cap.
- Inspector/probe: unit test for probe formatting (cardinal points,
  rounding) in `workbenchPanels.test.tsx` style.

## Implementation order

1. `motionField.ts` pure math + tests.
2. FlowPipeline read-back + layer `getMotionVectors`/`probeMotionAt`.
3. `motionVectors.ts` deck layers + MapView/TopBar wiring.
4. Probe → inspector wiring + display block.
