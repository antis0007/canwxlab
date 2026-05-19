# Data Access Policies

Last reviewed: 2026-05-19.

This document records the access constraints for live and planned external data
sources used by CanWxLab. Treat these as implementation requirements, not just
licensing notes.

## Environment and Climate Change Canada / MSC

Sources:

- MSC GeoMet OGC API: `https://api.weather.gc.ca`
- MSC GeoMet WMS: `https://geo.weather.gc.ca/geomet`
- Policy: https://eccc-msc.github.io/open-data/usage-policy/readme_en/
- End-use licence: https://eccc-msc.github.io/open-data/licence/readme_en/

Requirements:

- Display source attribution and preserve licence links.
- Request only data the app uses.
- Contact MSC if usage reaches about 86,400 requests/day, roughly 1 request/s.
- Send a meaningful HTTP User-Agent on server-side HTTP requests.
- Do not send `Cache-Control: no-cache`, `Pragma: no-cache`, or equivalent
  bypass headers by default.
- Do not bulk or batch retrieve WMS tiles.
- Use Datamart and AMQPS for systematic archive or real-time file workflows;
  do not poll Datamart directory listings.

CanWxLab implementation:

- Server-side GeoMet JSON and proxied WMS image requests set
  `CANWXLAB_HTTP_USER_AGENT`.
- GeoMet metadata and capabilities use source-aware TTLs and stale cache
  fallback.
- Concurrent cache misses are coalesced in-process.
- ECCC MapLibre WMS tiles go through `/api/eccc/wms/image`, which caches fixed
  time WMS frames and returns browser cache headers.
- WMS playback requests lower-resolution tiles than settled map viewing.
- Generic OGC feature layers request the current viewport bbox instead of
  unbounded feature lists.

## NASA EOSDIS GIBS

Sources:

- WMTS/TMS tiles: `https://gibs.earthdata.nasa.gov`
- Access docs: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- Earthdata GIBS overview and acknowledgement:
  https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api

Requirements:

- Use the documented WMTS/TMS URL patterns and available tile matrix sets.
- Display NASA GIBS/ESDIS acknowledgement when imagery is shown.
- Prefer daily time keys for daily products; avoid speculative prefetching.

CanWxLab implementation:

- NASA GIBS Blue Marble is the no-key fallback basemap.
- Time-aware MODIS/VIIRS basemaps resolve to T-1 UTC and only restyle when the
  selected day changes.
- Curated GIBS product metadata is static; the app does not poll capabilities.

## CARTO Basemaps

Sources:

- CARTO basemap FAQ: https://docs.carto.com/faqs/carto-basemaps
- CARTO attribution: https://carto.com/attribution/

Requirements:

- CARTO states commercial basemap use needs an Enterprise licence; free
  non-commercial use is for CARTO grantees under their terms.
- Attribution must include CARTO and applicable providers such as
  OpenStreetMap.

CanWxLab implementation:

- CARTO basemaps are optional UI choices, not the default.
- Production deployments should set `VITE_MAP_STYLE_URL` to a licensed or
  self-hosted basemap.

## Esri ArcGIS Online Basemaps

Sources:

- Esri data attribution guidance:
  https://developers.arcgis.com/documentation/glossary/data-attribution/
- Esri basemap citation guidance:
  https://support.esri.com/en-us/knowledge-base/what-is-the-correct-way-to-cite-an-arcgis-online-basema-000012040

Requirements:

- ArcGIS services and content require visible provider attribution.
- World Imagery attribution should credit Esri and listed imagery providers.
- Do not use Esri basemap tiles as an offline tile export path unless the
  relevant Esri product/terms explicitly allow it.

CanWxLab implementation:

- Esri imagery basemaps are optional UI choices, not the default.
- MapLibre attribution remains enabled in the bottom-right map control.

## OpenTopoMap and OpenStreetMap-Derived Tiles

Sources:

- OpenTopoMap usage/attribution: https://services.opentopomap.org/about
- OSMF tile usage policy for `tile.openstreetmap.org`:
  https://operations.osmfoundation.org/policies/tiles/

Requirements:

- OpenTopoMap requires visible attribution to OpenStreetMap, SRTM, and
  OpenTopoMap/CC-BY-SA.
- OSMF tile servers are not general production infrastructure; they require
  attribution, caching, app identification, and no bulk/offline scraping.

CanWxLab implementation:

- CanWxLab does not use `tile.openstreetmap.org`.
- OpenTopoMap is optional and should not be used for bulk/offline prefetch.
- Production deployments should use a licensed provider or self-hosted vector
  tiles.

## CelesTrak

Source:

- GP data guidance:
  https://celestrak.org/NORAD/documentation/gp-data-formats.php

Requirements:

- Do not download a GP group more often than it updates; CelesTrak states GP
  data updates every 2 hours.
- Avoid large repeated downloads and broad group pulls when smaller groups meet
  the need.
- CelesTrak began enforcing one-download-per-update for high-demand groups in
  2026.

CanWxLab implementation plan:

- Future TLE ingestion must cache by group and update epoch, with a minimum
  2-hour refresh interval per group.
- Use narrow groups instead of full catalog downloads.

## JPL Horizons and SBDB

Sources:

- Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html
- SBDB query API: https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html

Requirements:

- Use documented GET/POST parameters and URL encoding.
- Treat 503 as temporary overload or maintenance and retry conservatively.
- Limit SBDB query output with `fields`, filters, and `limit`; do not pull
  full catalogs unless an explicit workflow needs them.

CanWxLab implementation plan:

- Horizons and SBDB routes remain unavailable until adapters ship.
- Future adapters must cache by full query signature, coalesce concurrent
  requests, and keep stale results available with explicit status.

## HYG / AT-HYG Star Catalog

Sources:

- AT-HYG overview and licence:
  https://www.astronexus.com/projects/at-hyg
- HYG details and v4 licence history:
  https://astronexus.com/projects/hyg-details

Requirements:

- HYG v4 and AT-HYG are CC BY-SA 4.0.
- Preserve attribution and share-alike obligations for redistributed derived
  catalog subsets.

CanWxLab implementation:

- The bundled star seed is static and local, so there is no runtime data access
  load.
- Any expanded catalog import should include source, version, and licence
  metadata beside the generated asset.
