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
- Real star catalogs and ground stellarium mode.
- Horizons/SBDB/MPC/CelesTrak ephemerides and orbital object markers.
- Plugin-provided diagnostics and simulation modules.

Every feed must expose provenance. Operators should know whether a visual is live, cached, stale,
interpolated, seed/planning, simulated, or unavailable.

## Risks

- Scope can drown the weather foundation. GeoMet remains first.
- Dense public catalogs can hurt performance. Use assets/caches and caps, not embedded arrays.
- Orbital accuracy is easy to overstate. Use public ephemeris services and label approximations.
- Licensing varies. Catalogs and kernels require explicit license review before vendoring.
