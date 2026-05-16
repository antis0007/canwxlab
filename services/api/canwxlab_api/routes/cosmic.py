"""Cosmic-scope routes — placeholder.

COSMIC-TODO(B/D/E): Wire the adapters below into FastAPI endpoints. Until the adapters land
each endpoint should return ``status="unavailable"`` with a clear message so the frontend
can render a planned-feature placeholder rather than fake data.

Planned routes (see docs/cosmic-scope-roadmap.md §4.1):
    GET  /api/cosmic/ephemeris               — Horizons state vectors window
    GET  /api/cosmic/bodies                  — registry of currently rendered solar-system bodies
    GET  /api/cosmic/sbdb/refresh-status     — SBDB cache freshness
    GET  /api/cosmic/sbdb/{designation}      — one small body
    GET  /api/cosmic/satellites/{group}      — CelesTrak TLE set
    GET  /api/cosmic/star/{hip_id}           — extended astrometry (Hipparcos/Gaia)
    GET  /api/cosmic/exoplanets/{host_name}  — NASA Exoplanet Archive lookup

No router is registered yet. Add ``app.include_router(cosmic.router, prefix="/api/cosmic")``
in ``canwxlab_api.app`` once the first endpoint ships.
"""

from __future__ import annotations
