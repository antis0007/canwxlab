# Stellar Rendering Plan

The current starfield is a useful seed implementation: small bright-star list, GMST-rotated camera
frame, CSS-space click projections, and an info card. It is not the final stellarium engine.

## Required Next Steps

1. Build a star catalog asset pipeline.
2. Load a license-compatible HYG/Gaia-derived catalog lazily.
3. Keep seed/demo stars as a fallback only.
4. Add astrometric transforms tied to the global timeline.
5. Add observer/camera modes: globe backdrop and ground alt-az.
6. Add magnitude, distance, and density caps for performance and clickability.
7. Enrich selected stars through local catalog fields and public deep links.

## Accuracy Work

Future rendering needs:

- RA/Dec epoch awareness.
- Proper motion.
- Precession and nutation.
- Parallax where useful.
- Atmospheric extinction near the horizon for ground mode.
- Sun/Moon/planet positions from ephemeris sources.

## Metadata

Clicking a star should show identifiers, RA/Dec, distance, apparent/absolute magnitude, spectral
type, mass, radius, luminosity, constellation, Bayer/Flamsteed designation, exoplanets where
available, and links to SIMBAD, NASA Exoplanet Archive, Wikipedia, or other public sources.

## Performance

Dense catalogs must be rendered through instancing or another GPU-friendly path after a few thousand
visible stars. Full catalogs should live as data assets or backend caches, not embedded source code.
