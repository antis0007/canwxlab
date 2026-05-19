# Non-Weather OSINT Layer Backlog

Status: product and data-source backlog for the CanWxLab pivot toward a public-data
planetary OSINT workstation. This is not an implementation claim. Each source must pass
adapter tests, attribution checks, cache/rate-limit review, and UI provenance review before
it becomes a default layer.

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

## Product Modes

| Mode | Purpose | First layers |
| --- | --- | --- |
| Weather | Existing Canadian weather workstation | ECCC GeoMet, verification, hydrology, smoke, AQHI |
| Earth | Live physical/civic world model | aircraft, vessels, transit, earthquakes, public alerts, base infrastructure |
| Cyberspace | Internet topology and health | ASN registry, BGP updates, outages, IXPs, RDAP, CT summaries |
| Hyperreality | Public attention and event graph | news events, humanitarian reports, wiki edits, public GitHub activity |
| Infrastructure | Energy, transport, and critical systems | grid load, generation mix, interties, roads, ports, borders |
| Space | Orbital/celestial OSINT | satellites, ground tracks, NEOs, space weather |

## Common Event Shape

The Phase A `SpatiotemporalEvent` model should become the shared substrate for weather
and non-weather data. Non-weather adapters should emit events shaped like this:

```json
{
  "id": "event:source:type:timestamp:hash",
  "kind": "mobility.aircraft_state",
  "source_id": "opensky",
  "source_kind": "public_api",
  "status": "live",
  "privacy_class": "public_operational",
  "observed_time": "2026-05-17T20:10:00Z",
  "fetched_time": "2026-05-17T20:10:08Z",
  "valid_time": "2026-05-17T20:10:00Z",
  "geometry": {
    "type": "Point",
    "coordinates": [-113.49, 53.54]
  },
  "properties": {},
  "confidence": 0.82,
  "license": "source-specific",
  "provenance": {
    "url": "https://example.invalid/source",
    "adapter": "opensky",
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

## Layer Families

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

- [ ] Add source/provenance registry entries for non-weather sources.
- [ ] Extend `SpatiotemporalEvent` with `privacy_class`, `source_kind`, and graph identifiers
      where needed.
- [ ] Add non-weather adapter interface returning events, not view-specific layer objects.
- [ ] Add event archive and replay API for non-weather kinds.
- [ ] Add live event WebSocket or SSE endpoint after REST replay works.
- [ ] Add mode switcher: Weather, Earth, Cyberspace, Hyperreality, Infrastructure, Space.
- [ ] Add UI badges for public/licensed/aggregate/derived/user-owned/restricted data.

### Phase N1: High-Impact Public Live Layers

- [ ] `opensky_aircraft`: live aircraft points and short track replay.
- [ ] `gtfs_realtime`: one city/provider pilot for live public transit.
- [ ] `ais_vessels`: licensed or AISHub/AISStream vessel pilot with strict terms review.
- [ ] `usgs_earthquakes`: global recent earthquakes.
- [ ] `earthquakes_canada`: Canadian seismic layer.
- [ ] `gdacs_disasters`: global disaster alerts.
- [ ] `gdelt_events`: news event points and topic panels.
- [ ] `wikimedia_eventstreams`: public wiki edit pulses.
- [ ] `cloudflare_radar`: internet outages and traffic context.
- [ ] `ripe_ris_live`: BGP live updates.
- [ ] `peeringdb`: IXPs/facilities/networks.

### Phase N2: Systems and Infrastructure

- [ ] `aeso_grid`: Alberta load, generation, and market data.
- [ ] `ieso_grid`: Ontario demand, supply mix, and market data.
- [ ] `hydroquebec_demand`: Quebec electricity demand.
- [ ] `eia_grid_monitor`: US grid demand, forecast demand, generation, and interchange.
- [ ] `bc_hydro_interties`: public intertie flows where terms allow.
- [ ] `cer_energy_flows`: Canadian energy imports/exports.
- [ ] `overture_base`: buildings, divisions, transportation, and places from GeoParquet.
- [ ] `osm_context`: roads, rail, power, critical facilities with production-safe tile/data
      policy.
- [ ] `public_safety_cap`: official CAP/RSS emergency feed adapter.

### Phase N3: Cyber Intelligence

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

### Phase N4: Orbital and Celestial

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

- OpenSky Network REST API: https://openskynetwork.github.io/opensky-api/rest.html
- GTFS Realtime: https://gtfs.org/documentation/realtime/reference/
- GBFS: https://gbfs.org/specification/
- AISHub API: https://www.aishub.net/api
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
- CISA Known Exploited Vulnerabilities catalog: https://www.cisa.gov/known-exploited-vulnerabilities-catalog
- NVD API: https://nvd.nist.gov/developers
- FIRST EPSS: https://www.first.org/epss/
- EIA Open Data API: https://www.eia.gov/opendata/
- IESO Power Data: https://www.ieso.ca/Power-Data
- Overture Maps docs: https://docs.overturemaps.org/
