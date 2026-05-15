# Globe Rendering

## Current Approach (Phase 2)

CanWxLab keeps MapLibre as the base renderer and adds an optional map/globe view toggle.

- View mode type: `"map" | "globe"`
- Default: `map`
- Globe mode uses MapLibre projection switching (`setProjection`) when available
- If unsupported by installed MapLibre, the UI keeps globe disabled and shows a clear unavailable message

## Why CesiumJS Is Deferred

CesiumJS is not the default renderer in this phase because:

- current stack is already MapLibre + deck.gl
- immediate goal is fast local iteration, not full 3D globe migration
- introducing dual renderer stacks now would increase maintenance and integration complexity

## Current Limitations

- Some deck.gl overlays are effectively map-only
- Globe support depends on runtime MapLibre capabilities
- WMS time animation remains metadata-first for now

The layer engine flags map-only layers via `supportsGlobe = false` and diagnostics warnings surface this in the inspector.

## Renderer Capability Model

Layer capabilities include:

- `supportsMap`
- `supportsGlobe`
- `supportsAnimation`
- `supportsPicking`
- `supportsShader`
- `supportsWms`

This model is used to:

- label layers in UI
- gate globe rendering expectations
- prepare future multi-renderer abstraction

## Planned Renderer Abstraction Path

1. Keep MapLibre + deck.gl stable for weather workbench UX.
2. Finish WMS radar/satellite timeline playback on MapLibre.
3. Introduce renderer adapter interface for optional Cesium path.
4. Evaluate Cesium integration as opt-in experimental renderer, not default.
