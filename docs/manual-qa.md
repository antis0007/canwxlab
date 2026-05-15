# Manual QA Guide for CanWxLab

This guide provides step-by-step instructions for manually testing CanWxLab in different modes and verifying key functionality.

## Prerequisites

- Node.js with corepack enabled
- Python 3.10+ with venv module
- Rust toolchain (cargo)
- PowerShell (Windows) or bash (Linux/macOS)
- Internet connection for live/hybrid mode testing

## Quick Start

### Mock Mode (Offline, Recommended for Initial Testing)

```powershell
# PowerShell
cd c:\dev\canwxlab
scripts/dev-mock.ps1
```

Wait for the output:
```
CanWxLab development URLs:
  API:      http://127.0.0.1:8787
  API docs: http://127.0.0.1:8787/docs
  Web:      http://127.0.0.1:5173
```

### Live/Hybrid Mode (Requires Internet)

```powershell
# PowerShell
cd c:\dev\canwxlab
scripts/dev-live.ps1
```

### Stopping Dev Servers

```powershell
scripts/stop-dev.ps1
```

---

## Test Checklist: Mock Mode

### 1. **App Loads Successfully**

- [ ] Open http://127.0.0.1:5173 in browser
- [ ] Page loads without errors (check browser console, F12)
- [ ] Map appears with base layer
- [ ] Notice row shows "Live ECCC data disabled" or similar

**Expected**: Clean, dense workstation UI loads in ~3-5 seconds.

### 2. **API Health**

- [ ] Open http://127.0.0.1:8787/health
- [ ] Response: `{"status":"ok","service":"canwxlab-api","version":"0.1.0",...}`
- [ ] Run `scripts/check-endpoints.ps1`
- [ ] All endpoints show [PASS] (green)

**Expected**: All 8 endpoints respond with 200 status.

### 3. **Workstation Layout**

- [ ] **Top Bar**: Shows mode/time controls, play/pause, speed slider, source health badge
- [ ] **Left Sidebar**: Tabs visible (Layers, Plugin Manager, Sources, WMS Browser, Camera, Simulation, Verification, Console, Preferences)
- [ ] **Map Area**: Centered on Canada, zoom level 3, interactive
- [ ] **Right Inspector**: Shows coordinates/legend on map click
- [ ] **Bottom Timeline**: Shows frame slider and time display

**Expected**: All panels visible and responsive. No layout glitches.

### 4. **Layer Matrix (Layers Tab)**

- [ ] Layer list loads with ≥6 layers (mock_radar, demo_radar_animation, mock_temperature, etc.)
- [ ] Each layer has:
  - [ ] Toggle checkbox (enable/disable)
  - [ ] Source status badge (green "mock" badge for mock data)
  - [ ] Category chip (radar, satellite, forecast, etc.)
  - [ ] Opacity slider (0–100%)
  - [ ] Up/Down buttons to reorder
- [ ] Toggling a layer on/off updates the map immediately
- [ ] Opacity changes smoothly affect visible layers

**Expected**: Mock layers toggle and opacity controls work instantly. No crashes on layer toggle.

### 5. **Presets**

- [ ] Click **Radar Ops** preset button
- [ ] Only radar and alert layers enable (others disable)
- [ ] Click **Satellite Ops** preset button
- [ ] Only satellite/temperature layers enable
- [ ] Click **All Diagnostics** preset button
- [ ] All layers enable

**Expected**: Presets correctly toggle layer visibility groups.

### 6. **Layer Inspector & Picking**

- [ ] Click on the map at a point with visible data
- [ ] Right inspector updates with:
  - [ ] Coordinates (longitude, latitude)
  - [ ] Nearest layer's legend/color bar
  - [ ] Any station data if visible
- [ ] Legend shows correct units and scale for selected layer

**Expected**: Inspector updates on map click. Color bar matches visible layer.

### 7. **Timeline & Animation**

- [ ] **Bottom timeline**: Frame slider appears
- [ ] Click play (▶) button
- [ ] Animation starts, frame counter increments
- [ ] Adjust **speed slider** (0.5x–2x)
- [ ] Animation speed changes visibly
- [ ] Click pause (⏸) to stop
- [ ] Adjust frame slider manually—map updates

**Expected**: Play/pause, speed, and manual frame scrubbing all work smoothly.

### 8. **Plugin Manager Tab**

- [ ] Plugin list loads (typically 0 in mock, or test plugins if configured)
- [ ] Any installed plugin shows:
  - [ ] Name, version, author
  - [ ] Plugin type (source, layer, physics, etc.)
  - [ ] Safety level badge (CORE, SAFE, RESEARCH)
  - [ ] Enable/disable toggle
- [ ] Toggling a plugin on/off persists (reload and verify it's still set)

**Expected**: Plugin list loads cleanly. Toggle state persists.

### 9. **Sources Tab**

- [ ] All data sources listed:
  - [ ] ECCC/MSC GeoMet WMS
  - [ ] ECCC/MSC GeoMet OGC API
  - [ ] Mock adapter
- [ ] Each source shows:
  - [ ] Status badge (green "mock", gray "unavailable" if live disabled)
  - [ ] Last successful/attempted fetch time
  - [ ] Description and attribution

**Expected**: All sources visible. Status badges match mode (mock has "mock" status in mock mode).

### 10. **WMS Browser Tab**

- [ ] Click **WMS Browser** tab
- [ ] Layers list loads (mock or live data depending on mode)
- [ ] Search box filters layers by name/title
- [ ] Category dropdown filters (radar, satellite, etc.)
- [ ] Checkboxes filter by "Has Time", "Has Legend", "Queryable"
- [ ] Click **Add as Layer** on a WMS layer
- [ ] Layer appears in Layers tab and map (if renderable)
- [ ] Click **Copy URL** to copy WMS GetMap URL to clipboard

**Expected**: WMS browser loads, filters work, adding a layer appears immediately in the layer list.

### 11. **Map Controls Panel**

- [ ] Click **Camera** tab
- [ ] Camera controls show:
  - [ ] Current longitude, latitude, zoom, bearing, pitch
  - [ ] Buttons for Canada preset, US preset, World preset
- [ ] Click a region preset (e.g., "Canada")
- [ ] Map camera animates to that region

**Expected**: Camera controls update on map interaction. Presets move camera smoothly.

### 12. **Simulation Panel**

- [ ] Click **Simulation** tab
- [ ] Shows simulation configuration (domain, duration, timestep)
- [ ] Click **Create Run** button
- [ ] Status updates to "running"
- [ ] After ~5–10 seconds, status changes to "completed" or "failed"
- [ ] If completed, shows run ID and diagnostics summary

**Expected**: Simulation run completes without crashing. Status updates shown.

### 13. **Verification (Diff) Panel**

- [ ] Click **Verification** tab
- [ ] Shows metric configuration (baseline model, comparison model, region, lead time)
- [ ] No errors on panel load

**Expected**: Panel loads without crash. Placeholders visible.

### 14. **Console Panel**

- [ ] Click **Console** tab
- [ ] Logs visible (at minimum: "CanWxLab workstation launched")
- [ ] Severity filter dropdown works (All Levels, Debug, Info, Warn, Error)
- [ ] Subsystem filter dropdown works (All Systems, app, api, wms, layer, etc.)
- [ ] Search box filters logs by message text
- [ ] **Auto-scroll** checkbox toggles auto-scroll behavior
- [ ] **Clear** button clears all logs
- [ ] **Export** button copies logs as JSON to clipboard

**Expected**: Console logs appear as events occur (layer toggle, API fetch, etc.). Filters and search work. Export produces valid JSON.

### 15. **Preferences Tab**

- [ ] Click **Preferences** tab
- [ ] Options visible:
  - [ ] Compact mode toggle
  - [ ] Theme selector (dark, light, system)
  - [ ] Accent color picker
  - [ ] Map background style (default, muted, high-contrast)
  - [ ] Temperature unit (C, F, K)
  - [ ] Wind unit (m/s, km/h, knots)
  - [ ] Pressure unit (hPa, Pa)
  - [ ] Precipitation unit (mm, in)
- [ ] Toggle compact mode—UI compresses
- [ ] Change theme—colors update immediately
- [ ] Change accent color—primary buttons/highlights update
- [ ] Change units—inspector units change on next pick

**Expected**: All preferences apply immediately and persist after reload.

### 16. **Error Resilience**

- [ ] Close API server (leave web server running)
- [ ] Try to refresh data or open console
- [ ] API error logged, UI shows notice: "API unavailable"
- [ ] UI does not crash, still responsive
- [ ] Restart API server
- [ ] Data refreshes automatically or on manual refresh

**Expected**: App handles API loss gracefully. Notice displayed, no crash.

### 17. **Local State Persistence**

- [ ] Enable layer "mock_temperature"
- [ ] Set opacity to 50%
- [ ] Reload page (Ctrl+R)
- [ ] Layer remains enabled at 50% opacity

**Expected**: Layer state persists in localStorage across reload.

---

## Test Checklist: Live/Hybrid Mode

### 1. **Startup & API Health**

```powershell
scripts/dev-live.ps1
```

- [ ] API and web servers start
- [ ] Open http://127.0.0.1:8787/health
- [ ] Open http://127.0.0.1:8787/docs (FastAPI docs)
- [ ] Browse endpoints: `/api/eccc/wms/layers`, `/api/eccc/wms/capabilities-summary`

**Expected**: API docs load. Real WMS endpoints respond.

### 2. **WMS Capabilities Parsing**

- [ ] In API docs, expand `/api/eccc/wms/capabilities-summary`
- [ ] Click **Try it out**
- [ ] Should return:
  ```json
  {
    "source": {
      "status": "live",
      "message": "Live WMS capabilities fetched successfully."
    },
    "layers": [
      {
        "layer_name": "...",
        "title": "...",
        "has_time_dimension": true/false,
        "time_extent": "..." or null,
        ...
      }
    ]
  }
  ```

**Expected**: Capabilities endpoint returns live WMS layer list with ≥10 layers.

### 3. **WMS Browser with Live Layers**

- [ ] Open web UI at http://127.0.0.1:5173
- [ ] Click **WMS Browser** tab
- [ ] Layer list loads (real ECCC WMS layers)
- [ ] Search for "radar"
- [ ] Radar layers appear (e.g., "Radar Precipitation", "Radar Reflectivity")
- [ ] Search for "satellite"
- [ ] Satellite layers appear (e.g., "GOES Visible", "GOES Infrared")
- [ ] Search for "temperature"
- [ ] Temperature layers appear

**Expected**: Live WMS layers discoverable by category. Search works.

### 4. **Add Live WMS Layer to Map**

- [ ] In WMS Browser, find a radar layer
- [ ] Click **Add as Layer**
- [ ] Layer appears in **Layers** tab
- [ ] Layer renders on map (may take 1–2 seconds for first tile)
- [ ] Inspector shows layer as active
- [ ] Toggle layer on/off—map updates

**Expected**: WMS layer renders without crashing. Tile loads correctly.

### 5. **WMS Layer with Time Dimension**

- [ ] Find a WMS layer with "Has Time" checkbox enabled (e.g., radar)
- [ ] Add as layer
- [ ] In **Layers** tab, expand the new layer
- [ ] **WMS Time Policy** section appears (if time dimension found)
- [ ] Policy options: "Global Timeline", "Latest Available", "Fixed Selected Time"
- [ ] Select "Latest Available"
- [ ] Check console—time resolution logged
- [ ] Change to "Fixed Selected Time"
- [ ] Adjust fixed time slider

**Expected**: Time policy option visible for time-aware WMS layers. Policy changes update tile URL.

### 6. **WMS Render Error Handling**

- [ ] Intentionally add a non-existent or bad WMS layer (via API/debug)
- [ ] Tile fails to load (404 or 400 error)
- [ ] Console logs WMS tile error without crashing
- [ ] Layer remains in list but shows error notice

**Expected**: WMS tile errors logged and visible, app stays responsive.

### 7. **Live Data Refresh**

- [ ] Click **Refresh** button in top bar
- [ ] Sources re-fetch, timestamp updates in Sources tab
- [ ] Console logs "Data refreshed successfully"
- [ ] New WMS capabilities parsed and available in browser

**Expected**: Refresh completes in 2–5 seconds. No stale state cached.

### 8. **Verification with Live Metrics**

- [ ] Click **Verification** tab
- [ ] Fetch verification endpoint: `/api/verification/summary`
- [ ] Metrics load (if available) showing model skill scores

**Expected**: Verification endpoint responds. Metrics render if available.

---

## Test Checklist: Failure Modes

### 1. **No Internet Connection**

- [ ] Disconnect network (or disable WiFi)
- [ ] Launch `scripts/dev-mock.ps1`
- [ ] App loads normally (mock mode unaffected)
- [ ] Launch `scripts/dev-live.ps1`
- [ ] After timeout (~10–15 seconds), notice shows "Live source unavailable; showing mock data"
- [ ] UI remains usable with mock data

**Expected**: Mock mode works offline. Live mode gracefully falls back to mock.

### 2. **API Venv Missing**

- [ ] Rename or delete `.venv` directory under `services/api`
- [ ] Run `scripts/dev-api.ps1`
- [ ] Error printed:
  ```
  Missing API virtualenv python: .../services/api/.venv/Scripts/python.exe
  ```

**Expected**: Clear error message. Script exits cleanly.

### 3. **Node Modules Missing**

- [ ] Rename or delete `node_modules`
- [ ] Run `scripts/dev-web.ps1`
- [ ] Error printed:
  ```
  Missing node_modules at repo root. Run 'corepack pnpm install' first.
  ```

**Expected**: Clear error message. Script exits cleanly.

### 4. **WMS Base URL Invalid**

- [ ] Set env var: `CANWXLAB_ECCC_WMS_BASE=http://invalid.local/geomet`
- [ ] Run `scripts/dev-live.ps1`
- [ ] WMS capabilities fetch fails
- [ ] Console logs error, WMS Browser shows "No layers found" or error state
- [ ] App remains usable with mock data

**Expected**: Invalid WMS URL handled gracefully. No crash.

---

## Validation Commands

### Run Full Test Suite

```powershell
# From repo root
scripts/validate.ps1
```

This runs:
- Rust: `cargo fmt --check`, `cargo clippy`, `cargo test`
- Python: `ruff check`, `pytest`
- TypeScript/React: `pnpm test`, `pnpm build`, `pnpm lint`

**Expected**: All steps pass (green [PASS] marks). No [FAIL] output.

### Check Individual Endpoints

```powershell
scripts/check-endpoints.ps1
```

Tests:
- `/health`
- `/api/sources/status`
- `/api/layers`
- `/api/plugins`
- `/api/eccc/wms/capabilities-summary`
- `/api/eccc/wms/layers`
- `/api/verification/summary`
- `/api/simulations/runs`

**Expected**: All show [PASS] in green.

---

## Common Issues & Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Port 5173 already in use | Web server from prior dev session still running | `scripts/stop-dev.ps1` |
| Port 8787 already in use | API server from prior dev session still running | `scripts/stop-dev.ps1` or `lsof -i :8787 \| kill` |
| "corepack is unavailable" | Node.js not installed or corepack not enabled | Install Node.js 16+, run `corepack enable` |
| "cargo is unavailable" | Rust not installed | Install Rust via https://rustup.rs |
| WMS layers not loading | Live mode and WMS base URL invalid or internet down | Check env vars, verify internet, try mock mode |
| Console tab not visible | Older cached JS bundle | Hard refresh (Ctrl+Shift+R) or clear browser cache |
| Layer state not persisting | localStorage disabled in browser | Check browser privacy settings, enable localStorage |

---

## Performance Expectations

- **App startup**: < 5 seconds
- **Map interaction**: Smooth 60 FPS (no visible jank)
- **Layer toggle**: < 200 ms
- **WMS tile load**: 1–3 seconds (depends on network and ECCC server load)
- **API refresh**: 2–5 seconds for all endpoints
- **Zoom/pan**: Instant

---

## Signoff Template

```
Date: YYYY-MM-DD
Tester: [Name]
Environment: Windows 11 / macOS / Linux
Node: v[version]
Python: v[version]
Rust: v[version]

Test Coverage:
[X] Mock mode startup & all 17 mock checks passed
[X] Live mode startup & all 8 live checks passed
[X] Failure modes (no internet, missing venv, invalid URL)
[X] Validation: scripts/validate.ps1 all [PASS]
[X] Endpoints: scripts/check-endpoints.ps1 all [PASS]

Issues Found:
- (list any bugs, visual glitches, performance issues)

Approval: ✓ Ready to ship / ✗ Needs fixes
```

---

For more technical details, see:
- [Development Guide](./development.md)
- [Architecture](./architecture.md)
- [WMS Live Layers](./wms-live-layers.md)
- [Layer Engine](./layer-engine.md)
