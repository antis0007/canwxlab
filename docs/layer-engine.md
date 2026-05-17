# Layer Engine

Phase 2 expands the frontend layer registry into a stateful layer engine.

## Core Files

- `apps/web/src/layers/types.ts`
- `apps/web/src/layers/registry.ts`
- `apps/web/src/layers/layerEngine.ts`
- `apps/web/src/layers/colorRamps.ts`
- `apps/web/src/layers/legends.ts`
- `apps/web/src/layers/animation.ts`
- `apps/web/src/layers/renderers/*`

## LayerDefinition Contract

Each layer definition includes:

- identity: `id`, `title`, `description`, `sourceId`
- classification: `category`, `rendererType`
- state/status: `status`, `isBuiltIn`, `isPlugin`, `isExperimental`
- defaults: `defaultVisible`, `defaultOpacity`, `zIndex`
- visual metadata: `colourRamp`, `legend`
- capabilities:
  - `supportsMap`
  - `supportsGlobe`
  - `supportsAnimation`
  - `supportsPicking`
  - `supportsShader`
  - `supportsWms`
  - `supportsCustomColorRamp`
  - `supportsOpacity`
- animation config (`frameCount`, interval, loop)
- control values:
  - `min`, `max`, `smoothing`
  - `particleCount`, `windScale`
  - `precipitationIntensity`, `cloudOpacity`
  - `contourInterval`, `blendMode`

## Persistent Runtime State

`useLayerEngine` persists to localStorage:

- enabled/disabled per layer
- opacity
- selected colour ramp
- control values
- order (up/down)
- plugin enabled state
- UI preferences (compact mode, theme, units, accent)

Storage keys:

- `canwxlab.layerState.v9`
- `canwxlab.layerOrder.v9`
- `canwxlab.pluginEnabled.v2`
- `canwxlab.uiPrefs.v4`

Layer order is stored bottom-to-top. Active layers preserve that order all the way into the
renderers. Moving a layer "up" moves it toward the visual top of the stack; moving it "down" moves
it toward the basemap. WMS layers are reinserted in MapLibre to match the active stack, and the
legend follows the top active layer.

## Built-in Demo Layers

Added for visual iteration without live dependencies:

- `demo_temperature_field`
- `demo_radar_animation`
- `demo_wind_particles`
- `demo_clouds`

These are clearly marked `MOCK/DEMO`.

## Renderer Split

- `deckGrid.ts`: grid/polygon style filled weather fields
- `deckParticles.ts`: animated wind path particles
- `deckVector.ts`: alerts/stations overlays
- `maplibreRaster.ts`: WMS raster source/layer synchronization
- `mockWeatherFields.ts`: deterministic mock field generation and point sampling

Current blend-mode caveat: the layer contract exposes `blendMode`, but MapLibre raster layers do
not support general per-pixel compositing or footprint feathering. Those controls become real
shader controls in the planned Cesium/Three/regl renderer. In the current renderer, WMS layers use
opacity and load-gated double buffering only.

The layer engine now feeds a normalized `RenderLayerPlan[]` into the active renderer. WMS defaults
to `latest`; users must explicitly choose `Global Timeline` or `Fixed Time` before MapLibre follows
the workbench timeline for WMS-T.

## WMS Preparation

`apps/web/src/lib/wms.ts` defines `WmsLayerDefinition` and helpers:

- `toWmsLayerDefinition`
- `buildWmsGetMapTemplate`
- `buildMapLibreWmsSource`
- `canRenderWmsLayer`

WMS layers render only when status and metadata are sufficient (verified layer name + live/stale status).
