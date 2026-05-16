"""JPL Horizons ephemeris adapter — stub.

COSMIC-TODO(B): Wrap the Horizons web API (https://ssd.jpl.nasa.gov/api/horizons.api) to fetch
state vectors for the Sun, Moon, named planets and major moons over a configurable window.

Design notes (see docs/cosmic-scope-roadmap.md §3.1, §4.1):
    - Cache responses on disk under ``.canwxlab/cache/cosmic/horizons/`` keyed by
      ``(target_id, center_id, start, stop, step)``.
    - Return dense state-vector tables; let the frontend Chebyshev-interpolate.
    - Respect Horizons rate limits; coalesce concurrent requests in-process.
    - Fail soft: if Horizons is unreachable, surface ``status="unavailable"`` and serve the
      last cached window if any; do not silently substitute mock data.
    - Provenance: keep the raw response text alongside the parsed payload so we can prove
      where every number came from.

Public surface (planned):
    fetch_state_vectors(target: str, center: str, start: datetime, stop: datetime,
                        step: str) -> CosmicEphemeris

This module intentionally has no implementation yet. The route module will return
``unavailable`` until the adapter ships.
"""

from __future__ import annotations
