# Phase B: Cyberspace / Network Topology Mode

**Date:** 2026-05-17
**Status:** Draft design, awaiting Phase A completion
**Depends on:** Phase A (event sourcing foundation)

## Problem Statement

Extend the canwxlab globe from pure meteorology into network topology visualization. Map ASNs, BGP routes, IP prefix ownership, data centers, IXPs, and internet health metrics as first-class spatiotemporal layers on the same globe that shows weather.

Cyberspace mode is part of the larger non-weather OSINT backlog in
`docs/non-weather-osint-layers.md`. Its scope is public internet measurement, routing
topology, outages, registry provenance, aggregate exposure, and user-owned asset context.
It is not an internet-wide scanning product and must not render arbitrary vulnerable hosts
as a targeting layer.

## What Gets Built

### B1: ASN Registry + Prefix Ownership
- Ingest public RIR data (ARIN, RIPE, APNIC, LACNIC, AFRINIC) via RDAP/Whois
- Store ASN → organization → country mapping
- Store announced prefix → origin ASN mapping from BGP data
- H3-index prefix coverage areas for spatial query

### B2: BGP Route Visualization
- Ingest BGP updates from RouteViews/RIPE RIS archives
- Render AS paths as luminous arcs on the globe
- Arc properties: thickness = route visibility, color = AS relationship, pulse = update recency
- Time slider replays routing changes (outages, hijacks, policy shifts)

### B3: Internal IP Geolocation Estimator
- Bayesian fusion of: RIR registration, BGP origin, reverse DNS hints, latency triangulation
- Output: location estimate + confidence radius + evidence list
- Never claims precision it doesn't have (confidence radius is mandatory)
- Store results as `SpatiotemporalEvent` with `event_kind = "network.ip_location.estimate"`

### B4: Internet Health / Anomaly Detection
- Route instability index per prefix/ASN
- BGP hijack detection (sudden origin ASN changes)
- IXP outage detection (multiple peer drops)
- DDoS/scan noise aggregate heatmaps (from public telescope data)

### B5: Vulnerability Context (Aggregate/User-Owned Only)
- Ingest CISA KEV, NVD CVE metadata, and FIRST EPSS scores
- Join vulnerability data only to aggregate sectors/ASNs/countries or user-owned inventory
- Store evidence as `SpatiotemporalEvent` with `event_kind = "network.vulnerability.context"`
- Never render arbitrary public hosts with vulnerability details by default

## Data Sources

| Source | What | License |
|--------|------|---------|
| RouteViews / RIPE RIS | BGP updates and RIB dumps | Public |
| ARIN/RIPE/APNIC RDAP | ASN, prefix, org registration | Public |
| PeeringDB | IXP, facility, network metadata | Public |
| Cloudflare Radar / IHR | Outages, traffic context, BGP anomaly signals | Public/API terms |
| Certificate Transparency | Domain/cert infrastructure | Public |
| Censys/Shodan (licensed) | Exposure aggregates | Commercial |
| CISA KEV / NVD / FIRST EPSS | Vulnerability context and exploit likelihood | Public/API terms |
| RIPE Atlas | Latency probes | Public |

## Architecture Notes

- BGP events flow into the same `EventStore` from Phase A (`event_kind = "network.bgp.update"`)
- AS path arcs are pre-computed server-side as GeoJSON LineString features
- IP geolocation runs as an offline batch inference pipeline, not real-time
- Network graph (ASN → ASN edges) stored in a graph index alongside the spatial index
- Rendering uses the existing deck.gl layer system (`deck-line` for arcs, `deck-scatter` for nodes)

## New Files (sketch)

| File | Purpose |
|------|---------|
| `services/api/canwxlab_api/adapters/bgp_routeviews.py` | BGP update ingestion |
| `services/api/canwxlab_api/adapters/ip_geolocation.py` | IP → location estimator |
| `services/api/canwxlab_api/core/graph_store.py` | ASN/prefix graph index |
| `services/api/canwxlab_api/routes/cyber.py` | Network API endpoints |
| `apps/web/src/layers/renderers/deckNetworkArcs.ts` | Arc renderer |
| `apps/web/src/components/CyberspacePanel.tsx` | Network mode controls |

## Safety and Ethics

- Shodan/Censys data may enrich aggregate views or user-entered/user-owned assets only
- Vulnerability overlays are context layers, not target-selection workflows
- IP geolocation outputs always include confidence radius — never precise coordinates for individual IPs
- No raw vulnerable device exposure — only aggregates
- No unauthorized scanning — only public/volunteered/licensed data
- All BGP data is from public collectors, not private peering sessions
