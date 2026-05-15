# MSC GeoMet OGC API collections

Curated MSC GeoMet OGC API — Features collections are declared in
`services/api/canwxlab_api/data/verified_eccc_ogc_collections.toml`.

## What's curated today

| layer id                     | GeoMet collection_id        | category    |
|------------------------------|-----------------------------|-------------|
| `eccc_weather_alerts`        | `weather-alerts-realtime`   | alert       |
| `eccc_swob_realtime`         | `swob-realtime`             | observation |
| `eccc_climate_stations`      | `climate-stations`          | observation |
| `eccc_climate_hourly`        | `climate-hourly`            | observation |
| `eccc_aqhi_realtime`         | `aqhi-observations-realtime`| observation |
| `eccc_aqhi_forecasts`        | `aqhi-forecasts-realtime`   | forecast    |
| `eccc_hydrometric_stations`  | `hydrometric-stations`      | observation |
| `eccc_hydrometric_realtime`  | `hydrometric-realtime`      | observation |
| `eccc_hydrometric_daily`     | `hydrometric-daily-mean`    | observation |
| `eccc_lightning_strikes`     | `lightning-realtime`        | observation |
| `eccc_hurricane_realtime`    | `hurricanes-realtime`       | alert       |

## How resolution works

At runtime the adapter:

1. Hits `GET <ogc_api_base>/collections`.
2. For each curated entry, performs **exact-match** on `collection_id`
   (case-insensitive) against the parsed list.
3. Matched entries are surfaced through `/api/layers` with status derived
   from the live OGC source.
4. Unmatched entries are returned with `status=unavailable` and a message
   stating the curated `collection_id` was not present.

No fuzzy/keyword matching. No silent fake live status.

## Endpoints

- `GET /api/eccc/ogc/curated` — curated config only (no live probe).
- `GET /api/eccc/ogc/diagnostics` — curated entries vs live `/collections`
  with `matched[]` / `unmatched[]`.
- `GET /api/eccc/collections` — pass-through to live `/collections`.

## Adding a new GeoMet data stream

1. Append a `[[collection]]` block to the TOML with the exact GeoMet
   `collection_id`.
2. Restart the API.
3. Confirm via `/api/eccc/ogc/diagnostics` that the entry appears under
   `curated.matched`.
4. Flip `verified = true` in the TOML.

This is the single-edit path to adding any MSC GeoMet vector feed.
