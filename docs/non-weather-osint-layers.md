# Non-Weather OSINT Layer Backlog

Status: product and data-source backlog for the CanWxLab pivot toward a public-data
operational awareness workstation. This is not an implementation claim. Each source must
pass adapter tests, attribution checks, cache/rate-limit review, source-status review, and
UI provenance review before it becomes a default layer.

## Operating Rule

CanWxLab may collect, normalize, replay, and visualize public, licensed, opt-in,
aggregated, or self-hosted data streams.

CanWxLab must not collect private traffic, private device telemetry, private account data,
personal movement traces, or data obtained by bypassing access controls. It must not become
an indiscriminate scanner or a map of individual vulnerable systems.

Every non-weather layer must expose:

- `source_id`
- `source_kind`
- `status`
- `privacy_class`
- `observed_time`
- `fetched_time`
- `valid_time`
- `cache_status`
- `license`
- `provenance.url`
- `confidence`
- `derivation`

## Core Primitives

CanWxLab should not model this expansion as a pile of UI layers. The durable primitives are:

| Primitive | Meaning | Examples |
| --- | --- | --- |
| `Source` | Where data came from, under which terms, with which freshness and reliability state | Alberta 511, ECCC GeoMet, WHO Disease Outbreak News, Cloudflare Radar |
| `Event` | Something observed, reported, forecast, or updated at a place/time | road closure, evacuation alert, outage polygon, wastewater trend, BGP anomaly |
| `Layer` | One visualization, query, or analysis projection over sources/events | incident map, route disruption table, camera wall, timeline replay, correlation view |

A single source can emit many event kinds and feed many layers. For example, Alberta 511 can
produce road-closure, crash, construction, ferry-status, camera-update, alert, and road-weather
events; those events can render as an incident map, route table, highway camera wall, replay
timeline, and weather-impact correlation panel.

The first non-weather foundation task is therefore a formal source registry plus a shared
`WorldEvent`/`SpatiotemporalEvent` schema. New feeds should not be added as one-off overlays.

## Product Modes

| Mode | Purpose | First layers |
| --- | --- | --- |
| Weather | Existing Canadian weather workstation | ECCC GeoMet, verification, hydrology, smoke, AQHI |
| Earth | Live physical/civic world model | public alerts, roads, border waits, transit, earthquakes, base infrastructure |
| Cyberspace | Internet topology and health | ASN registry, BGP updates, outages, IXPs, RDAP, CT summaries |
| Hyperreality | Public attention and event graph | news events, humanitarian reports, wiki edits, public GitHub activity |
| Infrastructure | Energy, transport, water, communications, and critical systems | grid load, outages, roads, ports, borders, water advisories |
| Space | Orbital/celestial OSINT | satellites, ground tracks, NEOs, space weather |

## Common Event Shape

The Phase A `SpatiotemporalEvent` model should become the shared substrate for weather
and non-weather data. Non-weather adapters should emit events shaped like this:

```json
{
  "id": "event:source:type:timestamp:hash",
  "kind": "roads.closure",
  "source_id": "alberta_511",
  "source_kind": "public_api",
  "status": "live",
  "privacy_class": "public_operational",
  "observed_time": "2026-05-17T20:10:00Z",
  "fetched_time": "2026-05-17T20:10:08Z",
  "valid_time": "2026-05-17T20:10:00Z",
  "geometry": {
    "type": "LineString",
    "coordinates": [[-113.55, 53.52], [-113.49, 53.54]]
  },
  "properties": {},
  "confidence": 0.82,
  "license": "source-specific",
  "provenance": {
    "url": "https://example.invalid/source",
    "adapter": "alberta_511",
    "raw_hash": "sha256:..."
  }
}
```

Use H3 cells, graph IDs, or route IDs as secondary indexes; keep the original source event
as the evidence anchor.

## Privacy Classes

| Class | Meaning | Allowed default rendering |
| --- | --- | --- |
| `public_operational` | Public infrastructure or operational data intentionally published | object-level if source terms allow |
| `public_aggregate` | Aggregated counts, flows, outages, or statistics | aggregate only |
| `licensed_operational` | Licensed feed with redistribution limits | follow license, usually local-only |
| `derived_estimate` | Inference from public inputs | always show confidence and method |
| `user_owned` | User-owned assets, probes, domains, or telemetry | visible only in that deployment |
| `restricted` | Raw details should not be exposed | no default map rendering |

## Operational Pivot

The highest-value missing streams are civic-operational: alerts, roads, outages, health, water,
energy, logistics, environmental risk, and communications health. Aircraft, vessels, cyber arcs,
news pulses, and satellites remain useful, but they should follow the operational feeds that
answer whether people can travel, whether infrastructure is working, whether hazards are nearby,
and what changed recently.

## Ranked Priority

| Rank | Addition | Why |
| --- | --- | --- |
| 1 | CAP/public emergency alerts | immediate life safety |
| 2 | 511 road conditions, cameras, closures, incidents | everyday operational value |
| 3 | power grid demand and outages | infrastructure awareness |
| 4 | GTFS Realtime transit | urban usefulness |
| 5 | border wait times | Canada-first logistics and travel |
| 6 | water quality and drinking/boil-water advisories | public health and environment |
| 7 | public health outbreaks and wastewater | early warning |
| 8 | recalls and safety alerts | practical household risk |
| 9 | earthquakes, volcanoes, tsunami, radiation | low-friction hazard awareness |
| 10 | OpenAQ and environmental sensors | exposure and health context |
| 11 | AIS, ports, rail, trade, logistics | supply-chain awareness |
| 12 | internet outages and BGP | communications health |
| 13 | CISA/NVD/EPSS | cyber-risk context |
| 14 | census, civic, economic context | interpretation layer |
| 15 | NASA Black Marble night lights | human activity, outage, and conflict signal |

## Operational Source Families

### Public Safety Alerts

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `alerts.cap_public_safety` | alert polygons, severity, status, issue/update/cancel timeline | Canada NPAS/CAP-CP, generic CAP 1.2 feeds, provincial/municipal alert feeds |
| `alerts.shelters_evacuation` | evacuation areas, shelter and reception-centre context | provincial/municipal open data and public safety feeds |
| `alerts.recalls_safety` | food, drug, product, vehicle, and health advisories | Canada Recalls/Safety Alerts, openFDA food/drug/device enforcement APIs |
| `alerts.public_rss` | official public advisories and notices | municipal/provincial RSS/Atom feeds |

Initial adapter targets:

- `alerts.npas_cap`
- `alerts.cap_generic`
- `alerts.canada_recalls`
- `alerts.openfda_food_recalls`
- `alerts.openfda_drug_recalls`
- `alerts.openfda_device_recalls`
- `alerts.municipal_rss`

### Roads, Highways, and Borders

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `roads.conditions` | snow, ice, flooding, visibility, surface condition | Alberta 511, Ontario 511, DriveBC/Open511, provincial 511 feeds |
| `roads.events` | closures, collisions, construction, hazards, truck restrictions | 511/Open511 APIs, municipal open data |
| `roads.cameras` | public highway camera snapshots and metadata | 511/Open511 camera endpoints |
| `roads.ferries` | ferry operating status and disruption | 511/Open511 ferry endpoints |
| `roads.borders.wait_times` | passenger/commercial crossing delays | CBSA border wait times, CBP border wait times |

Initial adapter targets:

- `roads.alberta_511`
- `roads.ontario_511`
- `roads.drivebc_open511`
- `roads.cbsa_border_waits`
- `roads.cbp_waittimes`
- `roads.tomtom_traffic_optional`
- `roads.waze_for_cities_optional`

TomTom and Waze should remain optional licensed/partner integrations.

### Public Transit and Micromobility

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `mobility.transit.discovery` | available feeds by city/agency | Mobility Database |
| `mobility.gtfs_static` | routes, trips, stops, calendars, shapes | GTFS static feeds |
| `mobility.gtfs_realtime` | vehicle positions, trip updates, service alerts | GTFS Realtime feeds |
| `mobility.gbfs` | bikeshare/scooter stations and vehicle availability | GBFS system feeds |
| `mobility.transit_reliability` | delay and disruption history | archived GTFS Realtime and agency open data |

Initial adapter targets:

- `mobility.mobility_database`
- `mobility.gtfs_static`
- `mobility.gtfs_realtime`
- `mobility.gbfs`
- `mobility.transit_alerts`

High-value product behavior: click a city and discover available GTFS, GTFS Realtime, and GBFS
feeds automatically before enabling any feed.

### Energy and Outages

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `energy.demand` | regional/provincial electricity demand and forecast demand | AESO, IESO, Hydro-Quebec, EIA |
| `energy.generation_mix` | generation by fuel type | AESO, IESO, EIA |
| `energy.interchange` | imports, exports, and intertie flows | AESO, BC Hydro, EIA |
| `energy.price` | market price and constraint stress | AESO, IESO, EIA |
| `energy.grid_alerts` | reserve shortages and operator notices | ISO/utility feeds where permitted |
| `energy.outages.aggregate` | people/customers affected and restoration estimates | utility APIs/pages where terms permit, optional aggregators |
| `energy.assets_context` | power plants, lines, substations, dams | OSM, Overture, EIA, provincial datasets |

Initial adapter targets:

- `energy.aeso`
- `energy.ieso`
- `energy.hydro_quebec`
- `energy.bc_hydro_interties`
- `energy.eia_grid`
- `energy.poweroutage_ca_optional`
- `energy.utility_outage_scraper_terms_checked`

Utility outage data requires strict terms review. Prefer official APIs and aggregate rendering.

### Health and Biological Risk

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `health.who_outbreaks` | official outbreak reports and emergency events | WHO Disease Outbreak News and emergency pages/APIs |
| `health.wastewater` | aggregate infectious-disease early-warning trends | CDC wastewater datasets, provincial/municipal public wastewater data |
| `health.system_pressure` | public hospital/ER pressure where released | health authority open data |
| `health.recalls` | food, drug, device recall exposure context | Canada Recalls/Safety Alerts, openFDA |
| `health.animal_disease` | zoonotic/agricultural disease alerts | official animal health agencies |
| `health.public_osint_optional` | public health signals requiring confidence labels | HealthMap-style public OSINT interfaces |

Initial adapter targets:

- `health.who_outbreaks`
- `health.who_emergency_events`
- `health.cdc_wastewater`
- `health.canada_recalls`
- `health.openfda_food_recalls`
- `health.openfda_drug_recalls`
- `health.openfda_device_recalls`
- `health.healthmap_reference_or_optional`

Do not include individual patient data. Aggregate only.

### Water Systems

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `water.freshwater_quality` | temperature, pH, dissolved oxygen, conductance, turbidity | ECCC freshwater quality monitoring |
| `water.community_data` | water and sediment quality observations | DataStream regional hubs |
| `water.drinking_advisories` | boil-water and drinking-water advisories | federal, provincial, municipal, and First Nations public advisories |
| `water.reservoirs_dams` | reservoir level, dam status, hydropower context | utility and government open data |
| `water.outages` | water-main breaks and service outages | municipal open data and utility feeds |

Initial adapter targets:

- `water.eccc_freshwater_quality`
- `water.datastream`
- `water.municipal_boiling_advisories`
- `water.reservoir_levels`
- `water.dam_status`
- `water.water_outages`

### Environment

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `env.air_quality` | PM2.5, PM10, O3, NO2, SO2, CO | OpenAQ and national/provincial air-quality feeds |
| `env.radiation` | radiation-monitor readings and anomaly context | Canada radiation monitoring, EPA RadNet, EURDEP |
| `env.forest_change` | deforestation/disturbance alerts | Global Forest Watch |
| `env.biodiversity` | species occurrences, invasive/rare observations | GBIF |
| `env.night_lights` | nighttime-light intensity and change | NASA Black Marble |
| `env.land_change` | land cover, urbanization, fire recovery | NASA, Copernicus, ESA, Dynamic World, government datasets |

Initial adapter targets:

- `env.openaq`
- `env.canada_radiation`
- `env.epa_radnet`
- `env.eurdep_radiation`
- `env.global_forest_watch`
- `env.gbif_occurrence`
- `env.nasa_black_marble`

### Geophysical Hazards

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `hazards.earthquakes` | recent and historical seismic events | USGS, Earthquakes Canada |
| `hazards.shakemaps` | earthquake shaking and impact estimates | USGS ShakeMap where available |
| `hazards.volcanoes` | volcano status, alert level, ash/eruption reports | USGS Volcano Hazards Program, Smithsonian GVP |
| `hazards.tsunami_alerts` | coastal watches/warnings/advisories | NOAA/PTWC, GDACS, national feeds |
| `hazards.landslide_risk` | terrain/rainfall/known-landslide risk context | geological surveys and public hazard datasets |
| `hazards.radiation_anomalies` | radiological events and station anomalies | radiation sources above |

Initial adapter targets:

- `hazards.usgs_earthquakes`
- `hazards.earthquakes_canada`
- `hazards.usgs_volcano`
- `hazards.smithsonian_gvp`
- `hazards.tsunami_alerts`
- `hazards.radiation_anomalies`

### Logistics and Flows

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `logistics.vessels` | live AIS vessel positions | AISHub, AISStream, licensed AIS feeds |
| `logistics.ports` | port calls, anchorage, congestion where public/licensed | AIS plus port authority open data |
| `logistics.borders` | commercial border wait and crossing status | CBSA, CBP |
| `logistics.rail_network` | freight corridors and rail context | Canada National Railway Network, OSM/OpenRailwayMap-derived context |
| `logistics.trade_flows` | commodity and trade flows | UN Comtrade, Statistics Canada, CER |
| `logistics.shipments_user_owned` | user-owned shipment status | CN/rail customer APIs with user credentials |

Initial adapter targets:

- `logistics.aishub`
- `logistics.aisstream_optional`
- `logistics.port_congestion_optional`
- `logistics.cbsa_border_waits`
- `logistics.cbp_waittimes`
- `logistics.un_comtrade`
- `logistics.canada_rail_network`
- `logistics.cn_customer_api_optional_user_owned`

### Civic, Demographic, and Economic Context

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `context.demographics` | population, age, income, language, commuting | Statistics Canada Census/Profile, other national census APIs |
| `context.admin_boundaries` | jurisdictions and service areas | Statistics Canada, Natural Earth, Overture, municipal open data |
| `context.economic_indicators` | unemployment, inflation, GDP, sector exposure | Statistics Canada WDS, World Bank, OECD SDMX |
| `context.facilities` | hospitals, schools, fire, police, emergency services | municipal/provincial open data, OSM, Overture |
| `context.critical_infrastructure` | plants, roads, bridges, ports, airports | OSM, Overture, official open data |
| `context.procurement_permits` | public procurement, tenders, permits, development | Open Canada CKAN, municipal CKAN/Socrata/ArcGIS/OpenDataSoft portals |

Initial adapter targets:

- `context.statcan_wds`
- `context.statcan_census_profile`
- `context.worldbank_indicators`
- `context.oecd_sdmx`
- `context.open_canada_ckan`
- `context.municipal_open_data`
- `context.overture_maps`
- `context.osm_overpass`

### Communications and Cyber Health

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `cyber.internet_outages` | regional/platform/network degradation | Cloudflare Radar, IHR |
| `cyber.bgp_anomalies` | route leaks, hijack-like shifts, instability | Cloudflare Radar, RIPE RIS Live, RouteViews, IHR |
| `cyber.registry_context` | ASN, prefix, domain, and facility ownership | RDAP, RIPEstat, PeeringDB |
| `cyber.certificate_transparency` | new domains/services/infrastructure bursts | CT logs, Censys certificates where licensed |
| `cyber.vulnerability_context` | exploited CVEs, CVE metadata, exploit probability | CISA KEV, NVD, FIRST EPSS |

Initial adapter targets:

- `cyber.cloudflare_radar`
- `cyber.ripe_ris_live`
- `cyber.ripestat`
- `cyber.routeviews`
- `cyber.peeringdb`
- `cyber.rdap`
- `cyber.cisa_kev`
- `cyber.nvd_cve`
- `cyber.first_epss`
- `cyber.censys_certs_optional`

Keep this in aggregate or user-owned-asset mode. Avoid turning CanWxLab into a
vulnerable-host targeting interface.

### Public Information and Hyperreality

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `hyper.gov_news_releases` | official government announcements | federal/provincial/municipal release feeds |
| `hyper.gdelt_events` | news-derived events and entities | GDELT Events |
| `hyper.gdelt_gkg` | theme and entity surges | GDELT GKG |
| `hyper.humanitarian_reports` | disaster/crisis reports | ReliefWeb |
| `hyper.disaster_alerts` | global disaster alerts | GDACS |
| `hyper.wikimedia_eventstreams` | public knowledge/edit bursts | Wikimedia EventStreams |
| `hyper.github_events` | public software ecosystem activity | GitHub Events API |
| `hyper.public_rss_feeds` | official RSS/Atom notice streams | source registry configured feeds |
| `hyper.procurement_notices` | tenders and procurement | Open Canada and municipal portals |

Public information streams are leads with provenance and confidence, not ground truth.

## Existing Product-Oriented Families

### 1. Live Mobility

This is the fastest path to a living-planet experience without invasive collection.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `mobility.aircraft.live` | aircraft position, altitude, velocity, callsign, track | OpenSky Network, licensed ADS-B feeds |
| `mobility.aircraft.trails` | historical/replay tracks | OpenSky tracks, licensed feeds |
| `mobility.airports` | airports, runways, operational metadata | OurAirports, OpenStreetMap, official aviation sources |
| `mobility.vessels.live` | AIS vessel position, heading, speed, type | AISHub, AISStream, licensed AIS feeds |
| `mobility.vessels.trails` | port approaches and route history | AIS sources |
| `mobility.ports` | ports, anchorages, congestion context | OSM, port authority open data |
| `mobility.transit.vehicles` | buses, trains, subways, delays | GTFS Realtime |
| `mobility.bikeshare` | dock availability and free vehicles | GBFS |
| `mobility.roads.incidents` | closures, construction, congestion, incidents | municipal/provincial open data, 511 feeds |
| `mobility.borders.wait_times` | border delay and crossing status | CBSA/US CBP where available |

Visualization todo:

- altitude-colored aircraft glyphs with fading trails
- ship-type glyphs with heading and wake trail
- route-colored public transit vehicles
- hub markers for airports, ports, stations, and crossings
- animated density heatmaps for traffic intensity

### 2. Cyberspace

Cyberspace mode should show the visible public nervous system of the internet: topology,
routing, outages, certificates, and aggregate exposure. It should not expose raw targeting
workflows for individual systems.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `cyber.asn_registry` | ASN, organization, country, role | RIPEstat, CAIDA AS Rank, PeeringDB |
| `cyber.prefix_ownership` | IP prefix to ASN/org metadata | RDAP, RIPEstat, RIR data |
| `cyber.bgp_live` | BGP announcements and withdrawals | RIPE RIS Live, RouteViews |
| `cyber.bgp_routes` | AS path arcs and route history | RIPE RIS, RouteViews |
| `cyber.internet_outages` | network/platform/regional outage signals | Cloudflare Radar, IHR |
| `cyber.bgp_anomalies` | route leaks, hijack-like shifts, instability | Cloudflare Radar, IHR, local analytics |
| `cyber.ixp_facilities` | IXPs, networks, facilities, interconnects | PeeringDB |
| `cyber.rdap_lookup` | domain/IP/ASN registration evidence | ICANN/RIR RDAP |
| `cyber.certificate_transparency` | certificates, domains, infrastructure graph | CT logs, Censys certificates |
| `cyber.service_exposure_aggregate` | service exposure counts by ASN/country | Censys/Shodan, aggregate only |
| `cyber.vulnerability_context` | exploited CVEs and exploit probability | CISA KEV, NVD, FIRST EPSS |

Visualization todo:

- BGP update pulses along AS-path arcs
- ASN nodes sized by routing visibility
- IXP/facility hubs as bright exchange points
- outages as darkened regions or network nodes
- certificate/domain bursts as vertical signal spikes
- vulnerability context as aggregate sector/ASN overlays, not host-level target maps

Safety rules:

- no unauthorized scanning
- no raw vulnerable-device layer
- no individual private-IP mapping
- no precise IP geolocation without mandatory confidence radius
- public/licensed/user-owned data only

### 3. Hyperreality

Hyperreality mode maps public attention, public records, and world-event signals.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `hyper.news_events` | geocoded news events, entities, source links | GDELT Events |
| `hyper.topic_surges` | theme and entity spikes by region | GDELT GKG, Wikimedia, licensed social APIs |
| `hyper.humanitarian_reports` | disaster reports and humanitarian updates | ReliefWeb |
| `hyper.disaster_alerts` | disaster events, severity, affected regions | GDACS |
| `hyper.conflict_protest` | political violence and protest events | ACLED, subject to license/API terms |
| `hyper.wikipedia_recent_changes` | public wiki edit stream and topic bursts | Wikimedia EventStreams |
| `hyper.github_public_activity` | public software ecosystem activity | GitHub Events API |
| `hyper.domain_certificate_surges` | new domain/certificate infrastructure bursts | CT logs, Censys |
| `hyper.public_alerts` | official CAP/RSS/Atom emergency feeds | government/public safety feeds |

Visualization todo:

- event points with timeline and linked source list
- topic-intensity fields by region
- humanitarian/disaster polygons with report panels
- wiki edit pulses and GitHub activity pulses
- certificate/domain creation spikes

### 4. Energy and Infrastructure

This layer family gives CanWxLab a live systems view of grids, generation, transport,
and critical assets.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `infra.power.load` | regional/provincial demand | AESO, IESO, Hydro-Quebec, EIA, ENTSO-E |
| `infra.power.generation_mix` | generation by fuel type | AESO, IESO, EIA, ENTSO-E |
| `infra.power.interchange` | imports, exports, intertie flows | AESO, BC Hydro, CER, EIA |
| `infra.power.price` | market price and day-ahead/real-time data | AESO, IESO, EIA, ENTSO-E |
| `infra.power.assets` | plants, wind farms, dams, substations | OSM, Overture, EIA, provincial data |
| `infra.power.transmission` | power lines and substations | OSM, government datasets |
| `infra.power.alerts` | reserve shortage, grid alerts, operator notices | ISO/utility feeds where permitted |
| `infra.outages.aggregate` | utility outage counts and regions | utility APIs/pages where terms permit |
| `infra.pipelines` | pipelines, terminals, refineries | CER, open data, OSM |

Visualization todo:

- grid regions colored by load and reserve margin
- animated intertie flow lines
- plant glyphs by fuel type and capacity
- price heatmaps by market region
- outage polygons or aggregate customer-count symbols

### 5. Disaster, Hazard, and Emergency

Weather hazards remain in Weather mode. This family covers non-weather hazard signals and
cross-domain emergency data.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `hazard.earthquakes.recent` | recent seismic events and magnitude | USGS, Earthquakes Canada |
| `hazard.earthquakes.historical` | historical seismicity | USGS, Earthquakes Canada |
| `hazard.volcanoes` | volcano status and eruption reports | Smithsonian GVP, USGS volcano feeds |
| `hazard.tsunami_alerts` | tsunami watches/warnings | NOAA/PTWC, GDACS, national feeds |
| `hazard.radiation` | public radiation monitor readings | EURDEP, EPA RadNet, national feeds |
| `hazard.public_safety_alerts` | CAP/RSS public emergency alerts | government/public safety feeds |
| `hazard.evacuation_closures` | evacuation areas, closures, shelters | municipal/provincial open data |

Visualization todo:

- earthquake expanding rings by magnitude/depth
- volcano alert cones
- tsunami advisory bands and source event trace
- radiation station glyphs with stale-data badge
- evacuation polygons and shelter markers

### 6. Civic and Base World

These layers make every live event interpretable.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `base.admin_boundaries` | countries, provinces, municipalities, census areas | Natural Earth, Statistics Canada, Overture |
| `base.buildings` | footprints and heights where available | OSM, Overture Maps, municipal open data |
| `base.roads` | road network and classes | OSM, Overture |
| `base.railways` | rail lines, stations, crossings | OSM, open rail data |
| `base.critical_facilities` | hospitals, fire, police, schools | OSM, municipal/provincial data |
| `base.land_use` | zoning, industrial, residential/commercial areas | municipal open data, OSM |
| `base.demographics` | census variables by geography | Statistics Canada and other census APIs |
| `base.webcams.public` | official public webcams | municipalities, transport agencies, official feeds |

Visualization todo:

- quiet, dense GIS-style context layers
- feature inspect panels with source/license/provenance
- scale-aware labels and collision rules
- explicit badge for stale static datasets

### 7. Supply Chain and Economic Activity

This is a later layer family once mobility, infrastructure, and provenance are stable.

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `supply.port_activity` | vessel traffic, berth/anchorage context | AIS plus port authority open data |
| `supply.airport_activity` | aircraft activity, delays, cargo hints | OpenSky plus airport open data |
| `supply.border_crossings` | road border wait and crossing status | CBSA/CBP where available |
| `supply.freight_corridors` | road/rail/port chokepoints | OSM, government transport datasets |
| `supply.commodity_prices` | oil, gas, power, metals | EIA and market APIs |
| `supply.trade_flows` | imports/exports by region | CER, Statistics Canada, UN Comtrade |
| `supply.energy_exports` | electricity/oil/gas flows | CER, EIA |
| `supply.software_ecosystem` | public package/repo activity | GitHub API, registry APIs |

Visualization todo:

- chokepoint overlays
- flow arcs between ports, borders, and regions
- market timeline panels
- public software supply-chain pulse layer

### 8. Orbital and Space Systems

Keep the detailed orbital roadmap in `cosmic-scope-roadmap.md`, but treat the following as
non-weather OSINT layers:

| Layer | Shows | Candidate sources |
| --- | --- | --- |
| `space.satellites.live` | propagated satellite positions | CelesTrak GP/TLE/OMM |
| `space.satellites.ground_tracks` | ground tracks and pass windows | CelesTrak |
| `space.debris_density` | orbital shell object density | CelesTrak, Space-Track where credentials permit |
| `space.weather` | Kp, solar wind, geomagnetic alerts, aurora | NOAA SWPC |
| `space.neos` | near-Earth objects and close approaches | JPL CNEOS/SBDB, MPC |
| `space.ephemerides` | Sun, Moon, planets, named bodies | JPL Horizons |

## Implementation Order

### Phase N0: Foundation

- [ ] Fix current source/provenance debt before expanding: no mock-mode live leakage, no
      blocking simulation calls on request paths, no source-status drift.
- [ ] Add source/provenance registry entries for non-weather sources.
- [ ] Add shared `WorldEvent` schema for non-weather and civic-operational events.
- [ ] Extend `SpatiotemporalEvent` with `source_kind`, `license`, `privacy_class`,
      `confidence`, `valid_time`, `observed_time`, `fetched_time`, and graph identifiers
      where needed.
- [ ] Add non-weather adapter interface returning events, not view-specific layer objects.
- [ ] Add public-data event archive and replay API for non-weather kinds.
- [ ] Add live event WebSocket or SSE endpoint after REST replay works.
- [ ] Add source health/freshness/provenance overlay.
- [ ] Add mode switcher: Weather, Earth, Cyberspace, Hyperreality, Infrastructure, Space.
- [ ] Add UI badges for public/licensed/aggregate/derived/user-owned/restricted data.

### Phase N1: Life Safety and Daily Operations

- [ ] `alerts.npas_cap`: Canadian NPAS/CAP-CP emergency alerts.
- [ ] `alerts.cap_generic`: generic CAP 1.2 emergency-alert adapter.
- [ ] `alerts.canada_recalls`: Canada recalls and safety alerts.
- [ ] `alerts.openfda_food_recalls`, `alerts.openfda_drug_recalls`,
      `alerts.openfda_device_recalls`: FDA recall enforcement reports.
- [ ] `roads.alberta_511`: Alberta road conditions, cameras, ferries, parks, events, alerts,
      and weather stations.
- [ ] `roads.ontario_511`: Ontario road events, construction, cameras, conditions, ferries,
      truck stops, alerts, and related traveler information.
- [ ] `roads.drivebc_open511`: BC provincial highway events through Open511.
- [ ] `roads.cbsa_border_waits`: Canada-bound land border wait times.
- [ ] `roads.cbp_waittimes`: US-bound border wait times.
- [ ] `water.municipal_boiling_advisories`: first boil-water/drinking-water advisory pilot.

### Phase N2: Infrastructure, Transit, Health, and Water

- [ ] `mobility.mobility_database`: feed discovery for GTFS, GTFS Realtime, and GBFS.
- [ ] `mobility.gtfs_static`: static GTFS ingest.
- [ ] `mobility.gtfs_realtime`: vehicle positions, trip updates, and service alerts.
- [ ] `mobility.gbfs`: bikeshare/scooter station and vehicle availability.
- [ ] `energy.aeso`: Alberta load, generation, market data, and alerts where available.
- [ ] `energy.ieso`: Ontario demand, supply mix, market data, and forecast data.
- [ ] `energy.hydro_quebec`: Quebec electricity demand and outage datasets where permitted.
- [ ] `energy.bc_hydro_interties`: public intertie flows where terms allow.
- [ ] `energy.eia_grid`: US grid demand, forecast demand, generation, prices, and interchange.
- [ ] `energy.utility_outage_scraper_terms_checked`: common outage adapter framework with
      explicit terms approval per utility.
- [ ] `health.who_outbreaks` and `health.who_emergency_events`: official global health events.
- [ ] `health.cdc_wastewater`: public aggregate wastewater metrics.
- [ ] `water.eccc_freshwater_quality`: automated freshwater quality measurements.
- [ ] `water.datastream`: regional open water and sediment quality observations.
- [ ] `water.reservoir_levels` and `water.dam_status`: public reservoir/dam status pilots.

### Phase N3: Hazards, Environment, and Logistics

- [ ] `hazards.usgs_earthquakes`: global recent earthquakes.
- [ ] `hazards.earthquakes_canada`: Canadian seismic events.
- [ ] `hazards.usgs_volcano`: US volcano status.
- [ ] `hazards.smithsonian_gvp`: global volcano context.
- [ ] `hazards.tsunami_alerts`: tsunami watch/warning feed pilot.
- [ ] `env.openaq`: global air-quality observations.
- [ ] `env.canada_radiation`, `env.epa_radnet`, `env.eurdep_radiation`: radiation monitor
      layers.
- [ ] `env.global_forest_watch`: forest-change and disturbance alerts.
- [ ] `env.gbif_occurrence`: biodiversity occurrence context.
- [ ] `env.nasa_black_marble`: night-lights change detection.
- [ ] `logistics.aishub`: AIS vessel pilot with strict terms review.
- [ ] `logistics.aisstream_optional` and `logistics.port_congestion_optional`: licensed or
      partner logistics enrichments.
- [ ] `logistics.un_comtrade`: trade-flow context.
- [ ] `logistics.canada_rail_network`: Canadian rail-network context layer.
- [ ] `logistics.cn_customer_api_optional_user_owned`: user-owned rail shipment framework.

### Phase N4: Communications, Cyber, Context, and Hyperreality

- [ ] `rdap`: domain/IP/ASN lookup and provenance records.
- [ ] `ripestat`: ASN and prefix metadata.
- [ ] `routeviews`: historical route data and replay.
- [ ] `ihr`: internet-health metrics and outage/anomaly context.
- [ ] `ct_logs`: certificate transparency stream/index pilot.
- [ ] `censys_certificates`: licensed certificate graph enrichment.
- [ ] `shodan_internetdb`: per-IP lookup only for user-entered or user-owned assets.
- [ ] `cisa_kev`: known exploited vulnerability catalog.
- [ ] `nvd_cve`: CVE metadata.
- [ ] `first_epss`: exploit probability scores.
- [ ] Aggregate vulnerability overlays by ASN, country, sector, or user-owned inventory only.
- [ ] `context.statcan_wds`: Statistics Canada Web Data Service.
- [ ] `context.statcan_census_profile`: census/profile context.
- [ ] `context.worldbank_indicators`: World Bank indicator context.
- [ ] `context.oecd_sdmx`: OECD SDMX indicator context.
- [ ] `context.open_canada_ckan`: Open Canada CKAN discovery.
- [ ] `context.municipal_open_data`: CKAN/Socrata/ArcGIS/OpenDataSoft connector framework.
- [ ] `hyper.gdelt_events` and `hyper.gdelt_gkg`: news event and theme graph.
- [ ] `hyper.wikimedia_eventstreams`: public wiki edit pulses.
- [ ] `hyper.github_events`: public software ecosystem activity.
- [ ] `hyper.reliefweb` and `hyper.gdacs`: humanitarian/disaster context.
- [ ] `hyper.gov_news_releases`, `hyper.procurement_notices`, and `hyper.public_rss_feeds`:
      official public-information streams.

### Phase N5: Orbital and Celestial

- [ ] `celestrak_satellites`: GP/TLE/OMM ingest and SGP4 propagation worker.
- [ ] `noaa_swpc`: space weather dashboard and aurora/geomagnetic layers.
- [ ] `jpl_horizons`: ephemeris windows for Sun, Moon, planets, named objects.
- [ ] `jpl_cneos`: NEO close-approach layer.
- [ ] Reuse the cosmic roadmap for renderer, camera, and ephemeris details.

## Do-Not-Add List

- Private mobile-device location feeds.
- Private social-media scraping or account scraping.
- Private communications metadata or packet capture.
- Credential stuffing, bypassing access controls, or data from leaked credentials.
- Internet-wide scanning performed by CanWxLab.
- Raw host-level vulnerable-device maps for arbitrary public IPs.
- Facial recognition, person tracking, or doxxing workflows.
- Any layer that cannot show source, license, privacy class, and confidence.

## Source Review Checklist

Before a source becomes enabled by default:

- [ ] Official API or license-compatible source identified.
- [ ] Rate limits documented.
- [ ] Redistribution terms documented.
- [ ] Cache TTL and stale-data policy defined.
- [ ] Privacy class assigned.
- [ ] Provenance URL stored with every event.
- [ ] Test fixtures use cached or synthetic data, not live calls.
- [ ] UI labels distinguish live, cached, stale, derived, aggregate, and licensed data.
- [ ] Safety review complete for cyber, mobility, and identity-adjacent data.

## References Checked

- Public Safety Canada CAP-CP: https://www.publicsafety.gc.ca/cnt/mrgnc-mngmnt/mrgnc-prprdnss/npas/clf-en.aspx
- 511 Alberta API docs: https://511.alberta.ca/developers/doc
- Ontario 511 events API docs: https://511on.ca/help/endpoint/event
- Ontario 511 road conditions API docs: https://511on.ca/help/endpoint/roadconditions
- DriveBC Open511 API: https://api.open511.gov.bc.ca/help
- CBSA border wait times: https://www.cbsa-asfc.gc.ca/bwt-taf/menu-eng.html
- CBP advisories and wait times: https://www.cbp.gov/travel/advisories-wait-times
- OpenSky Network REST API: https://openskynetwork.github.io/opensky-api/rest.html
- GTFS Realtime: https://gtfs.org/documentation/realtime/reference/
- GTFS Realtime feed entities: https://gtfs.org/realtime/feed-entities/
- GBFS: https://gbfs.org/specification/
- Mobility Database: https://mobilitydatabase.org/faq
- AISHub API: https://www.aishub.net/api
- UN Comtrade developer portal: https://comtradedeveloper.un.org/
- Canada National Railway Network dataset reference: https://www.cer-rec.gc.ca/en/applications-hearings/pipeline-abandonment/ace-calculation-method/open-government-datasets.html
- CN customer APIs: https://www.cn.ca/en/customer-centre/tools/api/
- RIPE RIS Live: https://ris-live.ripe.net/manual/
- RouteViews: https://www.routeviews.org/routeviews/index.php/resources/
- RIPEstat API: https://stat.ripe.net/docs/data_api
- PeeringDB API docs: https://docs.peeringdb.com/api_specs/
- Cloudflare Radar API: https://developers.cloudflare.com/api/resources/radar/
- GDELT data: https://www.gdeltproject.org/data.html
- ReliefWeb API: https://apidoc.reliefweb.int/
- Wikimedia EventStreams: https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams
- GitHub Events API: https://docs.github.com/en/rest/activity/events
- USGS Earthquake GeoJSON feeds: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
- USGS Volcano API: https://volcanoes.usgs.gov/vsc/api/volcanoApi/
- NASA Black Marble: https://ladsweb.modaps.eosdis.nasa.gov/missions-and-measurements/science-domain/nighttime-lights/
- OpenAQ API docs: https://docs.openaq.org/
- Health Canada radiation surveillance: https://www.canada.ca/en/health-canada/services/environmental-workplace-health/radiation/radiation-measurement.html
- EPA RadNet near-real-time data: https://www.epa.gov/radnet/radnet-near-real-time-air-data
- DataStream platform: https://datastream.org/en-ca/platform
- WHO Disease Outbreak News: https://www.who.int/emergencies/disease-outbreak-news
- CDC wastewater data: https://www.cdc.gov/wastewater/about-data/index.html
- CDC SARS-CoV-2 wastewater dataset: https://data.cdc.gov/Public-Health-Surveillance/CDC-Wastewater-Data-for-SARS-CoV-2/j9g8-acpt
- openFDA drug enforcement API: https://open.fda.gov/apis/drug/enforcement/
- openFDA food API: https://open.fda.gov/apis/food/
- CISA Known Exploited Vulnerabilities catalog: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- NVD API: https://nvd.nist.gov/developers
- FIRST EPSS: https://www.first.org/epss/
- AESO: https://www.aeso.ca/
- EIA Open Data API: https://www.eia.gov/opendata/
- IESO Power Data: https://www.ieso.ca/Power-Data
- Hydro-Quebec electricity demand open data: https://donnees.hydroquebec.com/explore/dataset/demande-electricite-quebec/table/
- Hydro-Quebec outage open data: https://www.hydroquebec.com/documents-donnees/donnees-ouvertes/pannes-interruptions.html
- Statistics Canada Web Data Service: https://www.statcan.gc.ca/en/microdata/api
- World Bank Indicators API: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392
- OECD Data Explorer API: https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html
- Open Canada CKAN API: https://open.canada.ca/data/en/api/
- Overture Maps docs: https://docs.overturemaps.org/
