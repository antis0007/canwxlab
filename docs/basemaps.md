# Basemaps

## Default behaviour

If `VITE_MAP_STYLE_URL` is unset, the web app loads a **low-resolution public
raster basemap** (CARTO dark) as a development convenience and renders a
"LOW-RES FALLBACK BASEMAP" badge over the map.

This fallback is **not** suitable for production. It conflicts with the
self-hostable / high-quality basemap goal.

## Configuring a real basemap

Set `VITE_MAP_STYLE_URL` to a vector style URL before building the web app:

```
VITE_MAP_STYLE_URL=https://example/style.json
```

Recommended production options:

- **PMTiles** — single-file vector tiles, served as static assets.
- **Self-hosted OpenMapTiles** — proper attribution, no key.
- **MapTiler / Stadia** — managed providers, require a key.

CanWxLab does not ship any commercial keys or hardcoded provider URLs.

## Verifying which basemap is active

- The badge over the map indicates fallback when present.
- `.env.example` documents `VITE_BASEMAP_MODE` as a self-documenting marker
  (`configured` or `fallback`) — purely informational.
