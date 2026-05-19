# Basemaps

## Default behavior

If `VITE_MAP_STYLE_URL` is unset, the web app defaults to NASA GIBS Blue Marble.
This avoids making Esri or CARTO the implicit no-key dependency for a fresh
checkout.

The in-app basemap picker still exposes third-party basemaps for development
and comparison. Before enabling those in a public deployment, verify the source
terms in [data access policies](data-access-policies.md).

## Source notes

- NASA GIBS: open, no-key imagery service. Keep NASA GIBS/ESDIS attribution
  visible.
- CARTO: optional only. Current CARTO docs require an Enterprise licence for
  commercial basemap use or a grant for free non-commercial use.
- Esri ArcGIS Online: optional only. Keep ArcGIS/imagery provider attribution
  visible and do not treat it as an offline tile export source.
- OpenTopoMap: optional only. Requires OpenStreetMap/SRTM/OpenTopoMap
  attribution and should not be bulk-prefetched.

## Configuring a production basemap

Set `VITE_MAP_STYLE_URL` to a vector style URL before building the web app:

```text
VITE_MAP_STYLE_URL=https://example/style.json
```

Recommended production options:

- PMTiles served as static assets.
- Self-hosted OpenMapTiles with proper attribution.
- A managed provider such as MapTiler or Stadia with a project-appropriate key.

CanWxLab does not ship commercial basemap keys.
