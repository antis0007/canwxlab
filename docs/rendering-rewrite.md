# Rendering Rewrite

Status: transitional implementation. MapLibre remains the active renderer, but it now consumes a
normalized render plan instead of raw UI state.

## Renderer Boundary

Renderer kinds are:

- `maplibre-2d`
- `maplibre-globe`
- `earth-webgl`

The boundary owns camera normalization, layer lifecycle, layer ordering, animation frame scheduling,
tile/source cache policy, picking/inspection inputs, context-menu events, telemetry, and disposal.
React components should build state and user intent, not mutate MapLibre sources directly.

`apps/web/src/layers/renderPlan.ts` converts active layer definitions and runtime state into
`RenderLayerPlan[]`:

- deterministic bottom-to-top `order`
- renderer type
- opacity and blend metadata
- WMS time policy: `latest`, `timeline`, or `fixed`
- resolved WMS time
- source status and source metadata
- renderer priority

MapLibre WMS rendering consumes this plan in `maplibreRaster.ts`. Future `earth-webgl` work should
consume the same plan and implement shader-native raster compositing, footprint feathering, and
timeline tile caches.

## WMS Runtime

WMS defaults to `latest`. Timeline-following WMS requests only happen when the user chooses
`Global Timeline`; fixed requests only happen when the user chooses `Fixed Time`.

Raster frames are double-buffered:

- keep the current frame visible
- load a pending frame as an invisible raster layer
- promote only after source readiness or a short controlled timeout
- never promote a pending source that emitted a MapLibre tile/source error
- during playback, keep one pending frame per layer and skip additional frame requests if loading
  cannot keep up

Telemetry exposed to the inspector includes pending, promoted, and failed raster frames plus the
last source error.

## Camera And Input

Camera state is normalized before it is emitted or applied. Globe mode clamps pitch and bearing to
zero because MapLibre globe is a limited transitional renderer and deck/DOM overlays are separate
systems. Right-click opens the context menu; it is not a camera gesture.

Context menu actions are renderer-agnostic user intents:

- inspect here
- center here
- copy coordinates
- pin marker
- toggle nearest station details
- show active layer stack
- reset view

## Inspection

`apps/web/src/layers/inspection.ts` builds the inspector payload. It combines:

- lon/lat
- nearest station and station temperature, pressure, wind, and time
- active alert summary
- sampled mock/demo temperature, pressure, radar/precipitation, wind, and clouds where applicable
- active WMS layer metadata and resolved time
- derived Day Cloud Phase / Night Microphysics RGB classification when the product is active and
  a safe composite pixel sample is available

The Day/Night Microphysics classification is qualitative. NOAA's guide says the combined product
uses Day Cloud Phase Distinction in daylight and Nighttime Microphysics at night; interpretation is
affected by solar angle, latitude, season, and surface/cloud transparency. The inspector labels this
as `derived` and does not treat it as a direct precipitation measurement.

Primary references:

- NOAA Day/Night Cloud Micro Combo quick guide:
  https://goes.noaa.gov/documents/ABIQuickGuide_DayNightCloudMicroCombo.pdf
- NOAA GOES-R Cloud Phase product:
  https://www.goes-r.gov/products/baseline-cloud-phase.html

## Remaining Limitations

- MapLibre cannot do colour-space aware per-pixel compositing or true blend modes between WMS
  sources. `blendMode` is metadata until `earth-webgl`.
- Composite pixel reads sample the current rendered canvas, not an isolated WMS tile. If browser or
  GPU security prevents reading the pixel, the inspector reports the microphysics layer as active
  but unsampled.
- No atmosphere, terminator, or date-line visual hack is reintroduced. Physical atmosphere returns
  only when a globe mesh, imagery, lighting, and camera are in one shader pipeline.

## Rayleigh / Atmospheric Scattering: NOT implemented

There is no Rayleigh scattering, Mie scattering, or physical sky model in the current
build. The previous screen-space "atmosphere" overlay was removed because it was
inaccurate at the limb, fought the basemap z-buffer, and made the day/night seam
visibly broken. We have **not** added a replacement in this rewrite.

The reason is deliberate: doing Rayleigh correctly requires the renderer to own
the globe mesh, the camera, the sun position, and the imagery in a single shader
pipeline so the in-scatter / out-scatter integrals can be evaluated per pixel
against the actual surface depth. MapLibre's globe projection draws the basemap
as a textured sphere we do not control, so any overlay we add on top is fighting
its compositor instead of participating in it.

A `Starfield` canvas does paint a low-amplitude blue halo around the apparent
limb when `photorealistic globe` is enabled — that is a 2D radial gradient on a
sibling canvas, not scattering. It exists only to soften the otherwise hard
black outline of the sphere; it does not vary with sun angle, altitude, view
direction, or wavelength.

Physical Rayleigh + Mie is on the roadmap as part of the `earth-webgl`
renderer (`docs/orbital-view-architecture.md`, `docs/cosmic-scope-roadmap.md`).
Until that renderer exists, the workbench will not pretend to have an
atmosphere.

## Workstation UI Layer (post-rewrite)

The rewrite intentionally kept the React shell thin. The post-rewrite UI layer
adds the parts a power-user/meteorologist workbench needs without coupling them
to the renderer:

- `useResizableWidth` for the left/right sidebars (persists to `localStorage`).
- `DraggablePanel` for floating sub-popups; `StarInfoCard` and `CityPicker`
  both consume it. Positions persist per panel key.
- `TimeZoneSelector` in the top bar — `lib/timezone.ts` is the single source
  of truth and is threaded through TopBar, BottomTimeline, and RightInspector
  so every timestamp in the workstation honours the operator's chosen IANA
  zone. The selection persists across sessions.
- `CityPicker` (curated world catalog of ~80 cities) jumps the camera, shows a
  quick-weather snapshot from the nearest observation, and offers a one-click
  adopt-this-city's-timezone action.
- The animation timeline now opens **paused at the latest frame ("now")** so a
  fresh tab does not burn fetches/cycles before the operator has even chosen a
  layer stack.
- Performance: the device-pixel-ratio cap dropped to 1.5 (from 2.0) to keep
  fill cost sane with multiple concurrent WMS rasters; the WMS sync effect is
  now keyed on a compact signature instead of the full render-plan reference,
  so it no longer re-fires on every `globalTimeMs` tick when nothing relevant
  changed.
