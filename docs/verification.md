# Verification

CanWxLab treats verification as a first-class feature.

## Current Scaffold

The API exposes `GET /api/verification/summary`, returning deterministic mock metrics for:

- `official_forecast_mock`
- `canwxsim_mock`
- `observed_mock` comparison target

Metrics include MAE, RMSE, bias, lead time, region, variable, and sample count.

## Future Workflow

1. Archive every forecast run with model run time, valid time, lead time, source, grid, and variable metadata.
2. Archive observations with source, station/grid location, time, units, and quality flags.
3. Match forecasts to observations at the same valid time.
4. Compute metrics by variable, lead time, region, source, and weather regime.
5. Publish dashboards for error over time, spatial error maps, reliability diagrams, and event scores.

## Important Distinctions

- Observed reality: stations, radar, satellite-derived products, official alerts.
- Official forecast: ECCC/MSC model output and official forecast products.
- Experimental forecast: CanWxLab model or plugin output.
- Simulation: CanWxSim run output, scenario output, or educational sandbox output.

The UI must label these categories clearly.
