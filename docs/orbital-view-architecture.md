# Orbital View Architecture

`OrbitalView` is the planned sibling renderer for scales where MapLibre/deck.gl is no longer the
right surface-weather tool. It should not replace the weather map. MapLibre remains the surface and
whole-Earth weather renderer.

## Scale Model

Planned scales:

- `surface`: operational weather workstation.
- `globe`: whole-Earth weather and starfield backdrop.
- `near-earth`: Moon, satellites, and low/medium/high Earth orbit context.
- `inner-solar-system`: Sun, Mercury, Venus, Earth, Mars, selected small bodies.
- `outer-solar-system`: outer planets and major moons.
- `deep-sky`: stellar catalog and far markers.

The app should enter cosmic mode automatically only after zoom/camera state clearly leaves useful
surface weather operation.

## Coordinate Pipeline

- WGS84 lon-lat-alt.
- ECEF.
- ECI.
- Heliocentric J2000/ecliptic.
- Barycentric/BCRS later if justified.
- Local horizontal alt-az for ground stellarium.
- Display transforms for `OrbitalView`.

The default orbital plane is Earth's orbital plane around the Sun. Future right-click locks should
support Earth orbital plane, selected planet orbital plane, ecliptic, equatorial, and selected object
frame. Temporary locks expire unless explicitly persisted.

## Data Model

Orbital positions come from public sources:

- JPL Horizons state vectors.
- JPL SBDB and Minor Planet Center metadata.
- CNEOS near-Earth object context.
- CelesTrak TLEs for satellites.
- Public SPICE/SPK kernels only after packaging/license review.

The API must distinguish live fetched, cached, interpolated, approximated, seed, and unavailable
states. No hardcoded real-time orbital positions.

## Renderer Decision

Candidate engines: Three.js, regl, raw WebGL, or Cesium. Decide after testing:

- Log-depth precision across solar-system scales.
- Instanced marker and label performance.
- Integration with React and existing workbench state.
- Picking and context-menu support.
- Bundle size and maintenance cost.

## Input Contract

- Middle-click drag: pan in current plane.
- Left mouse: orbit/focus as appropriate.
- Right-click: transient plane lock and object context menu.
- Double click later: focus selected object.
- Markers and labels: scale-aware and visible at far distances.

## Implementation Seams Already in the Codebase

The following anchors mark where OrbitalView should hook in. They are intentionally small
so the surface weather workstation keeps working until the renderer is ready.

- `apps/web/src/layers/types.ts`
  - `cosmicScaleFromZoom(zoom)` — single source of truth for the MapLibre → OrbitalView gate.
    Map a live camera zoom to one of `surface | globe | near-earth | inner-solar-system |
    outer-solar-system | deep-sky`.
  - `OrbitalCameraMode`, `OrbitalViewMode`, `CosmicScale` types persisted in
    `UiPreferences` for later UI binding.
  - `EphemerisWindow` interface mirrors the planned `/api/cosmic/ephemeris` response shape.
  - `TimelineScale` lists the planned time scales (`weather | archive | orbital | astronomical`).
- `apps/web/src/components/MapView.tsx`
  - `updateLiveCamera` — call site where the cosmic-scale transition should be checked on
    every move/moveend.
  - `ORBITAL-TODO` anchors near the Starfield mount mark where middle-click pan and
    right-click plane lock handlers belong.
- `services/api/canwxlab_api/routes/cosmic.py`
  - `/api/cosmic/status`, `/api/cosmic/sources`, `/api/cosmic/objects/seed`,
    `/api/cosmic/ephemeris` — planning contracts that the OrbitalView renderer can target
    today without any live ephemeris fetch.
- `services/api/canwxlab_api/adapters/cosmic_horizons.py`,
  `cosmic_sbdb.py`, `cosmic_celestrak.py` — placeholder adapters ready to be implemented
  behind the planning routes above. Each should write its cache under
  `.canwxlab/cache/cosmic/<source>/`.
