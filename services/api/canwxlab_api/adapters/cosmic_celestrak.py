"""CelesTrak TLE adapter — stub.

COSMIC-TODO(E): Fetch satellite TLEs from CelesTrak (https://celestrak.org/NORAD/elements/gp.php).
Frontend propagates with SGP4 in a web worker.

Design notes (see docs/cosmic-scope-roadmap.md §3.1, §5):
    - Daily refresh; subset by group (stations, weather, science, debris).
    - Cache under ``.canwxlab/cache/cosmic/celestrak/`` keyed by ``(group, date)``.
    - Hand the frontend the raw TLE lines plus a parsed metadata header. SGP4 lives in JS.
    - Honour CelesTrak's request to not poll faster than every couple of hours per group.

Public surface (planned):
    fetch_group(group: str) -> CelestrakTleSet
"""

from __future__ import annotations
