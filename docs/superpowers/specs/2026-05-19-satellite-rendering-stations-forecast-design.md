# Design: Satellite Rendering, Station Inspector, Hourly Forecast

**Date:** 2026-05-19  
**Status:** Approved  
**Scope:** Three independent improvements to the canwxlab weather visualization app.

---

## Section 1 — Satellite Rendering (No-Fade, Pyramidal Optical Flow)

### Hard failure criteria

- No perceptible seam or edge between satellite tiles or between satellite feeds at any zoom level.
- Zero fade between frames for satellite OR radar. If imagery must fade out between frames, this is a failure.
- Cloud animation must be smooth and continuous, consistent in direction over several frames.

### Root causes identified

| Bug | Location | Fix |
|-----|----------|-----|
| `crossFadeRaster()` animates opacity 0→1 on WMS tile promotion | `maplibreRaster.ts` | Delete function; instant swap |
| Cross-dissolve fallback `mix(prev, next, t)` when `flowConfidence ≤ 0.25` | `FLOW_FS` shader in `satelliteComposite.ts` | Replace with snap: `t < 0.5 ? prev : next` |
| `MAX_FLOW_UV = 0.05` — only ±12.8 px on 256-px texture; misses large cloud motion | `satelliteComposite.ts` | Increase to `0.25` |
| `FLOW_TEX_DIM = 256` — too low resolution | `satelliteComposite.ts` | Increase to `512` |
| Single-pass 5×5 Lucas-Kanade — insufficient for 5-min frame intervals | `FLOW_FS` shader | Pyramidal 4-scale LK |
| `featherRadiusDeg = 5.0` — too narrow; visible seam at GOES-East/West overlap | `satelliteComposite.ts` | Increase to `15.0` |
| No WebGL context loss handling | `satelliteComposite.ts` | Add `webglcontextlost` / `webglcontextrestored` handlers |

### Pyramidal Lucas-Kanade design

Four pyramid levels (1×, 0.5×, 0.25×, 0.125×). Each level refines the flow estimate from the coarser level. Implemented as multiple sequential GLSL render passes over FBOs:

```
Level 3 (coarsest) → Level 2 → Level 1 → Level 0 (full res)
  ↓ initial estimate   ↓ refine   ↓ refine   ↓ final flow UV
```

Each level pass: standard 5×5 LK window on downsampled texture pair (prev/next frame). Coarser-level UV is upsampled and used as initial warp for the next level.

**Temporal accumulation:** Blend current flow estimate with previous 2 frames at weights `[0.5, 0.3, 0.2]`. This enforces directional consistency over time, satisfying the "consistent flow direction over several frames" requirement.

**Constants after fix:**

```typescript
const FLOW_TEX_DIM = 512;       // was 256
const MAX_FLOW_UV = 0.25;       // was 0.05
const FEATHER_RADIUS_DEG = 15.0; // was 5.0 — wider GOES overlap blend
```

### WebGL context loss

Add `webglcontextlost` listener on the canvas element in `satelliteComposite.ts`. On loss: cancel pending renders, release FBO references. On `webglcontextrestored`: re-create all GPU resources (textures, FBOs, programs) from scratch. State (frame timestamps, flow history) is reset; next frame pair triggers fresh flow computation.

---

## Section 2 — Station Observations & Inspector

### Root cause

`isMeasuredObservation()` in `inspection.ts` rejects any observation with quality flags `"mock"`, `"hourly_mock"`, or `"fallback"`. When ECCC is unavailable, all observations carry fallback flags → filter returns nothing → inspector shows "No live station observation near this point."

The filter was intended to surface data quality — a good goal — but it was incorrectly used as a gate to exclude data entirely, rather than as a quality badge.

### Fix

Replace `nearestMeasuredObservation()` call in `buildHeroMetrics()` with `nearestObservation()` (no filter). Keep `isMeasuredObservation()` for badge color/status only.

Change inspector empty-state message from the unhelpful "Enable live observations or inspect closer to a station" to a contextual message:
- While loading: "Loading observations…"
- When truly empty (no observations at all in state): "No observation data available. Check API connection."
- When point not clicked: "Click the map to inspect a point." (unchanged)

### Open-Meteo gap-fill

New adapter: `services/api/canwxlab_api/adapters/open_meteo.py`

- Endpoint: `https://api.open-meteo.com/v1/forecast?latitude=&longitude=&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,surface_pressure,dew_point_2m`
- No API key required. Free tier sufficient for dev/prod at current scale.
- Called by new route `GET /api/weather/point?lat=&lon=`

**Priority chain for inspector hero metrics:**

1. ECCC station observation, `source_status == "live"` (measured, fresh)
2. Open-Meteo current conditions (NWP model, point-based)
3. ECCC station observation, `source_status == "stale"` (measured, older)
4. ECCC fallback/mock observation
5. Nothing → contextual empty message

All sources carry a `source` badge label in the hero card so the user can distinguish measured from modeled data.

**Variables surfaced in hero cards:**

| Card | Variable | Unit |
|------|----------|------|
| TEMP | `temperature` | °C |
| FEELS | `apparent_temperature` | °C |
| DEW | `dew_point` | °C |
| RH | `relative_humidity` | % |
| WIND | `wind_speed` + `wind_direction` | km/h + bearing |
| MSLP | `surface_pressure` | kPa |
| PRECIP | `precipitation` | mm |

---

## Section 3 — Hourly Forecast UI

### Backend

New endpoint: `GET /api/weather/hourly?lat=&lon=&hours=48`

Merges:
- **Open-Meteo forecast** (primary, 48 h): `temperature_2m`, `relative_humidity_2m`, `apparent_temperature`, `precipitation_probability`, `precipitation`, `weather_code`, `cloud_cover`, `wind_speed_10m`, `wind_direction_10m`, `wind_gusts_10m`, `surface_pressure`, `dew_point_2m`, `uv_index`
- **ECCC recent hourly observations** (past 6 h): replaces Open-Meteo slots in the past with measured values. Slot match on hour boundary.

Response: array of `HourlySlot` objects sorted ascending, each with `source: "observed" | "forecast"`.

### Frontend

**`HourlyForecastPanel` component** (`apps/web/src/components/workbench/HourlyForecastPanel.tsx`)

- Floating, draggable by header (CSS `cursor: grab`, pointer-event drag tracking in React state — no external lib)
- Closable with X button in header
- Initial position: centered horizontally, 120 px from top (below TopBar)
- Position stored in component state (no persistence)

**Layout:**

```
┌─────────────────────────────────────────────── [X] ┐
│ Hourly Forecast — 53.5461° N, 113.4938° W  [badge] │
├──────────────────────────────────────────────────── │
│ ← [15:00] [16:00] [17:00] [18:00] ... [38 h] →    │
│   ☁️       ⛅       🌧️      🌧️                       │
│  18°C     17°C    15°C    14°C                      │
│  ↗12km/h  ↗14     ↙18     ↙22                      │
│  20%💧    25%     80%     85%                       │
└──────────────────────────────────────────────────── ┘
```

Each hourly card: time (local TZ), WMO weather emoji, temperature, wind arrow + speed, precipitation probability.

Cards with `source == "observed"` get a subtle border/background tint to distinguish measured from forecast.

**Trigger:**

- "Hourly" button added to `TopBar.tsx`, right of existing controls
- Clicking opens/toggles panel; panel fetches on open using current map cursor point (falls back to map center)
- Re-fetches when user clicks a new map point while panel is open

**Loading state:** Placeholder skeleton cards (fixed-width, gray shimmer) — no spinner.

**API client:**

```typescript
// apps/web/src/lib/api.ts
weatherPoint(lat: number, lon: number): Promise<WeatherPointResponse>
hourlyForecast(lat: number, lon: number, hours?: number): Promise<HourlyForecastResponse>
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `services/api/canwxlab_api/adapters/open_meteo.py` | Open-Meteo current + forecast adapter |
| `apps/web/src/components/workbench/HourlyForecastPanel.tsx` | Floating hourly forecast UI |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/src/layers/renderers/satelliteComposite.ts` | Pyramidal LK, constants, no-fade snap, context loss |
| `apps/web/src/layers/renderers/maplibreRaster.ts` | Delete `crossFadeRaster()`, instant promotion |
| `apps/web/src/layers/inspection.ts` | `nearestObservation` in `buildHeroMetrics`, better empty state |
| `apps/web/src/components/workbench/RightInspector.tsx` | Updated empty-state message |
| `apps/web/src/components/workbench/TopBar.tsx` | "Hourly" button |
| `apps/web/src/lib/api.ts` | New `weatherPoint()`, `hourlyForecast()` methods |
| `services/api/canwxlab_api/routes/` | New routes `weather/point`, `weather/hourly` |
| `services/api/canwxlab_api/adapters/eccc_geomet.py` | Wire Open-Meteo gap-fill for point queries |
