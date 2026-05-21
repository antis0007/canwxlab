# OSINT Earth Vision

CanWxLab is an open-source, self-hostable OSINT Earth/weather/cosmic visualization platform. It
starts as a Canadian weather workstation and grows into a live model of Earth and nearby space,
fed by public data streams with visible provenance.

## Priority

Phase 1 is weather and Earth OSINT. MSC GeoMet OGC API/WMS integration is critical and should
receive implementation priority over cosmic rendering. The first production-grade spine is:

- ECCC alerts, observations, station metadata, historical climate, radar, satellite, model grids,
  hydrometric, lightning, AQHI, wildfire/smoke, and Datamart gaps.
- Time-aware WMS and OGC API collection handling.
- Source health, cache state, attribution, and retrieval diagnostics.
- Forecast/simulation verification and reproducible CanWxSim runs.

Cosmic/orbital mode is a major expansion layered onto the same source, cache, timeline, camera,
layer, verification, and plugin concepts.

## Product Character

CanWxLab should feel like a meteorological workstation, GIS/radar operations console, scientific
simulation sandbox, OSINT Earth terminal, and orbital/celestial analysis tool. It should avoid
glossy marketing UI, fake live data, ornamental animation, excessive whitespace, and unsupported
accuracy claims.

## Long-Term Fusion

The long-term system can combine:

- Weather and climate products.
- Satellite and Earth observation imagery.
- Hydrology, fire, smoke, air quality, and infrastructure-adjacent public feeds.
- Live mobility from public or licensed aircraft, vessel, transit, bikeshare, road, and border
  feeds.
- Cyberspace topology and health from public BGP collectors, ASN/prefix registries, RDAP,
  PeeringDB, Cloudflare Radar/IHR-style outage feeds, certificate transparency, and aggregate
  exposure intelligence.
- Hyperreality/public-attention signals from news event graphs, humanitarian reports, disaster
  feeds, public wiki edits, public software activity, and official public alerts.
- Energy and infrastructure feeds for grid load, generation mix, interties, prices, assets,
  public outages, transport hubs, and critical facilities.
- Real star catalogs and ground stellarium mode.
- Horizons/SBDB/MPC/CelesTrak ephemerides and orbital object markers.
- Plugin-provided diagnostics and simulation modules.

Every feed must expose provenance. Operators should know whether a visual is live, cached, stale,
interpolated, seed/planning, simulated, or unavailable.

## Live Control

The main time control should be a familiar app-style Live button/status pill, not a mandatory red
warning element. When the timeline is tracking current observed time, the control is active and
visually distinct. When the operator scrubs into history or forecast time, it becomes secondary;
clicking it jumps back to now and resumes live tracking. Forecast availability remains controlled
by the forecast mode toggle, so returning live does not disable forecast mode.

## Public-Data Boundary

The OSINT pivot is public-data planetary modelling, not surveillance. CanWxLab may ingest public,
licensed, opt-in, aggregate, or user-owned streams. It must not collect private device telemetry,
private communications, private social data, personal movement traces, or data obtained by
bypassing access controls. Cyber layers must favor infrastructure topology, aggregate exposure,
outages, BGP events, and user-owned assets over host-level targeting.

The detailed non-weather layer backlog lives in
[`non-weather-osint-layers.md`](./non-weather-osint-layers.md).

## Risks

- Scope can drown the weather foundation. GeoMet remains first.
- Dense public catalogs can hurt performance. Use assets/caches and caps, not embedded arrays.
- Orbital accuracy is easy to overstate. Use public ephemeris services and label approximations.
- Licensing varies. Catalogs and kernels require explicit license review before vendoring.
- OSINT sources can drift into unsafe product territory. Enforce privacy class, provenance,
  aggregation, and source-terms review before enabling default layers.
