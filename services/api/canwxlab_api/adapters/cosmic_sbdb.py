"""JPL Small-Body Database adapter — stub.

COSMIC-TODO(D)/(E): Periodically pull orbital elements for asteroids/comets from SBDB
(https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html). Used to render the asteroid-marker
cloud once OrbitalView lands.

Design notes (see docs/cosmic-scope-roadmap.md §3.1):
    - Weekly refresh cadence; cache locally under ``.canwxlab/cache/cosmic/sbdb/``.
    - We do not store every body; persist only what the frontend will draw (numbered minor
      planets up to a configurable magnitude cap; named comets; NEOs).
    - Output schema must include orbital elements (a, e, i, Ω, ω, M₀, epoch) plus enough
      metadata for the UI (designation, name, class, H, diameter estimate, last observed).
    - Provenance preserved.

Public surface (planned):
    refresh_catalogue(limit: int | None = None) -> SbdbCatalogueSummary
    query(designation: str) -> SbdbBody | None
"""

from __future__ import annotations
