# Cosmic Scope Roadmap

> **Status: planning / scaffolding only.** This document captures the planetary-/solar-system-scale
> expansion proposed for CanWxLab. It is intentionally separate from `roadmap.md` so the existing
> Canadian-weather workstation phases can keep shipping independently. Nothing here changes the
> non-negotiable behaviour rules in `CLAUDE.md`: live data must stay live, mock must stay labeled,
> offline mode must still work, and we do not claim operational/forecast skill we have not earned.

## 1. Product re-framing

CanWxLab's original frame was "Canadian weather workstation + simulation sandbox." The expanded
frame is **"OSINT planetary live-view suite, with weather as one layer among many."** The vision
is the *Earth* software from *Snow Crash*: a virtual recreation of the planet (and the rest of the
nearby solar system) wired up to as many public live data feeds as can be honestly attributed.

Five view scales are now in scope. Each has its own coordinate system, its own data sources, and
its own UI affordances:

| Scale                  | Default frame              | Camera origin     | Primary data sources                           |
| ---------------------- | -------------------------- | ----------------- | ---------------------------------------------- |
| Surface (map)          | Mercator / globe (ECEF)    | ground            | ECCC GeoMet, OSINT weather feeds               |
| Globe (orbit-of-Earth) | ECEF / topocentric         | LEO–MEO           | weather, satellite, alerts, **celestial sphere** |
| Inner solar system     | Heliocentric J2000 (ICRF)  | mobile            | Horizons, JPL SBDB, planetary ephemerides       |
| Outer solar system     | Heliocentric J2000         | mobile            | Horizons, MPC, comet/asteroid feeds            |
| Deep sky / stellarium  | Inertial (ICRF) or alt-az  | observer or free  | Hipparcos / Gaia DR3 / HYG, NASA Exoplanet Archive |

The user does **not** explicitly switch modes. The renderer chooses the appropriate scale from
camera distance (see §6 "Camera transitions").

## 2. Coordinate-system contract

Build one canonical pipeline and reuse it everywhere; do not let view-mode-specific frames leak
across module boundaries.

```
                           Rz(GMST)            heliocentric rotation
   ECEF (Earth-fixed)  →    ECI/ICRF    →     Heliocentric J2000   →   Barycentric (BCRS)
   ground / weather         stars              planets, asteroids        long-baseline ephemerides
```

- `lib/celestialSphere.ts` already does ECEF → ECI for the starfield. Generalise it.
- Add `lib/ephemeris/` with: J2000 ↔ heliocentric transforms; light-time correction; aberration
  (optional, low priority).
- Pick a single epoch convention: **J2000.0 (TT)** for catalog positions; **UT1 ≈ UTC** for time
  inputs. Proper motion and precession matter for visual stellarium-mode accuracy; defer to a
  precession matrix only when zoom crosses into stellarium scale.

## 3. Data sources (OSINT-only, no hardcoded ephemerides)

> Rule: **no hardcoded positions** for moving bodies. Catalog data (stars, named exoplanet hosts)
> may be embedded because it is effectively static. Anything that moves measurably on human
> timescales must come from a refreshable source. Cache aggressively; never block the UI.

### 3.1 Solar-system bodies

| Source                        | Cadence       | Purpose                                    |
| ----------------------------- | ------------- | ------------------------------------------ |
| **JPL Horizons API** (`ssd.jpl.nasa.gov/api/horizons.api`) | on demand | Authoritative positions for Sun, planets, major moons, named asteroids/comets, spacecraft. Returns vector tables we can interpolate. |
| **JPL SBDB**                  | weekly        | Orbital elements for ~1M small bodies (asteroids, comets). Use for procedurally generating marker clouds. |
| **Minor Planet Center MPCORB**| weekly        | Same domain as SBDB; sometimes fresher. |
| **NASA CNEOS Sentry**         | daily         | Near-Earth-object close-approach feed.    |
| **CelesTrak GP / SatCat**     | daily         | TLEs for satellites, ISS, debris. Render with SGP4. |

### 3.2 Stars / exoplanets

| Source                        | Cadence       | Purpose                                    |
| ----------------------------- | ------------- | ------------------------------------------ |
| **HYG database** (mirror of Hipparcos + Yale BSC) | static (vendored) | ~120k stars to mag 9, full RA/Dec/distance/spectral. Local file, no network. |
| **Gaia DR3 subset**           | static (vendored) | Astrometric refinement for stars closer than ~500 ly. |
| **NASA Exoplanet Archive PSCompPars** | weekly | Confirmed planet list, host-star linkage, mass/radius/period. |
| **SIMBAD** (per click)        | on demand     | Deep-link only; we do **not** scrape. The info card links out. |

### 3.3 Refresh policy

- **Live (sub-hourly)**: ISS/satellite TLEs only (these decay).
- **Daily**: CNEOS, MPC delta updates, exoplanet archive incremental.
- **Weekly**: SBDB full snapshot.
- **Static**: vendored star catalogues.

All non-live sources use a `services/api/canwxlab_api/adapters/cosmic_*.py` module pattern matching
the existing GeoMet adapter. Cache to `.canwxlab/cache/cosmic/` so offline mode still works.

## 4. Ephemeris engine

We have two options. Pick one early; do not mix.

### 4.1 Option A — Server-side cache, client interpolation (recommended)

- API endpoint `GET /api/cosmic/ephemeris?body=mars&start=...&stop=...&step=...` proxies
  Horizons and caches the response on disk.
- Client receives Chebyshev coefficients (or dense state vectors) for a 30-day window centred on
  the current timeline cursor. Refresh when the window drifts.
- Interpolation lives in a small TS module (`lib/ephemeris/interp.ts`).

Pros: shared cache across users; respects Horizons rate limits centrally; deterministic.
Cons: more backend code; we own the cache invalidation.

### 4.2 Option B — Pre-built SPK kernels

- Vendor a slimmed-down SPK kernel (e.g. `de441` for planets) and parse it client-side with a
  WASM port of CSPICE or a hand-rolled Chebyshev reader.
- Asteroid kernels are huge; defer.

Pros: no Horizons round-trips. Cons: 100+ MB of kernels; complex parser; legal review of
NAIF license.

**Decision**: start with Option A. Switch to B only if Horizons turns out to throttle hard.

## 5. Renderer architecture

`MapView` is already a MapLibre + deck.gl + canvas-overlay sandwich. The cosmic scales need a
different renderer entirely (the globe projection breaks down past low orbit and there is no
basemap to wrap). Proposed structure:

```
<MapView>
  <SurfaceLayer />          // MapLibre + deck.gl, mercator/globe (current)
  <Starfield />             // celestial sphere, canvas 2D (existing)
  <OrbitalView />           // NEW: WebGL canvas, scene-graph, log-depth, kicks in past zoom 0
    ├── <SolarSystem />     // sun, planets, named moons; orbital plane reference grid
    ├── <Asteroids />       // procedural marker clouds, LOD by distance
    ├── <Satellites />      // SGP4-propagated points
    └── <DeepSky />         // mag-limited HYG slice; constellation lines (optional)
</MapView>
```

`OrbitalView` should be a Three.js or `regl`-based WebGL component. Logarithmic depth buffer is
essential to avoid z-fighting across the ~1e10 dynamic range from surface to outer planets.

Symbology contract for far-away markers:

| Body class           | Glyph        | Colour     | Min on-screen size |
| -------------------- | ------------ | ---------- | ------------------ |
| Sun                  | filled disc  | #FFE08A    | 6 px (limb)        |
| Terrestrial planets  | filled disc + ring on hover | #B4A48C / #C49060 / #6F88FF (Earth) / #C45A28 | 4 px |
| Gas/ice giants       | striped disc | #C8AB6B / #E6D49F / #8FD0E6 / #4F8FE6 | 5 px |
| Named moons          | diamond      | #A0A0A0    | 3 px               |
| Numbered asteroids   | cross        | #806040    | 2 px               |
| Comets               | comet glyph w/ tail vector | #80E0FF | 3 px               |
| Spacecraft / sats    | triangle     | #80FFB0    | 3 px               |
| Selected body        | reticle      | accent     | always             |

## 6. Camera transitions

The user does not pick a mode. The camera picks it.

- **Zoom 4..18** → SurfaceLayer is primary, OrbitalView hidden.
- **Zoom 0..4** → Globe view, Starfield visible, OrbitalView still hidden.
- **Zoom < 0 (auto-allowed)** → MapLibre is hidden; OrbitalView takes over. The transition
  animates by interpolating camera distance and rolling the basis from ECEF-aligned (north up)
  to ecliptic-aligned (J2000 z-up).
- **At any point** the user can pinch/scroll back in to reverse.

Input contract in OrbitalView:

| Input                         | Action                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| Left drag                     | Orbit around the focus body                                     |
| Middle drag / shift+drag      | Pan the focus point in the current plane                        |
| Wheel                         | Dolly toward focus                                              |
| Right click on body           | Context menu: "Focus", "Lock to this body's orbital plane" (temporary; clears on next manual camera change), "Show info", "Add to verification" |
| Right click on empty space    | Context menu: "Reset to ecliptic", "Jump to date…", "Toggle constellation lines" |
| Double-click body             | Focus + frame                                                   |

The default reference plane is the **ecliptic at J2000**. Orbit-plane locks are *transient*: the
camera follows the body's instantaneous orbital plane for the duration of the gesture, then
releases. This avoids the disorientation of a permanent lock.

## 7. Timeline integration

The existing BottomTimeline maps frame → 5-minute steps over a few hours. Cosmic mode needs a
**second, decoupled** timeline scale-mode:

- Surface/globe mode: hours/days (existing).
- Cosmic mode: years/decades, with logarithmic zoom of the time axis. The same play/pause
  controls drive both; the readout shows the active scale.

Implementation: extend `AnimationPlaybackState` with a `timelineScale: "surface" | "cosmic"` and
a `frameIntervalMs` field. The TimelineMode dropdown already exists; add a "Cosmic" option that
swaps the scale and broadens the loop window.

## 8. Performance ceilings

| Layer                      | Budget                                          |
| -------------------------- | ----------------------------------------------- |
| Starfield                  | ~10k stars @ 60 fps on integrated GPU. Use canvas 2D up to ~3k, regl above. |
| Asteroid marker cloud      | 50k points @ 60 fps via instanced WebGL.        |
| Satellite SGP4             | 2k satellites propagated each frame, 200 visible. Web worker. |
| Ephemeris interpolation    | < 1 ms / frame for ~50 bodies.                  |
| Horizons cache size        | < 50 MB on disk.                                |

## 9. Phased delivery

These are *phases of the cosmic extension*, sitting on top of the existing weather roadmap.

### Cosmic-Phase A — Celestial sphere (in progress)
- [x] Real star positions from embedded bright-star catalogue.
- [x] GMST-based rotation, camera-position-aware projection.
- [x] Star click → OSINT info card with SIMBAD / Wikipedia / Exoplanet Archive links.
- [x] Exposure slider, max-distance cap in UI preferences.
- [ ] Vendor HYG catalogue (~120k stars) as a static asset; load on demand.
- [ ] Constellation line catalogue (Stellarium "western" set, public domain).
- [ ] Per-spectral-type colour tinting (B-V index ramp).

### Cosmic-Phase B — Sun + Earth + Moon in orbital frame
- [ ] Add `/api/cosmic/ephemeris` endpoint backed by Horizons.
- [ ] Disk-cache layer at `.canwxlab/cache/cosmic/`.
- [ ] Render Sun + Moon at correct relative positions in the existing globe scene
      (still inside MapLibre — they appear as celestial sources, not 3D bodies yet).
- [ ] Surface sub-solar point + terminator overlay on the Earth globe (driven by Sun position).

Additional Phase B requirements:

- [ ] Add an ephemeris-window cache contract: fetch vectors for a timeline window, then
      interpolate locally until the camera/time window exits the cached span.
- [ ] Add Earth rotation as a first-class transform, not as a texture animation hack:
      UTC -> GMST -> ECEF/ECI transform -> renderer camera basis.

### Cosmic-Phase C — Inner solar system OrbitalView
- [ ] New WebGL canvas component sibling to MapLibre.
- [ ] Auto-transition at zoom < 0.
- [ ] Sun + 4 inner planets + Earth's moon, drawn at correct heliocentric positions.
- [ ] Reference grid for the ecliptic plane.
- [ ] Middle-click pan, wheel zoom.
- [ ] Rotating textured bodies: Earth, Moon, Mars, Jupiter. Each body needs rotation period,
      pole orientation, prime meridian, axial tilt, and texture provenance.
- [ ] Dynamic LOD: impostor point/sprite at far range, shaded sphere near range, textured
      sphere at inspection range.

### Cosmic-Phase D — Outer planets + named small bodies
- [ ] Add Jupiter–Neptune.
- [ ] Named bodies: Ceres, Vesta, Pluto, 'Oumuamua, current bright comets.
- [ ] Right-click context menu.

### Cosmic-Phase E — Asteroid cloud + satellites
- [ ] SBDB ingest; render numbered asteroids as a marker cloud.
- [ ] CelesTrak ingest; SGP4 web worker; render satellites.
- [ ] CNEOS close-approach overlay.
- [ ] Orbit trails generated from cached elements, not polled positions.
- [ ] Refresh TLE/GP sets on a source-defined cadence and propagate locally every frame.

### Cosmic-Phase F — Ground stellarium mode
- [ ] Observer location (lat/lon) + alt-az camera.
- [ ] Sky dome with horizon line.
- [ ] Planet positions visible from the ground.
- [ ] Time-of-night controls inheriting the cosmic timeline.

## 10. Non-goals (explicit)

- **Not** a research-grade orbital determinator. We trust Horizons / SBDB / MPC; we do not
  re-fit elements from observations.
- **Not** a real-time astronomy data store. We are a viewer + thin OSINT proxy with a cache.
- **Not** a planet-surface simulator (no Mars weather, no lunar topography overlays in v1).
- **Not** a star catalog editor. Read-only.

## 11. Anchor points in code

TODO comments referencing this document are seeded at these locations. Search for
`COSMIC-TODO(<phase-letter>)` to find them:

- `apps/web/src/lib/celestialSphere.ts` — generalising the coordinate transforms (Phase B).
- `apps/web/src/components/Starfield.tsx` — extended catalogue loader, B-V tinting (Phase A).
- `apps/web/src/components/MapView.tsx` — auto-transition gate, OrbitalView mount point,
  middle-click and right-click handlers (Phase C/D).
- `apps/web/src/components/StarInfoCard.tsx` — extended OSINT fields, async fetches (Phase A).
- `services/api/canwxlab_api/adapters/` — new `cosmic_horizons.py`, `cosmic_sbdb.py`,
  `cosmic_celestrak.py` stubs (Phase B/D/E).
- `services/api/canwxlab_api/routes/` — new `cosmic.py` routes module (Phase B).

## 12. Open questions for the operator

These need answers before Phase B starts. Each one is a small decision but pinning them now
prevents thrash later.

1. **Tile/data hosting**: Are we OK with the API server proxying Horizons, or do we want a
   separate Python worker process? (Affects deployment.)
2. **HYG catalogue licensing**: HYG is public domain, but mirrors vary. Vendor from
   the canonical repo and pin a commit hash.
3. **Three.js vs regl**: Three.js is easier to staff for, regl is leaner. I lean Three.js for
   developer ergonomics around camera controllers and post-processing.
4. **Time travel range**: Horizons gives 9999 BCE to 9999 CE. Do we cap the UI at, say,
   1900 – 2100 to keep tick generation sane?
5. **Telemetry**: Any analytics for which bodies users click? (Opt-in only; the project is
   self-hostable.)

## 13. Cesium + Rayleigh atmospheric scattering — deferred plank

**Status: deferred, not started.** Documented here so the scope is known.

### What this plank is

Replace the MapLibre+deck.gl globe path with **CesiumJS** when the user enables the
"photorealistic Earth" preference. Cesium provides:

- WebGL2 globe rendering with proper ellipsoidal Earth (WGS84) and atmosphere shader.
- Built-in Rayleigh + Mie atmospheric scattering (`Scene.skyAtmosphere`).
- True 3D camera (pitch beyond MapLibre's 60°, free orbit).
- Day/night terminator and ground lighting as a first-class scene feature.
- Native cloud layer via `Scene.cloudCollection` (procedural volumetric clouds).
- HDR pipeline, gamma + tonemapping, configurable exposure — the "colour grading"
  required to make the imagery look like a real space photograph.
- Native support for time-aware imagery providers (GIBS, Sentinel).

### Why this is deferred, not a one-turn change

Cesium is a **second renderer**, not a styling tweak:

- Different scene graph (no MapLibre `style`, no deck.gl `MapboxOverlay`).
- Different coordinate system (Cartesian3 ECEF vs lon/lat WGS84 input).
- Every existing layer must be ported: WMS rasters → `UrlTemplateImageryProvider`;
  alerts/stations → `Entity` or `PrimitiveCollection`; diff bitmap →
  `SingleTileImageryProvider` or `RectangleGraphics`.
- deck.gl integration moves to `@deck.gl/cesium`'s `DeckRenderer`.
- Bundle size: Cesium ships at ~3 MB minified before assets.

Estimated scope: **3–6 weeks** of focused engineering for parity with the current
MapLibre experience.

### Proposed path when greenlit

1. **Z-1 scaffolding** — `<CesiumGlobe>` alongside `<MapView>`, chosen via
   `uiPreferences.renderer = "maplibre" | "cesium"`. SkyAtmosphere + real sun
   direction + exposure controls.
2. **Z-2 imagery port** — GIBS true-colour via `UrlTemplateImageryProvider`;
   curated WMS via `WebMapServiceImageryProvider`.
3. **Z-3 deck.gl bridge** — `@deck.gl/cesium`'s renderer; port diff `BitmapLayer`.
4. **Z-4 vector & terrain** — stations/alerts as Cesium Entities;
   `CesiumTerrainProvider` for real terrain.
5. **Z-5 cosmetic polish** — exposure bound to `starExposure`; volumetric clouds
   driven by GIBS cloud fraction; atmospheric haze.
6. **Z-6 verification & cutover** — side-by-side parity QA.

### Until then - current MapLibre ceiling

The MapLibre globe path is intentionally limited to stable imagery and layer composition:

- NASA GIBS MODIS Terra and VIIRS NOAA-20 daily true-colour basemaps (date-aware,
  T-1) — clouds are already in the reflectance itself.
- No active `setSky` atmosphere tuning, directional sun light, or screen-space night-side
  terminator. Those were removed because they produced date-line artifacts and incoherent limb
  lighting.
- Per-layer reprojection skip for flat-grid layers known to glitch on the sphere.

That is the practical ceiling for the current MapLibre path. Photorealistic atmosphere returns only
inside a renderer where the globe mesh, imagery, atmosphere, and camera share one shader pipeline.

## 14. Next-phase implementation contract

The space engine must not poll live sources every animation frame. The data flow is:

1. Source adapter fetches a bounded time window from Horizons, SBDB, MPC, CelesTrak, or other
   official source.
2. Backend stores the raw response plus normalized state vectors/elements in `.canwxlab/cache`.
3. Client downloads a compact window around the current timeline.
4. Web worker propagates or interpolates positions locally.
5. Renderer consumes immutable frame snapshots.
6. Background refresh only happens when the requested time leaves the cache window, the source TTL
   expires, or the user explicitly asks for fresh data.

Required packages/modules:

- `services/api/canwxlab_api/adapters/cosmic_horizons.py`: Horizons vectors and cache.
- `services/api/canwxlab_api/adapters/cosmic_celestrak.py`: GP/TLE/OMM group fetch and TTL cache.
- `services/api/canwxlab_api/adapters/cosmic_sbdb.py`: small-body elements and metadata.
- `apps/web/src/cosmic/ephemeris/`: interpolation, time scales, frames.
- `apps/web/src/cosmic/orbits/`: Kepler propagation and SGP4 worker bridge.
- `apps/web/src/components/OrbitalView.tsx`: WebGL renderer handoff at zoom < 0.
- `apps/web/src/components/PlanetBody.tsx`: rotating textured body primitive.

Open renderer decision:

- Cesium first if the priority is photorealistic Earth quickly.
- Three.js/regl first if the priority is Space Engine style solar-system scale and custom
  atmospheric shaders.
- Do not continue adding heavy SVG/canvas overlays to MapLibre as the photorealistic path.

