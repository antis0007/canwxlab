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
| Canada NPAS / CAP-CP | Canada | Public emergency alerts, alert polygons, issue/update/cancel state | CAP/CAP-CP XML feeds via alerting ecosystem | Near realtime | Canadian emergency alert adapter |
| Provincial 511 / Open511 | AB/ON/BC first, then more provinces | Road conditions, events, construction, cameras, ferries, alerts, weather stations | 511 REST APIs, Open511 | Near realtime to operational cadence | Road/traveler information adapters |
| CBSA / CBP border waits | Canada/US border crossings | Passenger and commercial wait times | Public web/API endpoints and datasets | Frequent public updates | Border wait adapter |
| Canada/openFDA recalls | Canada/US | Food, drug, device, product, vehicle, and health safety alerts | CSV/JSON/API | Daily to event-driven | Recall/safety event adapter |
| GTFS / GTFS Realtime / GBFS | Global by agency/system | Transit routes, vehicle positions, trip updates, service alerts, bikeshare/scooter availability | Feed URLs; protocol buffers for GTFS Realtime; JSON for GBFS | Seconds to minutes for realtime feeds | Mobility discovery and transit adapters |
| AESO / IESO / Hydro-Quebec / EIA | Canada/US | Demand, forecast demand, generation mix, interties, price, grid status | Public APIs, reports, open datasets | 5-60 min depending source | Energy system event adapters |
| WHO / CDC public health | Global/US first | Outbreak reports, emergency events, aggregate wastewater surveillance | Public pages/APIs/datasets | Event-driven to weekly | Health event adapters |
| ECCC freshwater quality / DataStream | Canada | Freshwater quality and community water observations | Public APIs/downloads | Hourly to dataset-specific | Water quality adapters |
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

1. Core: `source_registry.py`, `world_events.py`, source health/freshness/provenance overlay,
   public-data replay archive, and adapter test harness.
2. Alerts: `npas_cap.py`, `cap_generic.py`, `canada_recalls.py`,
   `openfda_food_recalls.py`, `openfda_drug_recalls.py`, `openfda_device_recalls.py`,
   `municipal_rss.py`.
3. Roads and borders: `alberta_511.py`, `ontario_511.py`, `drivebc_open511.py`,
   `cbsa_border_waits.py`, `cbp_waittimes.py`, optional `tomtom_traffic.py`,
   optional `waze_for_cities.py`.
4. Transit: `mobility_database.py`, `gtfs_static.py`, `gtfs_realtime.py`, `gbfs.py`,
   `transit_alerts.py`.
5. Energy: `aeso_grid.py`, `ieso_grid.py`, `hydroquebec_demand.py`,
   `bc_hydro_interties.py`, `eia_grid.py`, `utility_outage_framework.py`.
6. Health: `who_outbreaks.py`, `who_emergency_events.py`, `cdc_wastewater.py`,
   `healthmap_optional.py`, plus shared recall adapters.
7. Water: `eccc_freshwater_quality.py`, `datastream.py`, `drinking_water_advisories.py`,
   `reservoir_levels.py`, `dam_status.py`, `water_outages.py`.
8. Environment: `openaq.py`, `canada_radiation.py`, `epa_radnet.py`, `eurdep_radiation.py`,
   `global_forest_watch.py`, `gbif_occurrence.py`, `nasa_black_marble.py`.
9. Hazards: `usgs_earthquakes.py`, `earthquakes_canada.py`, `usgs_volcano.py`,
   `smithsonian_gvp.py`, `tsunami_alerts.py`.
10. Logistics: `aishub.py`, optional `aisstream.py`, optional `port_congestion.py`,
    `un_comtrade.py`, `canada_rail_network.py`, optional user-owned `cn_customer_api.py`.
11. Cyber and communications: `cloudflare_radar.py`, `ripe_ris_live.py`, `routeviews.py`,
    `ripestat.py`, `peeringdb.py`, `rdap.py`, `cisa_kev.py`, `nvd_cve.py`,
    `first_epss.py`, optional `censys_certificates.py`.
12. Context: `statcan_wds.py`, `statcan_census_profile.py`, `worldbank_indicators.py`,
    `oecd_sdmx.py`, `open_canada_ckan.py`, `municipal_open_data.py`, `overture_base.py`,
    `osm_context.py`.
13. Weather/EO/orbital carry-forward: `gibs_wmts.py`, `goes_aws.py`, `firms.py`,
    `copernicus_stac.py`, `nexrad_aws.py`, `ecmwf_open_data.py`, `cosmic_horizons.py`,
    `cosmic_celestrak.py`, `cosmic_sbdb.py`.

## Sources Checked For This Inventory

- Public Safety Canada CAP-CP: https://www.publicsafety.gc.ca/cnt/mrgnc-mngmnt/mrgnc-prprdnss/npas/clf-en.aspx
- 511 Alberta API docs: https://511.alberta.ca/developers/doc
- Ontario 511 events API docs: https://511on.ca/help/endpoint/event
- Ontario 511 road conditions API docs: https://511on.ca/help/endpoint/roadconditions
- DriveBC Open511 API: https://api.open511.gov.bc.ca/help
- CBSA border wait times: https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html
- CBP advisories and wait times: https://www.cbp.gov/travel/advisories-wait-times
- Mobility Database: https://mobilitydatabase.org/faq
- WHO Disease Outbreak News: https://www.who.int/emergencies/disease-outbreak-news
- CDC wastewater data: https://www.cdc.gov/wastewater/about-data/index.html
- openFDA drug enforcement API: https://open.fda.gov/apis/drug/enforcement/
- openFDA food API: https://open.fda.gov/apis/food/
- DataStream platform: https://datastream.org/en-ca/platform
- Health Canada radiation surveillance: https://www.canada.ca/en/health-canada/services/environmental-workplace-health/radiation/radiation-measurement.html
- EPA RadNet near-real-time data: https://www.epa.gov/radnet/radnet-near-real-time-air-data
- USGS Volcano API: https://volcanoes.usgs.gov/vsc/api/volcanoApi/
- NASA Black Marble: https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/science-domain/nighttime-lights/
- AISHub API: https://www.aishub.net/api
- UN Comtrade developer portal: https://comtradedeveloper.un.org/
- Canada National Railway Network dataset reference: https://www.cer-rec.gc.ca/en/applications-hearings/pipeline-abandonment/ace-calculation-method/open-government-datasets.html
- CN customer APIs: https://www.cn.ca/en/customer-centre/tools/api/
- Statistics Canada Web Data Service: https://www.statcan.gc.ca/en/microdata/api
- World Bank Indicators API: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- OECD Data Explorer API: https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html
- Open Canada CKAN API: https://open.canada.ca/data/en/api/
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
