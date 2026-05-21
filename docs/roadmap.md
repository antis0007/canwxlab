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

## Phase 3: Live Raster Timeline + Forecast Metadata (In Progress)

- [x] Demo/mock layers gated off in live/hybrid mode (decontamination).
- [x] TOML-driven curated ECCC WMS layer list with exact-match resolution
      against `GetCapabilities` (no keyword fallback).
- [x] WMS base URL surfaced via diagnostics; frontend no longer hardcodes it.
- [x] Low-res fallback basemap clearly badged; `VITE_MAP_STYLE_URL` is the
      production path.
- [x] Verification cases + diff API scaffold (deterministic mock grid).
- [x] Simulation CLI bridge skeleton with `stub`/`cli` modes; failure path
      handled gracefully when the binary is missing.
- [ ] Frontend: render diff overlay (deck.gl grid) from
      `/api/verification/cases/{id}/diff/{field}`.
- [ ] Frontend: poll simulation runs and surface `queued/running/failed`.
- [x] Confirm and flip `verified = true` on curated WMS entries against the
      production GeoMet capabilities document (2026-05-15).
- [x] Curated MSC GeoMet **OGC API — Features** catalog (TOML-driven, exact-
      match resolution) covering alerts, SWOB, climate stations/hourly,
      AQHI obs+forecasts, hydrometric stations/realtime/daily, CLDN lightning,
      and CHC hurricanes.
- [x] Expanded curated WMS list to include HRDPA precipitation analysis,
      GDPS u/v wind & MSLP, RDPS temperature, GIOPS SST, and RIOPS sea ice.
- [ ] Time-dimension animation playback for WMS layers.
- [ ] Forecast model metadata ingestion (HRDPS/RDPS/GDPS).

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

## Phase 8: OSINT Earth + Cosmic Extension (Parallel Track)

CanWxLab is being re-framed as an **OSINT planetary live-view suite** in which Canadian
weather is one of many data layers. The scope expands to include live public-data mobility,
cyberspace, infrastructure, humanitarian/disaster, public attention, satellite/orbital, and
celestial layers. This is a parallel track; the weather phases above continue shipping
independently.

See **[`cosmic-scope-roadmap.md`](./cosmic-scope-roadmap.md)** for the full plan, data-source
contract, coordinate-system pipeline, renderer architecture, phased delivery (A–F), and open
questions.
See **[`global-osint-data-sources.md`](./global-osint-data-sources.md)** for the global source
inventory and adapter backlog.
See **[`non-weather-osint-layers.md`](./non-weather-osint-layers.md)** for the public-data
non-weather layer backlog, product modes, safety rules, and implementation order.

Currently in-flight: **Cosmic-Phase A** — celestial sphere with real bright-star positions,
GMST-rotated camera frame, click-for-OSINT info, exposure controls. The starfield is wired
to the photorealistic globe and tracks the live timeline.

Near-term OSINT Earth additions after Phase A provenance/event hardening:

- Source/Event/Layer model: formal source registry, shared `WorldEvent` schema, provenance,
  source health/freshness overlay, privacy-class badges, and public-data replay archive.
- Decontamination before expansion: fix mock-mode live leakage, source-status drift, and
  blocking simulation paths before adding broad OSINT adapters.
- Mode switcher for Weather, Earth, Cyberspace, Hyperreality, Infrastructure, and Space.
- First public live layers should be civic-operational: Canadian NPAS/CAP alerts, generic CAP
  feeds, 511 road conditions/cameras/incidents, CBSA/CBP border wait times, Canada/openFDA
  recalls, GTFS Realtime transit, energy demand/outages, water advisories, WHO/CDC public-health
  signals, USGS/Earthquakes Canada seismic events, OpenAQ, and radiation monitors.
- Later public live layers: AIS vessels/ports/logistics, GDELT/ReliefWeb/GDACS/Wikimedia/GitHub
  public-information streams, Cloudflare Radar outages, RIPE RIS Live BGP updates, PeeringDB,
  RDAP, CISA KEV, NVD, FIRST EPSS, NASA Black Marble, and orbital/celestial sources.
