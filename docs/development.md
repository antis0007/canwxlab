# Development Workflow

This project is optimized for local iteration on Windows with PowerShell scripts.

## One-Command Full Dev Loop

From repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1
```

This starts:

- API on `http://127.0.0.1:8787`
- Web on `http://127.0.0.1:5173`
- API docs on `http://127.0.0.1:8787/docs`

`dev.ps1` checks for listeners on dev ports first to avoid duplicate processes.

## Individual Dev Scripts

- API only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-api.ps1
```

- Web only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-web.ps1
```

- Run sample simulation output:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev-sim-sample.ps1
```

- Stop dev servers by port:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stop-dev.ps1
```

## Prerequisites

- Python virtualenv at `services/api/.venv`
- API dependencies installed:

```powershell
services/api/.venv/Scripts/python.exe -m pip install -e services/api[dev]
```

- `node_modules` installed at repo root:

```powershell
corepack pnpm install
```

## Mock / Hybrid / Live Modes

Use `.env` (copy from `.env.example`) or set env vars in shell.

### Mock-first safe local mode

```powershell
$env:CANWXLAB_DATA_MODE = 'mock'
$env:CANWXLAB_ENABLE_LIVE_ECCC = 'false'
```

### Hybrid mode (default)

```powershell
$env:CANWXLAB_DATA_MODE = 'hybrid'
$env:CANWXLAB_ENABLE_LIVE_ECCC = 'false'
```

### Live ECCC mode

```powershell
$env:CANWXLAB_DATA_MODE = 'live'
$env:CANWXLAB_ENABLE_LIVE_ECCC = 'true'
```

If live sources fail in `live`, the API reports unavailable/stale states. If they fail in `hybrid`, fallback is explicit.

## Validation

Run the full local validation script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate.ps1
```

Or run commands individually:

```powershell
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test
services/api/.venv/Scripts/python.exe -m ruff check services/api
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q
corepack pnpm --filter @canwxlab/web test
corepack pnpm --filter @canwxlab/web build
corepack pnpm --filter @canwxlab/web lint
```

## VS Code Tasks

`.vscode/tasks.json` includes:

- Dev: API
- Dev: Web
- Dev: Full
- Test: API
- Test: Web
- Test: Rust
- Validate All

## Iterating With Codex While Servers Run

Recommended loop:

1. Start `scripts/dev.ps1` once and leave it running.
2. Ask Codex to edit backend/frontend files in-place.
3. Keep browser open at `http://127.0.0.1:5173` for visual verification.
4. Use `scripts/stop-dev.ps1` only when you want a clean restart.

Because API and web servers run with reload mode, most code changes apply without manual restarts.

## Troubleshooting

- `Missing API virtualenv python`:
  - create `services/api/.venv` and install API deps.
- `Missing node_modules`:
  - run `corepack pnpm install` from repo root.
- Port in use (`8787` or `5173`):
  - run `scripts/stop-dev.ps1`, then retry.
- Web cannot reach API:
  - ensure API is on `127.0.0.1:8787` or set `VITE_API_BASE_URL`.
- Globe toggle disabled:
  - installed MapLibre build lacks globe projection support; see `docs/globe-rendering.md`.

## Docker

If Docker is installed:

```powershell
docker compose config
docker compose up --build
```

If Docker is not installed locally, continue with the PowerShell scripts above; Docker is optional for this phase.
