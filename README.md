# CanWxLab

CanWxLab is a local-first Canadian weather and geospatial workbench for visualization, simulation, and verification experiments.

Current status: **Phase 2 - Interactive Weather Workbench UI, Realtime Dev Loop, Layer Engine, and Globe Preview**.

CanWxLab is still not an operational forecast system and does not issue official weather alerts.

## What Is Implemented

- FastAPI backend with `mock`, `live`, and `hybrid` source modes.
- Optional live ECCC/MSC GeoMet ingestion (alerts, stations, hourly observations, collections metadata).
- File-backed HTTP cache with stale-on-failure behavior.
- Source and layer health states: `live`, `mock`, `stale`, `fallback`, `unavailable`.
- React/Vite workbench UI with MapLibre + deck.gl overlays.
- Dense weather/GIS layout:
  - top bar (mode, timeline, map/globe toggle, animation controls, refresh)
  - left sidebar (layers, plugin manager, sources, simulation, verification, customization)
  - right inspector (click values, source metadata, diagnostics, legend)
  - bottom timeline scrubber and loop controls
- Layer engine with persistent local settings:
  - visibility, opacity, colour ramp, ordering, advanced controls
  - map/globe capability labels
- Animated mock/demo weather fields for offline iteration:
  - temperature field
  - radar-like precipitation
  - wind particles
  - cloud overlay
- Plugin manifest discovery (`/api/plugins`) and frontend plugin manager enable/disable state.
- Rust `canwxsim` simulation engine and CLI sample runner.

## Data Modes

Environment variables use the `CANWXLAB_` prefix.

| Variable | Default | Description |
| --- | --- | --- |
| `CANWXLAB_DATA_MODE` | `hybrid` | `mock`, `live`, or `hybrid` |
| `CANWXLAB_ENABLE_LIVE_ECCC` | `false` | enables outbound live ECCC requests |
| `CANWXLAB_ECCC_OGC_API_BASE` | `https://api.weather.gc.ca` | GeoMet OGC API base |
| `CANWXLAB_ECCC_WMS_BASE` | `https://geo.weather.gc.ca/geomet` | GeoMet WMS base |
| `CANWXLAB_HTTP_TIMEOUT_SECONDS` | `10` | backend HTTP timeout |
| `CANWXLAB_CACHE_TTL_SECONDS` | `300` | cache TTL seconds |
| `CANWXLAB_CACHE_DIR` | `.canwxlab/cache` | cache directory |

Mode behavior:

- `mock`: mock adapter only.
- `live`: live adapter only; failures are explicit (`unavailable`/`stale`), no silent mock replacement.
- `hybrid`: live first, then explicit fallback to mock.

See [.env.example](/C:/Users/antis0007/Documents/New%20project/.env.example).

## Quick Start (Windows / PowerShell)

1. Install dependencies:

```powershell
corepack pnpm install
python -m venv services/api/.venv
services/api/.venv/Scripts/python.exe -m pip install -e services/api[dev]
```

2. Start full local dev loop:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

3. Open:

- Web: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- API: [http://127.0.0.1:8787](http://127.0.0.1:8787)
- API Docs: [http://127.0.0.1:8787/docs](http://127.0.0.1:8787/docs)

4. Stop local servers:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-dev.ps1
```

Detailed dev workflow: [docs/development.md](/C:/Users/antis0007/Documents/New%20project/docs/development.md).

## API Endpoints

- `GET /api/sources`
- `GET /api/sources/status`
- `GET /api/layers`
- `GET /api/alerts`
- `GET /api/observations/stations`
- `GET /api/observations/hourly`
- `GET /api/eccc/collections`
- `GET /api/eccc/collections/{collection_id}`
- `GET /api/eccc/wms/capabilities-summary`
- `GET /api/plugins`
- `POST /api/simulations/runs`
- `GET /api/verification/summary`

## Live vs Mock Reality

- Alerts and stations can come from live ECCC if enabled and available.
- Animated radar/wind/cloud/temperature visuals are currently mock/demo fields for interactive UI iteration.
- WMS radar/satellite metadata is present, but full production-grade time animation is next phase work.

## Attribution

Primary official source attribution:

- Environment and Climate Change Canada / Meteorological Service of Canada
- OGC API: [https://api.weather.gc.ca](https://api.weather.gc.ca)
- WMS: [https://geo.weather.gc.ca/geomet](https://geo.weather.gc.ca/geomet)
- Open data reference: [https://eccc-msc.github.io/open-data/readme_en/](https://eccc-msc.github.io/open-data/readme_en/)

## Tile Infrastructure Note

Public OpenStreetMap tiles are acceptable for local development but are not production infrastructure for CanWxLab due policy, rate-limit, and SLA constraints. Production deployments should use owned or contracted map tile infrastructure.

## Next Planned Phase

- Verified ECCC radar/satellite WMS time animation.
- Forecast model metadata ingestion (HRDPS/RDPS/GDPS).
- Stronger renderer abstraction and optional CesiumJS path (still deferred).
