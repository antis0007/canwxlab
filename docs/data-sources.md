# Data Sources

CanWxLab integrates public Canadian weather/geospatial sources through explicit adapters.

## Official Live Source

Environment and Climate Change Canada / Meteorological Service of Canada GeoMet services:

- OGC API base: [https://api.weather.gc.ca](https://api.weather.gc.ca)
- WMS base: [https://geo.weather.gc.ca/geomet](https://geo.weather.gc.ca/geomet)
- Alternate documented host: [https://geo.meteo.gc.ca/geomet](https://geo.meteo.gc.ca/geomet)

## Integrated GeoMet Collections

- `weather-alerts`
- `climate-stations`
- `climate-hourly`

Phase 1/2 backend endpoints:

- `GET /api/alerts`
- `GET /api/observations/stations`
- `GET /api/observations/hourly`
- `GET /api/eccc/collections`
- `GET /api/eccc/collections/{collection_id}`
- `GET /api/eccc/wms/capabilities-summary`

## Data Modes

- `mock`: deterministic offline data only
- `live`: live adapter only, explicit failure states
- `hybrid`: live-first with explicit mock fallback

## Cache and Failure Policy

Live requests use `httpx` + file JSON cache:

- deterministic key from URL + params
- cache entry includes `retrieved_at`, `expires_at`, `source_url`, `payload`
- stale cache may be used when live fetch fails
- hybrid fallback is explicit (`fallback`)
- server-side requests send a configurable `CANWXLAB_HTTP_USER_AGENT`
- concurrent cache misses for the same URL/params are coalesced
- GeoMet catalog/capabilities requests use longer source-aware TTLs than
  rapidly changing observation collections
- ECCC WMS image tiles are proxied through `/api/eccc/wms/image` for headers,
  disk cache, browser cache headers, and stale-on-error fallback

## Phase 2 Visual Layer Reality

### Real/official-capable data paths

- alerts vector data (when live enabled/available)
- climate stations/hourly observations (when live enabled/available)
- WMS capabilities summary

### Mock/demo visualization layers

- animated radar-like precipitation
- animated wind particles
- animated temperature field
- animated cloud overlay

These are intentionally labeled `MOCK/DEMO` and are for UI iteration, not operational weather products.

## Attribution and Policy

- Preserve source attribution and optional license links.
- Do not present CanWxLab as official alert issuer.
- Do not scrape websites when official APIs exist.
- Keep experimental/simulation outputs clearly separated from observed/official feeds.
- Follow [data access policies](data-access-policies.md) before adding a source
  or raising request volume.

## Tile Infrastructure Note

Public OpenStreetMap tiles are suitable for development but are not production infrastructure due policy, rate-limit, and SLA constraints.

## Next Data Phase

- Verified radar/GOES WMS time animation
- Forecast model metadata ingestion for HRDPS/RDPS/GDPS catalogs
