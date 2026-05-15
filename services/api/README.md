# CanWxLab API

FastAPI backend for CanWxLab weather sources, layer metadata, alerts, stations, simulation runs, verification summaries, and plugin manifest discovery.

## Phase 2 Status

Backend remains the Phase 1 data spine with these Phase 2 additions:

- Plugin manifest discovery route: `GET /api/plugins`
- Manifest validation via Pydantic without plugin code execution
- Malformed manifest reporting via structured errors

## Local Development (PowerShell)

```powershell
python -m venv services/api/.venv
services/api/.venv/Scripts/python.exe -m pip install -e services/api[dev]
services/api/.venv/Scripts/python.exe -m uvicorn canwxlab_api.main:app --host 127.0.0.1 --port 8787 --reload --app-dir services/api
```

Or from repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-api.ps1
```

## Configuration

All settings use `CANWXLAB_` prefix.

| Variable | Default | Notes |
| --- | --- | --- |
| `CANWXLAB_DATA_MODE` | `hybrid` | `mock`, `live`, `hybrid` |
| `CANWXLAB_ENABLE_LIVE_ECCC` | `false` | enables live GeoMet requests |
| `CANWXLAB_ECCC_OGC_API_BASE` | `https://api.weather.gc.ca` | OGC API base |
| `CANWXLAB_ECCC_WMS_BASE` | `https://geo.weather.gc.ca/geomet` | WMS base |
| `CANWXLAB_HTTP_TIMEOUT_SECONDS` | `10` | `httpx` timeout |
| `CANWXLAB_CACHE_TTL_SECONDS` | `300` | default TTL |
| `CANWXLAB_CACHE_DIR` | `.canwxlab/cache` | file cache root |

Mode behavior:

- `mock`: mock adapter only.
- `live`: live adapter only with explicit `unavailable/stale` status on failures.
- `hybrid`: live first, mock fallback with explicit `fallback` status.

## Key Endpoints

- `GET /api/sources`
- `GET /api/sources/status`
- `GET /api/layers`
- `GET /api/alerts?bbox=minLon,minLat,maxLon,maxLat&limit=100`
- `GET /api/observations/stations?bbox=...&limit=100`
- `GET /api/observations/hourly?bbox=...&limit=100`
- `GET /api/eccc/collections`
- `GET /api/eccc/collections/{collection_id}`
- `GET /api/eccc/wms/capabilities-summary`
- `GET /api/plugins`
- `POST /api/simulations/runs`
- `GET /api/verification/summary`

## Source/Layer Status Contract

Core health fields include:

- `status`: `live | mock | stale | fallback | unavailable`
- `source_id`, `name`, `adapter`
- `last_successful_fetch`, `last_attempted_fetch`
- `retrieved_at`, `expires_at`
- `attribution`, optional `license_url`
- `message`, optional `error_type`
- `is_live`, `is_experimental`

## Cache Behavior

Live fetches use a deterministic file-backed JSON cache with:

- cache key from URL + params
- `retrieved_at`, `expires_at`, `source_url`, `payload`
- structured logs:
  - `cache_hit`
  - `cache_miss`
  - `live_fetch_success`
  - `live_fetch_failed`
  - `stale_cache_used`

## Plugin Manifest Discovery

`GET /api/plugins` scans `plugins/**/plugin.toml` and returns:

- normalized plugin catalog entries
- status (`installed`, `disabled`, `incompatible`, `error`)
- built-in flags and contribution hints
- parse/validation errors for malformed manifests

Important: plugin discovery never executes plugin code.

## Testing

```powershell
services/api/.venv/Scripts/python.exe -m ruff check services/api
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q
```

Tests do not require internet.

## Attribution

- Environment and Climate Change Canada / Meteorological Service of Canada
- [https://api.weather.gc.ca](https://api.weather.gc.ca)
- [https://geo.weather.gc.ca/geomet](https://geo.weather.gc.ca/geomet)
- [https://eccc-msc.github.io/open-data/readme_en/](https://eccc-msc.github.io/open-data/readme_en/)
