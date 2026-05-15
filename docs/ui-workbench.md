# UI Workbench

Phase 2 introduces a compact weather/GIS workbench layout focused on rapid visual iteration.

## Layout

- **Top bar**
  - app title
  - data mode badge (`MOCK`, `HYBRID`, `LIVE`)
  - current wall-clock and timeline valid time
  - map/globe toggle
  - animation controls (play/pause, speed, reset)
  - quick source-health badge
  - refresh button

- **Left sidebar tabs**
  - Layers
  - Plugin Manager
  - Sources
  - Simulation
  - Verification
  - Customize

- **Center map area**
  - MapLibre base map
  - deck.gl overlays
  - notices for fallback/disabled/empty states

- **Right inspector**
  - clicked lon/lat
  - sampled layer values
  - nearest station and active alert
  - legend
  - source summary
  - render diagnostics

- **Bottom timeline**
  - frame scrubber
  - tick marks
  - selected valid time
  - loop start/end window controls

## Empty-State Messaging

The UI surfaces these explicit states:

- `Live ECCC data disabled`
- `Live source unavailable; showing mock data`
- `No alerts returned for this view`
- `No station observations returned for this view`
- globe support unavailable warning

## Layer Badges

Layer/source badges are rendered from backend/engine status values:

- `LIVE`
- `MOCK`
- `STALE`
- `FALLBACK`
- `UNAVAILABLE`
- `EXPERIMENTAL`

## Workbench Components

Implemented in:

- `apps/web/src/components/workbench/TopBar.tsx`
- `apps/web/src/components/workbench/LeftSidebar.tsx`
- `apps/web/src/components/workbench/RightInspector.tsx`
- `apps/web/src/components/workbench/BottomTimeline.tsx`
- `apps/web/src/components/workbench/PanelTabs.tsx`
- `apps/web/src/components/workbench/StatusBadge.tsx`
- `apps/web/src/components/workbench/LegendPanel.tsx`
- `apps/web/src/components/workbench/AnimationControls.tsx`

## Visual Iteration Notes

- Mock/demo animated layers keep the UI visually active without live network dependencies.
- Customization preferences are localStorage-backed in this phase.
- For production tile infra, do not rely on public OSM endpoints.
