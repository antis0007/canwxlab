# Global OSINT Data Sources

Status: source inventory for the worldwide CanWxLab expansion. This is not a claim that every
source is implemented. Each candidate must be adapter-tested, attributed, cached, and rate-limit
safe before it becomes a default layer.

## Integration Principles

- Prefer standards first: WMTS, WMS/WMS-T, OGC API Features, STAC, Zarr, Cloud-Optimized GeoTIFF,
  GRIB2 indexes, and public object-storage manifests.
- Cache source metadata and time indexes locally. Poll capabilities/catalog endpoints at a slow
  cadence; simulate/interpolate between source refreshes where scientifically valid.
- Keep raw acquisition separate from visual layers. A single source can produce imagery, derived
  products, legends, and alerts.
- Label latency honestly: realtime, near-realtime, daily, archive, model forecast, or stale cache.
- Never silently blend incompatible projections, time steps, or product levels.
- For cyber, mobility, and identity-adjacent feeds, prefer public, licensed, aggregate, opt-in,
  or user-owned data. Do not add private telemetry, private communications, or unauthorized
  scanning workflows.

The detailed non-weather layer backlog is tracked in
[`non-weather-osint-layers.md`](./non-weather-osint-layers.md).

## Immediate Priority Sources

| Source | Coverage | Data | Interface | Cadence | First adapter target |
| --- | --- | --- | --- | --- | --- |
| NASA GIBS | Global | MODIS/VIIRS corrected reflectance, fires, aerosols, snow, clouds, night lights | WMTS, WMS, TWMS | Daily to sub-daily depending product | Global true-colour basemap and hazard overlays |
| NOAA GOES-R on AWS | Americas, Atlantic, Pacific | ABI L1b/L2, CMI, GLM lightning | Public S3, NetCDF | 5-15 min products | GOES East/West full-disk/CONUS compositor |
| EUMETSAT Data Store/EUMETView | Europe, Africa, Indian Ocean, global products | Meteosat, MTG, Metop, Sentinel products | APIs, OGC services, Data Tailor | Near realtime for operational streams | Meteosat/MTG imagery adapter |
| JMA Himawari | Asia-Pacific | Himawari true colour, IR, WV, cloud products | Public imagery pages; NMHS channels for full feeds | 10-30 min public imagery depending channel | Himawari viewer/tiler proxy investigation |
| NASA FIRMS | Global | MODIS/VIIRS active fires and thermal anomalies | WMS, WMS-T, WFS, text/CSV | Near realtime | Fire detections and confidence layer |
| Copernicus Data Space | Global | Sentinel-1/2/3/5P, Copernicus products | STAC, OData, S3, Sentinel Hub APIs | Mission dependent | STAC search and COG/quicklook ingestion |
| NOAA nowCOAST | US/coastal emphasis | radar, warnings, lightning, SST, models | Time-enabled WMS | Frequently updated | US hazard/ocean layer source |
| OpenAQ | Global | Ground air-quality measurements | REST JSON | Station dependent, often hourly | Global AQ observations |
| CelesTrak GP | Earth orbit | Satellite GP/TLE/OMM data | HTTP query APIs | Frequent; cache by group | SGP4 satellite layer |

## Weather, Ocean, and Hazard Sources

| Source | Scope | Use |
| --- | --- | --- |
| ECCC MSC GeoMet | Canada/North America | Current built-in WMS/OGC source for radar, warnings, observations, GDPS/RDPS products. Keep, but demote from "only target" to one regional provider. |
| NOAA NEXRAD on AWS | United States | High-resolution Level II radar. Needs server-side decode/tiling before it is usable as a browser layer. |
| NOAA MRMS | US and territories | Multi-radar mosaics and operational precipitation products. Good candidate for rasterized products. |
| NOAA NOMADS / NCEP | Global and regional NWP | GFS, GEFS, NAM, HRRR, ocean products. Needs GRIB index parsing and tile generation. |
| ECMWF Open Data | Global | Public IFS/AIFS subset. Use as global model layer and forecast comparison source. |
| DWD Open Data | Europe/Germany | ICON model, radar, warnings. Adapter candidate for Europe. |
| MeteoFrance public APIs | France/overseas | Warnings, radar, observations where licensing allows. |
| UK Met Office DataPoint/DataHub | UK/global products | Weather warnings and observations depending access tier. |
| WMO WIS2 nodes | Global | Eventual federation point for official met data. Treat as discovery layer first. |
| GDACS | Global | Disaster alerts: earthquakes, tropical cyclones, floods, volcanoes. |
| USGS Earthquake Hazards | Global | Earthquake feeds and event details. |
| NOAA NHC / JTWC | Tropical basins | Tropical cyclone tracks, advisories, cones. |
| NOAA CO-OPS | US coasts | Tides, water levels, currents. |
| Copernicus Marine | Global ocean | SST, currents, sea ice, waves. Needs API auth/terms review. |
| NASA SPoRT / GPM / IMERG | Global precipitation | Precipitation analysis and nowcast products through NASA services. |

## Earth-Observation and Land Sources

| Source | Scope | Use |
| --- | --- | --- |
| NASA GIBS | Global | First-choice global tiled imagery because the service is already optimized for visualization. |
| NASA Earthdata CMR | Global | Discovery for NASA datasets. Use for catalogue search, not frame-by-frame map rendering. |
| USGS Landsat STAC | Global | Landsat archive search and browse/COG ingestion. Not realtime weather, but high-value OSINT. |
| Copernicus Sentinel STAC/OData | Global | Sentinel imagery discovery and download. Pair with cloud filtering. |
| Microsoft Planetary Computer | Global archive | STAC catalogue for COG/Zarr assets. Check current service terms before default integration. |
| AWS Open Data Registry | Global/regional | Cloud-native mirrors for GOES, NEXRAD, Sentinel, Landsat, HRRR, GFS, ERA5 and more. |
| ESA WorldCover / Dynamic World | Global | Land cover context layers. Lower cadence, cache aggressively. |
| OpenStreetMap / OpenMapTiles | Global | Human geography, roads, boundaries, place labels. |
| Natural Earth | Global | Small-scale boundaries and coastlines for offline fallback. |

## Non-Weather OSINT Sources

| Source | Scope | Use |
| --- | --- | --- |
| OpenSky Network | Global aviation coverage where contributors are available | Live aircraft state vectors, altitude/speed tracks, replayable mobility layer. Respect rate limits and terms. |
| GTFS Realtime | Agency-specific transit feeds | Live transit vehicle positions, service alerts, and trip updates. Start with one city/provider pilot. |
| GBFS | Bikeshare/scooter systems | Station status and vehicle availability for micromobility context. |
| AISHub / AISStream / licensed AIS | Maritime | Vessel position and track layer. Terms review required before redistribution or public demo defaults. |
| USGS Earthquake Hazards | Global | Recent earthquake feeds and event details. Pair with Earthquakes Canada for Canadian view. |
| GDACS | Global | Disaster alerts and humanitarian coordination context. |
| ReliefWeb | Global | Humanitarian reports and disaster metadata. |
| GDELT | Global | News event graph, themes, entities, and public attention signals. |
| Wikimedia EventStreams | Global public wiki activity | Recent public edits and topic bursts. Use as attention signal, not identity tracking. |
| GitHub Events API | Global public software activity | Public repo/activity pulses and software ecosystem signals. |
| RIPE RIS Live / RouteViews | Internet routing | Live and historical BGP events for cyberspace mode. |
| RIPEstat / RDAP | Internet registry metadata | ASN, prefix, org, and registration provenance. |
| PeeringDB | Internet infrastructure | Networks, IXPs, facilities, and interconnection context. |
| Cloudflare Radar / IHR | Internet health | Outages, traffic context, BGP anomalies, and aggregate internet-health signals. |
| Certificate Transparency / Censys certificates | Public web PKI | Domain/certificate graph and infrastructure birth signals. Licensed enrichments are optional. |
| CISA KEV / NVD / FIRST EPSS | Vulnerability context | Known exploited vulnerabilities, CVE metadata, and exploit probability. Render aggregates, not target maps. |
| AESO / IESO / Hydro-Quebec / EIA | Energy systems | Load, generation mix, interties, prices, and grid status where public/API-supported. |
| Overture Maps / OSM | Global civic base | Buildings, roads, transportation, places, admin divisions, and critical-facility context. |

## Space and Orbital Sources

| Source | Scope | Use |
| --- | --- | --- |
| JPL Horizons | Solar system | Authoritative vectors for planets, moons, named small bodies, and spacecraft. Cache vector windows and interpolate client-side. |
| JPL SBDB | Small bodies | Orbital elements and metadata for asteroids/comets. Weekly cache. |
| MPC MPCORB | Small bodies | Alternate/fresh small-body elements. Cross-check with SBDB. |
| NASA CNEOS | Near-Earth objects | Close approaches and risk context. Daily cache. |
| CelesTrak GP | Satellites/debris | Public GP/TLE/OMM sets. Propagate with SGP4 in a worker. |
| Space-Track.org | Satellites/debris | More complete catalog where credentials and terms permit. Not default anonymous source. |
| HYG / Gaia DR3 subsets | Stars | Static local catalogues for starfield and stellarium mode. |
| NASA Exoplanet Archive | Exoplanets | Weekly host/planet metadata for info cards and search. |
| SIMBAD | Deep-sky metadata | Link-out or per-click lookup only; do not bulk scrape. |

## Adapter Backlog

1. `gibs_wmts.py`: capabilities parser, layer metadata, time index, REST tile template generator.
2. `goes_aws.py`: bucket inventory, ABI product selector, latest-time resolver, server-side thumbnail/COG tiler.
3. `firms.py`: WMS/WFS active-fire source with confidence filters.
4. `openaq.py`: station/measurement paging, provider provenance, spatial bounding queries.
5. `copernicus_stac.py`: STAC search, cloud filter, quicklook/COG asset selection.
6. `nexrad_aws.py`: Level II inventory only at first; rendering requires a radar decode service.
7. `ecmwf_open_data.py`: GRIB index reader and model-field tiler.
8. `cosmic_horizons.py`, `cosmic_celestrak.py`, `cosmic_sbdb.py`: orbital cache sources.
9. `opensky_aircraft.py`: aircraft state-vector event adapter with short-track replay.
10. `gtfs_realtime.py`: provider-configured transit vehicle/service-alert adapter.
11. `usgs_earthquakes.py` and `earthquakes_canada.py`: seismic event adapters.
12. `gdacs.py`, `reliefweb.py`, `gdelt.py`: disaster/hyperreality event adapters.
13. `ripe_ris_live.py`, `routeviews.py`, `ripestat.py`, `peeringdb.py`, `rdap.py`:
    cyberspace topology and routing adapters.
14. `cloudflare_radar.py` and `ihr.py`: outage and internet-health adapters.
15. `cisa_kev.py`, `nvd_cve.py`, `first_epss.py`: vulnerability-context adapters for
    aggregate or user-owned asset views.
16. `aeso_grid.py`, `ieso_grid.py`, `hydroquebec_demand.py`, `eia_grid.py`: energy system
    adapters.

## Sources Checked For This Inventory

- NASA GIBS API: https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
- GIBS access basics: https://nasa-gibs.github.io/gibs-api-docs/access-basics/
- NOAA GOES-R on AWS: https://aws.amazon.com/blogs/publicsector/accessing-noaas-goes-r-series-satellite-weather-imagery-data-on-aws/
- NASA FIRMS: https://firms.modaps.eosdis.nasa.gov/
- OpenAQ API: https://docs.openaq.org/about/about
- Copernicus STAC: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- EUMETSAT data distribution: https://www.eumetsat.int/distributing-data
- JMA Himawari realtime imagery: https://www.data.jma.go.jp/mscweb/data/himawari/
- NOAA nowCOAST: https://www.nauticalcharts.noaa.gov/learn/nowcoast.html
- CelesTrak GP data formats: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- ECMWF Open Data: https://www.ecmwf.int/en/forecasts/datasets/open-data
- USGS Landsat STAC: https://www.usgs.gov/landsat-missions/spatiotemporal-asset-catalog-stac
- NEXRAD on AWS: https://registry.opendata.aws/noaa-nexrad/
- NOAA MRMS: https://vlab.noaa.gov/web/mrms
- OpenSky Network REST API: https://openskynetwork.github.io/opensky-api/rest.html
- GTFS Realtime reference: https://gtfs.org/documentation/realtime/reference/
- GBFS specification: https://gbfs.org/specification/
- RIPE RIS Live: https://ris-live.ripe.net/manual/
- PeeringDB API docs: https://docs.peeringdb.com/api_specs/
- Cloudflare Radar API: https://developers.cloudflare.com/api/resources/radar/
- GDELT data: https://www.gdeltproject.org/data.html
- ReliefWeb API: https://apidoc.reliefweb.int/
- Wikimedia EventStreams: https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams
- GitHub Events API: https://docs.github.com/en/rest/activity/events
- USGS Earthquake GeoJSON feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- CISA KEV catalog: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- NVD API: https://nvd.nist.gov/developers
- FIRST EPSS: https://www.first.org/epss/
- EIA Open Data API: https://www.eia.gov/opendata/
- IESO Power Data: https://www.ieso.ca/Power-Data
- Overture Maps docs: https://docs.overturemaps.org/
