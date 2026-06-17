# PKM Window Manager & Contextual Inspection System

**Date:** 2026-06-17  
**Status:** Approved — implementing

## Overview

Generic information panel / multi-level window manager system. Click any entity on the map (earthquake, aircraft, city, star) → floating detail panel opens. Panels are free-floating, draggable, minimizable to a bottom tray strip (Krita/Photoshop inspired). Generic selection system drives a cyberpunk hollow-diamond map pin. State-of-the-art GIS+PKM UX.

---

## Core Types (`src/types/entities.ts`)

Discriminated union — TypeScript narrows automatically:

```ts
export type SelectedEntity =
  | { kind: "quake";    id: string; lon: number; lat: number; data: QuakeEvent }
  | { kind: "aircraft"; id: string; lon: number; lat: number; data: AircraftState }
  | { kind: "place";    id: string; lon: number; lat: number; data: PlaceResult }
  | { kind: "star";     id: string; lon: number; lat: number; data: Star };

export type EntityKind = SelectedEntity["kind"];

export interface PlaceResult {
  name: string;
  kind: string;
  population?: number;
  country?: string;
  countryCode?: string;
  wikidata?: string;
  boundingBox?: [number, number, number, number];
}
```

---

## Entity Registry (`src/lib/entityRegistry.tsx`)

**Single extension point** — adding a new entity kind = one entry here:

```ts
export interface EntityConfig<K extends EntityKind> {
  icon: string;
  trayLabel: (e: SelectedEntity & { kind: K }) => string;
  windowTitle: (e: SelectedEntity & { kind: K }) => string;
  Panel: React.ComponentType<{ entity: SelectedEntity & { kind: K }; wm: WindowManager }>;
}
export const ENTITY_CONFIG: { [K in EntityKind]: EntityConfig<K> } = { … };
```

---

## Selection Hook (`src/hooks/useSelection.ts`)

Owns the map pin. Independent from window manager — clear pin without closing panels.

```ts
interface SelectionApi {
  selection: SelectedEntity | null;
  select: (entity: SelectedEntity) => void;
  clear: () => void;
}
```

---

## Window Manager Hook (`src/hooks/useWindowManager.ts`)

Returns stable object ref (not scattered callbacks):

```ts
interface WindowManager {
  windows: readonly ManagedWindow[];
  open:         (entity: SelectedEntity) => void;  // idempotent
  close:        (id: string) => void;
  minimize:     (id: string) => void;
  restore:      (id: string) => void;
  bringToFront: (id: string) => void;
  move:         (id: string, pos: { x: number; y: number }) => void;
}

interface ManagedWindow {
  id: string;           // `${kind}:${entity.id}`
  kind: EntityKind;
  entity: SelectedEntity;
  minimized: boolean;
  zIndex: number;       // monotonically increasing
  position: { x: number; y: number };
}
```

`open()` deduplicates — clicking same entity twice restores + focuses.

---

## Place Resolver (`src/lib/placeResolver.ts`)

Pure async function, testable in isolation:

```ts
export async function resolvePlaceAt(
  lon: number, lat: number,
  map: maplibregl.Map, point: [number, number],
): Promise<PlaceResult | null>
```

1. MapLibre label hit-test (`queryRenderedFeatures`) — zero latency
2. Fallback: Nominatim reverse geocode (rate-limited 1 req/s, AbortController)
3. Returns `null` for ocean/no-result → caller falls through to weather inspect

---

## Diamond Pin (`src/layers/renderers/selectionPin.ts`)

Pure function → deck.gl `IconLayer`:

```ts
export function createSelectionPinLayer(selection: SelectedEntity | null): IconLayer | null
```

- SVG: hollow diamond 22×22px + 14px vertical stem
- Colors: stroke `#00f5ff`, fill `rgba(0,245,255,0.12)`, SVG glow filter
- Anchor: bottom of stem at `[lon, lat]`
- Constant screen size at all zoom levels

---

## MapView Integration

One new prop — MapView stays entity-agnostic:

```ts
onEntityClick?: (entity: SelectedEntity) => void;
```

Click priority order:
1. Star hit-test (existing)
2. **Deck.gl entity pick** → `QuakeEvent | AircraftState` → `onEntityClick` → return
3. **Place resolution** → `PlaceResult` → `onEntityClick` → return
4. Weather inspect (existing)

Aircraft double-click → fly-to (separate from single-click open-panel).

---

## Window Shell (`src/components/WindowShell.tsx`)

Thin wrapper over `DraggablePanel`. Adds:
- `onMinimize` → minimize in manager
- Pointer-down on header → `bringToFront`
- `zIndex` prop on outer div
- Renders `null` when minimized (tray tab visible instead)

---

## Window Tray (`src/components/WindowTray.tsx`)

Bottom strip, Krita/Photoshop inspired. Only visible when any window is minimized.

```
┌────────────────────────────────────────────────────┐
│  [⚡ M6.2 Turkey ×]  [✈ UAL823 ×]  [◈ Istanbul ×] │
└────────────────────────────────────────────────────┘
```

- `position: fixed; bottom: <timeline-height>; left: 50%; transform: translateX(-50%)`
- Chip: icon + title (max 18 chars) + × close
- Click chip → restore + bringToFront
- Horizontal scroll if overflow

---

## Entity Panels

### QuakeDetailPanel
- Hero magnitude, place, depth, time (local + UTC)
- Modified Mercalli Intensity estimate
- Links: USGS event page, EMSC, Wikipedia region
- "Fly to" button + "Seek timeline" button

### AircraftDetailPanel
- Callsign, airline name (bundled ICAO→airline lookup ~4KB)
- ICAO24, squawk, registration, alt (ft+m), speed (kts+km/h), heading
- Traced path: PathLayer of last N dead-reckoned positions
- Projected path: LineLayer forward 30min at current heading/speed
- Links: FlightAware, FlightRadar24
- "Fly to" button (also: double-click entity on map)
- Live-updates every 30s poll

### PlaceDetailPanel
- Name, kind badge, population, country flag + name
- Timezone (from existing `timezone.ts`)
- Links: Wikipedia (via wikidata Q-id), OpenStreetMap, Google Maps
- "Inspect weather here" button → fires existing `inspectAtLocation`

### StarInfoCard (existing)
- Migrated into WindowShell for tray/z-index participation
- Content unchanged

---

## Timeline Integration

`TimelineEventPin` gains optional `lon`/`lat` fields. `quakesToPins` populates them.  
`onSeekToPin` fires with full pin on click. For quake pins: App.tsx looks up `QuakeEvent` by id → `map.flyTo()` + seek time. Non-quake pins: seek-only (existing behavior).

---

## File Map

| File | Status |
|---|---|
| `src/types/entities.ts` | New |
| `src/lib/entityRegistry.tsx` | New |
| `src/lib/placeResolver.ts` | New |
| `src/hooks/useSelection.ts` | New |
| `src/hooks/useWindowManager.ts` | New |
| `src/layers/renderers/selectionPin.ts` | New |
| `src/components/WindowShell.tsx` | New |
| `src/components/WindowTray.tsx` | New |
| `src/components/panels/QuakeDetailPanel.tsx` | New |
| `src/components/panels/AircraftDetailPanel.tsx` | New |
| `src/components/panels/PlaceDetailPanel.tsx` | New |
| `src/components/StarInfoCard.tsx` | Migrate into WindowShell |
| `src/components/MapView.tsx` | +onEntityClick, deck click, place resolve |
| `src/layers/renderers/osint.ts` | +aircraft path/projected layers |
| `src/time/eventPins.ts` | +lon/lat on TimelineEventPin |
| `src/App.tsx` | Wire hooks, pass props, timeline fly-to |
