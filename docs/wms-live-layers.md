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

`verified_eccc_wms_layers.toml` ships with `verified = false` on every entry as
documentation. The runtime status is always derived from live capabilities,
not from this flag. Before flipping `verified = true`, confirm the candidate
names appear in `GET /api/eccc/wms/layers` against the production GeoMet
endpoint.
