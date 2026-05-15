# MSC GeoMet live data streams

CanWxLab integrates with [MSC GeoMet](https://eccc-msc.github.io/open-data/msc-geomet/readme_en/)
along two surfaces:

- **WMS** (this document) for raster layers — radar, satellite imagery,
  model surface fields, sea ice, etc. See `verified_eccc_wms_layers.toml`.
- **OGC API — Features** for vector feature collections — alerts, surface
  observations (SWOB), AQHI, hydrometric, lightning, hurricanes. See
  `verified_eccc_ogc_collections.toml` and `/api/eccc/ogc/diagnostics`.

Both surfaces use the same pattern: a curated TOML lists exact identifiers,
the runtime probes the live service, and only entries that resolve are
marked available. Adding a new stream is a TOML edit.

# WMS live layers

## How curated ECCC layers work

Curated built-in ECCC WMS layers are defined in
`services/api/canwxlab_api/data/verified_eccc_wms_layers.toml`. Each entry
declares one or more `candidate_layer_names` — the **exact** WMS `Layer.Name`
values to look for in the live `GetCapabilities` document.

At request time the adapter:

1. Fetches `GetCapabilities` (cached, with stale-on-error fallback).
2. For each curated entry, performs **exact-match** lookup (case-insensitive)
   against parsed capabilities.
3. If a candidate is present → the layer is reported with `status=live`/`stale`
   and `wms_layer_name` set to the exact capability name.
4. If none of the candidates are present → the layer is reported as
   `status=unavailable` with a message listing the candidates that were tried.

There is **no** fuzzy keyword matching. A curated layer either resolves to a
real capability name or it is marked unavailable. This avoids silently
"verifying" a fake live layer.

## Enabling live ECCC data

Set in `.env`:

```
CANWXLAB_ENABLE_LIVE_ECCC=true
CANWXLAB_ECCC_WMS_BASE=https://geo.weather.gc.ca/geomet
```

## Inspecting diagnostics

`GET /api/eccc/wms/diagnostics` returns:

- `wms_base_url`
- `last_capabilities_fetch_status`, `cache_status`, `last_error`
- `number_of_parsed_layers`
- `curated_layers.matched[]`, `curated_layers.unmatched[]`

The frontend WMS browser reads `wms_base_url` from this endpoint instead of
hardcoding it. Changing `CANWXLAB_ECCC_WMS_BASE` is reflected in the UI without
editing frontend source.

## Verifying / amending the curated list

The shipped entries in `verified_eccc_wms_layers.toml` have been confirmed
against live GeoMet `GetCapabilities` (2026-05-15) and are marked
`verified = true`. The runtime status is still always derived from live
capabilities at request time, not from this flag — the flag is purely a
documentation hint. When adding new curated entries, hit
`https://geo.weather.gc.ca/geomet?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0`
(or check `GET /api/eccc/wms/diagnostics`) before flipping the flag.
