from canwxlab_api.adapters.eccc_geomet import (
    _resolve_curated_layer,
    build_wms_curated_diagnostics,
    load_verified_eccc_wms_layers,
)
from canwxlab_api.models import WmsCapabilityLayerSummary


def _layer(name: str) -> WmsCapabilityLayerSummary:
    return WmsCapabilityLayerSummary(
        layer_name=name,
        title=name,
        queryable=False,
        styles=[],
        crs=["EPSG:4326"],
        has_time_dimension=False,
        time_extent=None,
    )


def test_resolve_exact_match_case_insensitive():
    parsed = {"radar_1km_rrai": _layer("RADAR_1KM_RRAI")}
    result = _resolve_curated_layer(parsed, ["radar_1km_rrai"])
    assert result is not None
    assert result.layer_name == "RADAR_1KM_RRAI"


def test_resolve_no_match_returns_none():
    parsed = {"some_other_layer": _layer("some_other_layer")}
    result = _resolve_curated_layer(parsed, ["RADAR_1KM_RRAI", "GDPS.ETA_TT"])
    assert result is None


def test_resolve_substring_does_not_match():
    # "RADAR_1KM_RRAI" must not match a parsed layer like "rrai_subset"
    parsed = {"rrai_subset": _layer("rrai_subset")}
    result = _resolve_curated_layer(parsed, ["RADAR_1KM_RRAI"])
    assert result is None


def test_load_verified_layers_has_entries():
    entries = load_verified_eccc_wms_layers()
    assert isinstance(entries, list)
    # Config ships with at least one curated entry
    assert any(e.get("id") == "eccc_radar_1km_rrai" for e in entries)


def test_build_diagnostics_marks_unmatched():
    diag = build_wms_curated_diagnostics([])
    assert diag["matched_count"] == 0
    assert diag["unmatched_count"] == diag["configured_count"]
    assert diag["parsed_layer_count"] == 0


def test_build_diagnostics_matches_when_present():
    parsed = [_layer("RADAR_1KM_RRAI")]
    diag = build_wms_curated_diagnostics(parsed)
    matched_ids = {m["id"] for m in diag["matched"]}
    assert "eccc_radar_1km_rrai" in matched_ids
