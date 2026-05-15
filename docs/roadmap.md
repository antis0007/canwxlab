# Roadmap

## Phase 0: Data and Map Spine (Complete)

- Stable API contracts
- Canada-focused map shell
- Mock source/layer plumbing
- Initial layer registry and inspector
- CanWxSim sandbox crate

## Phase 1: Live ECCC Data Spine (Complete)

- Optional `mock/live/hybrid` mode selection
- Live-capable ECCC GeoMet adapter
- Alerts, station, and hourly ingestion
- Source/layer health model (`live/mock/stale/fallback/unavailable`)
- File-backed cache with stale-on-failure behavior
- WMS capabilities summary and layer metadata placeholders

## Phase 2: Interactive Weather Workbench (Complete)

- One-command Windows dev loop (`scripts/dev.ps1`)
- Dense workbench UI layout (top/left/right/bottom panels)
- Map/globe toggle with graceful unsupported state
- Layer engine refactor with persisted runtime controls
- Animated mock/demo weather layers (radar, wind, temperature, clouds)
- Plugin manifest discovery API and frontend plugin manager
- Inspector and render diagnostics upgrades

## Phase 3: Live Raster Timeline + Forecast Metadata (Next)

- Verified ECCC radar and GOES WMS layer mapping
- Time-dimension animation playback for WMS layers
- Forecast model metadata ingestion (HRDPS/RDPS/GDPS)
- Richer legend and provenance wiring for operational-like timelines

## Phase 4: Historical Archive

- Rolling local archive policies
- Station history browser
- Historical replay timeline and export tools

## Phase 5: Verification Lab Expansion

- Forecast archive + observation pairing
- MAE/RMSE/bias/event score expansion
- Reliability diagnostics and regional leaderboards

## Phase 6: Plugin Runtime

- Safe execution model (WASM + gated native research mode)
- Plugin compatibility matrix and reproducibility checks
- Benchmark scenarios for plugin outputs

## Phase 7: Research-Grade Modelling

- Nested domains
- Advanced dynamics/physics options
- GPU acceleration where justified
- Bridges to external model ecosystems where licensing permits
