# Globe Rendering

## Current Approach (Phase 2)

CanWxLab keeps MapLibre as the base renderer and adds an optional map/globe view toggle.

- View mode type: `"map" | "globe"`
- Default: `globe`
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
- The broken screen-space atmosphere/terminator has been removed from the active MapLibre render
  path. The current app keeps space dark and avoids fake lighting until a real globe shader lands.
- MapLibre raster layers cannot do shader feathering, colour-space aware compositing, or
  per-pixel blend modes between independently timed satellite products.
- Far-out "space" scale is outside MapLibre globe's design envelope. Below low-orbit zoom,
  MapLibre should hand off to a real WebGL orbital renderer instead of pushing negative zoom.
- Right-click globe camera gestures are dangerous in the current renderer because MapLibre camera
  state, DOM/SVG overlays, and deck.gl overlays are separate systems. If pointer capture is lost
  or pitch/bearing drift is introduced, overlays can become visually misregistered.

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
2. Route MapLibre through the normalized render-plan boundary documented in
   `docs/rendering-rewrite.md`.
3. Finish WMS radar/satellite timeline playback on MapLibre.
4. Evaluate Cesium integration as opt-in experimental renderer, not default.

## Visual-Fidelity Findings

The removed screen-space atmosphere existed only because MapLibre's globe API does not expose the
globe-fragment shader hooks needed for physical scattering. It could draw a directional night mask
and a thin limb, but it could not solve the important problems:

- Rayleigh and Mie scattering need camera height, view ray, sun direction, optical depth, ozone,
  ground albedo, exposure, and tonemapping in a fragment shader.
- The terminator needs to be calculated per surface fragment, not as a screen-space rectangle or
  gradient. The current overlay can be directionally plausible but will never match real globe
  geometry at all camera distances.
- Satellite region edge blending needs per-pixel alpha feathering in source texture space. WMS
  raster layers in MapLibre are composited as style layers and cannot feather one provider's
  footprint into another provider's footprint.
- "High displayed FPS with stutter" is expected when the browser is decoding many remote raster
  tiles and rebuilding source caches. The frame counter measures render loop cadence, not tile
  decode/network jitter.

## Current Fixes In The MapLibre Path

- WMS frames are double-buffered and promoted after source load instead of mutating MapLibre source
  internals.
- Previous WMS frames are hidden immediately on promotion to prevent transparent layers from
  double-compositing during cleanup.
- Active layer stack order is now the render order. Users can move active layers up/down; WMS
  layers are reinserted to match that stack.
- The fake atmosphere/terminator overlay is not active. This avoids date-line/terminator artifacts
  and keeps the globe readable until the renderer supports physically coherent lighting.
- The default fresh experience opens as a global VIIRS/GIBS globe instead of a Canada-centered
  dark operations map.
- The experimental WebGL atmosphere/terminator pass was removed from the mounted app. It was still
  screen-space, so it could not stay coherent at the date line, limb, or far-out zoom distances.
- Globe right-click orbit now has window-level release/cancel/blur guards so a lost pointer event
  cannot leave the camera in a stuck drag state.

## Shader Renderer Requirements

The next renderer must be one of:

1. **CesiumJS path**: fastest route to a production globe. Use `SkyAtmosphere`, sun lighting,
   terrain, and imagery providers. This is the pragmatic choice for meteorological/OSINT software.
2. **Three.js/regl custom path**: maximum control. Required if CanWxLab needs Space Engine style
   planets, custom atmospheric LUTs, procedural body rendering, and unified orbital mechanics.

Minimum shader features:

- WebGL2, floating point render targets where available, logarithmic depth.
- Earth ellipsoid or sphere mesh with tiled imagery texture sampling.
- Precomputed transmittance/inscattering LUTs or Bruneton-style atmospheric scattering.
- Night-side city lights as a separate emissive texture, masked by sun altitude and cloud opacity.
- Cloud layer as a separate shell with its own phase function and shadow approximation.
- Per-source imagery footprint masks with configurable feather width.
- Linear-light compositing and tonemapping; avoid stacking PNG alpha in sRGB.
- Temporal tile cache with current, previous, and next frames; never swap an unfinished frame.

## Immediate TODOs

- RENDER-TODO(A): Extend the current renderer adapter types
  (`maplibre-2d`, `maplibre-globe`, `earth-webgl`) into concrete class/object adapters.
- RENDER-TODO(B): Add `LayerControlValues.edgeFeatherPx` and `LayerControlValues.compositeMode`.
  In MapLibre these are metadata only; in the shader renderer they become real per-pixel controls.
- RENDER-TODO(C): Add browser performance telemetry for tile decode time, WMS pending-frame age,
  source promotion count, and dropped render frames. FPS alone is not enough.
- RENDER-TODO(D): Prototype Cesium with NASA GIBS WMTS + one ECCC WMS layer before porting vectors.
- RENDER-TODO(E): Implement globe-mesh shader lighting in the new renderer before re-enabling any
  atmosphere/terminator effect. The active MapLibre renderer must not add another screen-space
  day/night overlay.
- RENDER-TODO(F): Add regional satellite compositing: GOES East/West, Meteosat/MTG, Himawari, GIBS
  polar products, each with masks and feathered boundaries.
- RENDER-TODO(G): Remove right-click camera manipulation from MapLibre once OrbitalView exists.
  Right-click should become a context menu/focus action in the WebGL renderer, where camera and
  overlays share one scene graph.
