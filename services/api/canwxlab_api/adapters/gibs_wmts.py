"""NASA GIBS WMTS satellite imagery adapter.

GIBS (Global Imagery Browse Services) provides global daily satellite composites
from MODIS Terra/Aqua and VIIRS SNPP/NOAA-20.  These fill the Eastern Hemisphere
coverage gap left by GOES-East/West (which cover only the Americas).

Tile URL pattern:
  https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{Product}/default/{date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg

The ``{date}`` placeholder is replaced at render time with the resolved time
formatted as YYYY-MM-DD (T-1 is the most recent available daily composite).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from canwxlab_api.adapters.base import BBox, WeatherSourceAdapter
from canwxlab_api.models import (
    AlertFeature,
    DataSource,
    LayerKind,
    LayerServiceType,
    Observation,
    SourceAdapterRef,
    SourceStatus,
    WeatherLayer,
    WmsCapabilitiesSummaryResponse,
)

GIBS_WMTS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best"
GIBS_ATTRIBUTION = (
    "NASA EOSDIS Global Imagery Browse Services (GIBS). "
    "MODIS/Terra, MODIS/Aqua, VIIRS S-NPP/NOAA-20. "
    "https://earthdata.nasa.gov/gibs"
)
GIBS_DATA_SOURCE_ID = "nasa_gibs_wmts"
GIBS_TILE_MATRIX = "GoogleMapsCompatible_Level9"
GIBS_IMAGE_FORMAT = "jpg"
GIBS_DAILY_WINDOW_DAYS = 30  # rolling window: T-30 through T-1

# Each GIBS product has a known satellite sub-point (nadir) and coverage
# radius for edge-blending on the client.
# Sources:
#   MODIS Terra:     EQ crossing ~10:30 local, 705 km sun-sync orbit
#   MODIS Aqua:      EQ crossing ~13:30 local, 705 km sun-sync orbit
#   VIIRS SNPP:      EQ crossing ~13:30 local, 824 km sun-sync orbit
#   VIIRS NOAA-20:   EQ crossing ~13:30 local, 824 km sun-sync orbit
# All four are polar-orbiting, so their effective coverage radius from the
# sub-point is ~90 deg (full hemisphere).  We use 85 deg to leave a small
# blending margin at the limb.
POLAR_COVERAGE_RADIUS_DEG = 85.0
POLAR_FEATHER_RADIUS_DEG = 5.0

GIBS_PRODUCTS: list[dict] = [
    {
        "layer_id": "gibs_modis_terra_true",
        "name": "MODIS Terra True Color",
        "title": "NASA GIBS — MODIS Terra Corrected Reflectance (True Color)",
        "variable": "reflectance_truecolor",
        "unit": "reflectance",
        "product": "MODIS_Terra_CorrectedReflectance_TrueColor",
        "description": (
            "Global daily true-color composite from MODIS on NASA's Terra satellite "
            "(EQ crossing ~10:30 local).  250 m resolution.  Available T-1."
        ),
    },
    {
        "layer_id": "gibs_modis_aqua_true",
        "name": "MODIS Aqua True Color",
        "title": "NASA GIBS — MODIS Aqua Corrected Reflectance (True Color)",
        "variable": "reflectance_truecolor",
        "unit": "reflectance",
        "product": "MODIS_Aqua_CorrectedReflectance_TrueColor",
        "description": (
            "Global daily true-color composite from MODIS on NASA's Aqua satellite "
            "(EQ crossing ~13:30 local).  250 m resolution.  Available T-1."
        ),
    },
    {
        "layer_id": "gibs_viirs_snpp_true",
        "name": "VIIRS SNPP True Color",
        "title": "NASA GIBS — VIIRS S-NPP Corrected Reflectance (True Color)",
        "variable": "reflectance_truecolor",
        "unit": "reflectance",
        "product": "VIIRS_SNPP_CorrectedReflectance_TrueColor",
        "description": (
            "Global daily true-color composite from VIIRS on the Suomi-NPP satellite "
            "(EQ crossing ~13:30 local).  250 m resolution.  Available T-1."
        ),
    },
    {
        "layer_id": "gibs_viirs_noaa20_true",
        "name": "VIIRS NOAA-20 True Color",
        "title": "NASA GIBS — VIIRS NOAA-20 Corrected Reflectance (True Color)",
        "variable": "reflectance_truecolor",
        "unit": "reflectance",
        "product": "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
        "description": (
            "Global daily true-color composite from VIIRS on the NOAA-20 satellite "
            "(EQ crossing ~13:30 local).  250 m resolution.  Available T-1."
        ),
    },
]


class GibsWmtsSourceAdapter(WeatherSourceAdapter):
    """Exposes NASA GIBS daily satellite composites as time-aware WMTS overlay layers.

    The adapter is intentionally lightweight — the GIBS product catalogue changes
    infrequently, so we use a static curated list rather than parsing the WMTS
    GetCapabilities XML on every request.
    """

    def __init__(self) -> None:
        self._now_utc = datetime.now(UTC)

    # ── WeatherSourceAdapter protocol ───────────────────────────────────────

    async def list_sources(self) -> list[DataSource]:
        return [
            DataSource(
                source_id=GIBS_DATA_SOURCE_ID,
                name="NASA GIBS WMTS",
                status=SourceStatus.live,
                message="Static product catalogue.",
                is_live=True,
                attribution=GIBS_ATTRIBUTION,
                description=(
                    "NASA Global Imagery Browse Services daily satellite "
                    "composites exposed as curated WMTS layers."
                ),
                last_updated=self._now_utc,
                last_successful_fetch=self._now_utc,
                last_attempted_fetch=self._now_utc,
            )
        ]

    async def list_layers(self) -> list[WeatherLayer]:
        now = datetime.now(UTC)
        t30 = now - timedelta(days=GIBS_DAILY_WINDOW_DAYS)
        t1 = now - timedelta(days=1)
        time_extent = f"{t30.strftime('%Y-%m-%d')}T00:00:00Z/{t1.strftime('%Y-%m-%d')}T23:59:59Z/P1D"

        return [
            WeatherLayer(
                layer_id=entry["layer_id"],
                name=entry["name"],
                title=entry["title"],
                kind=LayerKind.raster,
                variable=entry["variable"],
                unit=entry["unit"],
                source_id=GIBS_DATA_SOURCE_ID,
                status=SourceStatus.live,
                adapter="gibs_wmts",
                service_type=LayerServiceType.wmts,
                attribution=GIBS_ATTRIBUTION,
                description=entry["description"],
                is_live=True,
                default_opacity=0.72,
                wms_base_url=GIBS_WMTS_BASE,
                wms_layer_name=entry["product"],
                time_dimension_supported=True,
                min_zoom=0,
                max_zoom=9,
                update_frequency_hint="Daily (T-1)",
                metadata={
                    "intended_product_type": "satellite",
                    "gibs_product": entry["product"],
                    "gibs_tile_matrix": GIBS_TILE_MATRIX,
                    "gibs_image_format": GIBS_IMAGE_FORMAT,
                    "time_extent": time_extent,
                    "satellite_orbit_type": "polar",
                    "satellite_sub_point_lonlat": None,  # polar = no fixed sub-point
                    "satellite_coverage_radius_deg": POLAR_COVERAGE_RADIUS_DEG,
                    "satellite_feather_radius_deg": POLAR_FEATHER_RADIUS_DEG,
                    "wms_bounds_lonlat": [-180, -90, 180, 90],
                    "source_adapter": SourceAdapterRef(
                        adapter_id="gibs_wmts",
                        adapter_version="0.1.0",
                    ).model_dump(),
                },
                last_updated=now,
                last_successful_fetch=now,
                last_attempted_fetch=now,
            )
            for entry in GIBS_PRODUCTS
        ]

    async def get_layer_metadata(self, layer_id: str) -> WeatherLayer | None:
        for layer in await self.list_layers():
            if layer.layer_id == layer_id:
                return layer
        return None

    async def fetch_recent_hourly_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        _ = bbox, limit
        return []

    async def fetch_station_observations(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[Observation]:
        _ = bbox, limit
        return []

    async def fetch_alerts(
        self, bbox: BBox | None = None, limit: int = 100
    ) -> list[AlertFeature]:
        _ = bbox, limit
        return []

    async def get_wms_layer_catalog(self) -> list[WeatherLayer]:
        return await self.list_layers()

    async def get_wms_capabilities_summary(self) -> WmsCapabilitiesSummaryResponse:
        source = await self.get_source_status()
        layers = await self.list_layers()
        return WmsCapabilitiesSummaryResponse(source=source, layers=layers)
