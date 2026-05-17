# Celestial Data Sources

This document tracks candidate public sources for real starfield and object metadata work. The
current frontend bright-star list is seed/demo data and is not a complete catalog.

## Star Catalog Strategy

Use a license-compatible catalog asset or local cache, not a large TypeScript source array.

Candidates:

- HYG database for practical nearby/bright star rendering.
- Gaia-derived public catalogs later for deeper starfields.
- Yale Bright Star Catalog or similar only if license-compatible.
- SIMBAD for object deep links and optional lookup enrichment.
- NASA Exoplanet Archive for host/exoplanet metadata.

Required fields where available:

- Proper/common name.
- Catalog identifiers.
- RA/Dec and epoch.
- Distance.
- Apparent magnitude and absolute magnitude.
- Spectral type.
- Mass, radius, luminosity.
- Constellation.
- Bayer/Flamsteed designation.
- Known exoplanets.
- Provenance and license.

## Rendering Requirements

Stars must line up with the real celestial sphere for the selected timeline time and observer/camera
mode. Required future transforms include precession, nutation, proper motion, parallax where useful,
and local alt-az for ground stellarium mode.

## UI Controls

Supported exposure settings:

- extremely dim
- dim
- realistic/default
- bright
- extreme

The default maximum distance should be several hundred lightyears. Catalog loading must also use
practical magnitude/density caps so stars remain clickable and rendering stays fast.

## Non-Goals

- Do not present seed stars as a complete catalog.
- Do not make live SIMBAD/NASA calls in tests.
- Do not hide missing metadata behind invented values.
