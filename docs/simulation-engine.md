# Simulation Engine

CanWxSim is the experimental simulation core for CanWxLab.

The current engine is a 2D weather sandbox. It is not a production numerical weather prediction model and should not be presented as operational guidance.

## Current 2D State

`ModelState2D` tracks:

- pressure-like height field
- u wind
- v wind
- temperature tracer
- moisture tracer
- cloud water
- accumulated precipitation

## Current Timestep

The first timestep implementation performs:

- pressure-gradient wind acceleration
- approximate upwind tracer advection for temperature and moisture
- simple condensation when moisture exceeds a saturation threshold
- cloud-water conversion to precipitation
- light diffusion and wind damping
- water-field clamping
- NaN/Inf detection
- min/max diagnostics
- crude CFL stability warning

This is intentionally simple so it can be tested and extended.

## What It Does Not Do Yet

- No full 3D fluid dynamics.
- No hydrostatic or nonhydrostatic primitive equation solver.
- No radiation scheme beyond future plugin placeholders.
- No terrain-following vertical coordinates.
- No operational data assimilation.
- No claim of forecast accuracy.

## Growth Path

1. Keep the 2D sandbox stable and well-tested.
2. Add benchmark scenarios for advection, pressure flow, front toy cases, and moisture condensation.
3. Add 2.5D columns with vertical levels, lapse rate, cloud base/top, and precipitation type.
4. Add boundary forcing from official ECCC model grids.
5. Add station/radar/satellite nudging modules.
6. Add nested domains and stronger numerics.
7. Experiment with hydrostatic and nonhydrostatic research cores only after the foundation is verified.

## Diagnostics

Every run should eventually report:

- steps completed
- min/max pressure height
- min/max temperature
- min/max moisture
- max wind speed
- water budget error
- stability warnings
- plugin timing
- source and boundary provenance
