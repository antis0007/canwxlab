# PKM Window Manager & Contextual Inspection System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-floating window manager with contextual entity panels (quake, aircraft, place, star) driven by a unified selection system, diamond map pin, and Krita-style minimized window tray strip.

**Architecture:** Hook-pair (`useSelection` + `useWindowManager`) at App.tsx level. MapView picks deck.gl entities via private `_deck.pickObject` in MapLibre's click handler, fires `onEntityClick`. Entity panels are self-contained components registered in `ENTITY_CONFIG`. `WindowShell` wraps all panels with drag/resize/minimize/z-index. Minimized windows appear in `WindowTray` (fixed bottom strip above timeline).

**Tech Stack:** React 18, TypeScript 5.5, deck.gl 9, MapLibre GL JS 5, Vitest 2

## Global Constraints

- CSS: `wb-*` prefix, use `var(--wb-*)` design tokens, never hardcode colors
- Tests: Vitest, import `{ describe, expect, it }` from `"vitest"`
- No new npm dependencies
- All deck.gl layer builders remain pure functions (no internal state/network)
- `DraggablePanel` is not modified (other components depend on it)
- `MapView`'s `useEffect([], [])` map-init block is append-only: add new handlers, don't reorder existing ones
- Commit after every task

---

### Task 1: Core entity types

**Files:**
- Create: `apps/web/src/types/entities.ts`

**Interfaces:**
- Produces: `SelectedEntity`, `EntityKind`, `PlaceResult` — used by every subsequent task

- [ ] **Step 1: Create `src/types/entities.ts`**

```ts
import type { Star } from "../lib/celestialSphere";
import type { AircraftState } from "../lib/liveFeeds/aircraft";
import type { QuakeEvent } from "../lib/liveFeeds/quakes";

export interface PlaceResult {
  name: string;
  kind: string;
  population?: number;
  country?: string;
  countryCode?: string;
  wikidata?: string;
  boundingBox?: [number, number, number, number];
}

export type SelectedEntity =
  | { kind: "quake";    id: string; lon: number; lat: number; data: QuakeEvent }
  | { kind: "aircraft"; id: string; lon: number; lat: number; data: AircraftState }
  | { kind: "place";    id: string; lon: number; lat: number; data: PlaceResult }
  | { kind: "star";     id: string; lon: number; lat: number; data: Star };

export type EntityKind = SelectedEntity["kind"];

export function entityWindowId(e: SelectedEntity): string {
  return `${e.kind}:${e.id}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/types/entities.ts
git commit -m "feat(pkm): core entity discriminated union types"
```

---

### Task 2: `useSelection` hook

**Files:**
- Create: `apps/web/src/hooks/useSelection.ts`

**Interfaces:**
- Consumes: `SelectedEntity` from `../types/entities`
- Produces: `SelectionApi` with `{ selection, select, clear }`

- [ ] **Step 1: Create hook**

```ts
import { useState, useCallback } from "react";
import type { SelectedEntity } from "../types/entities";

export interface SelectionApi {
  selection: SelectedEntity | null;
  select: (entity: SelectedEntity) => void;
  clear: () => void;
}

export function useSelection(): SelectionApi {
  const [selection, setSelection] = useState<SelectedEntity | null>(null);

  const select = useCallback((entity: SelectedEntity) => {
    setSelection((prev) =>
      prev?.kind === entity.kind && prev.id === entity.id ? null : entity,
    );
  }, []);

  const clear = useCallback(() => setSelection(null), []);

  return { selection, select, clear };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useSelection.ts
git commit -m "feat(pkm): useSelection hook — toggle-select entities on the map"
```

---

### Task 3: `useWindowManager` hook

**Files:**
- Create: `apps/web/src/hooks/useWindowManager.ts`

**Interfaces:**
- Consumes: `SelectedEntity`, `EntityKind`, `entityWindowId` from `../types/entities`
- Produces: `WindowManager`, `ManagedWindow` — used by App.tsx, WindowShell, WindowTray

- [ ] **Step 1: Create hook**

```ts
import { useCallback, useMemo, useReducer, useRef } from "react";
import { entityWindowId } from "../types/entities";
import type { SelectedEntity, EntityKind } from "../types/entities";

export interface ManagedWindow {
  id: string;
  kind: EntityKind;
  entity: SelectedEntity;
  minimized: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

export interface WindowManager {
  windows: readonly ManagedWindow[];
  open:         (entity: SelectedEntity) => void;
  close:        (id: string) => void;
  minimize:     (id: string) => void;
  restore:      (id: string) => void;
  bringToFront: (id: string) => void;
  move:         (id: string, pos: { x: number; y: number }) => void;
  resize:       (id: string, size: { width: number; height: number }) => void;
}

type Action =
  | { type: "open";         entity: SelectedEntity; zIndex: number }
  | { type: "close";        id: string }
  | { type: "minimize";     id: string }
  | { type: "restore";      id: string }
  | { type: "bringToFront"; id: string; zIndex: number }
  | { type: "move";         id: string; pos: { x: number; y: number } }
  | { type: "resize";       id: string; size: { width: number; height: number } };

const DEFAULT_SIZE = { width: 300, height: 380 };
const PANEL_OFFSET = 40;

function defaultPosition(index: number): { x: number; y: number } {
  const base = typeof window !== "undefined"
    ? { x: window.innerWidth - DEFAULT_SIZE.width - 24, y: 60 }
    : { x: 600, y: 60 };
  return { x: base.x - index * PANEL_OFFSET, y: base.y + index * PANEL_OFFSET };
}

function reducer(state: ManagedWindow[], action: Action): ManagedWindow[] {
  switch (action.type) {
    case "open": {
      const id = entityWindowId(action.entity);
      const existing = state.find((w) => w.id === id);
      if (existing) {
        return state.map((w) =>
          w.id === id ? { ...w, minimized: false, zIndex: action.zIndex } : w,
        );
      }
      const newWin: ManagedWindow = {
        id,
        kind: action.entity.kind,
        entity: action.entity,
        minimized: false,
        zIndex: action.zIndex,
        position: defaultPosition(state.length % 5),
        size: DEFAULT_SIZE,
      };
      return [...state, newWin];
    }
    case "close":
      return state.filter((w) => w.id !== action.id);
    case "minimize":
      return state.map((w) => w.id === action.id ? { ...w, minimized: true } : w);
    case "restore":
      return state.map((w) => w.id === action.id ? { ...w, minimized: false } : w);
    case "bringToFront":
      return state.map((w) =>
        w.id === action.id ? { ...w, zIndex: action.zIndex } : w,
      );
    case "move":
      return state.map((w) => w.id === action.id ? { ...w, position: action.pos } : w);
    case "resize":
      return state.map((w) => w.id === action.id ? { ...w, size: action.size } : w);
    default:
      return state;
  }
}

export function useWindowManager(): WindowManager {
  const [windows, dispatch] = useReducer(reducer, []);
  const zRef = useRef(200);

  const open = useCallback((entity: SelectedEntity) => {
    dispatch({ type: "open", entity, zIndex: ++zRef.current });
  }, []);
  const close        = useCallback((id: string) => dispatch({ type: "close", id }), []);
  const minimize     = useCallback((id: string) => dispatch({ type: "minimize", id }), []);
  const restore      = useCallback((id: string) => dispatch({ type: "restore", id }), []);
  const bringToFront = useCallback((id: string) => dispatch({ type: "bringToFront", id, zIndex: ++zRef.current }), []);
  const move         = useCallback((id: string, pos: { x: number; y: number }) => dispatch({ type: "move", id, pos }), []);
  const resize       = useCallback((id: string, size: { width: number; height: number }) => dispatch({ type: "resize", id, size }), []);

  return useMemo<WindowManager>(
    () => ({ windows, open, close, minimize, restore, bringToFront, move, resize }),
    [windows, open, close, minimize, restore, bringToFront, move, resize],
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useWindowManager.ts
git commit -m "feat(pkm): useWindowManager hook — open/close/minimize/resize/z-index"
```

---

### Task 4: Place resolver

**Files:**
- Create: `apps/web/src/lib/placeResolver.ts`

**Interfaces:**
- Consumes: MapLibre `Map` type
- Produces: `resolvePlaceAt(lon, lat, map, point): Promise<PlaceResult | null>`

- [ ] **Step 1: Create place resolver**

```ts
import type maplibregl from "maplibre-gl";
import type { PlaceResult } from "../types/entities";

const PLACE_LABEL_LAYERS = [
  "place-label", "settlement-label", "settlement-subdivision-label",
  "country-label", "state-label", "poi-label",
];

let lastNominatimMs = 0;
let pendingAbort: AbortController | null = null;

function parseNominatim(body: unknown): PlaceResult | null {
  const r = body as Record<string, unknown>;
  if (!r || typeof r !== "object") return null;
  const name = String(r.name ?? r.display_name ?? "").split(",")[0].trim();
  if (!name) return null;

  const addr = r.address as Record<string, string> | undefined ?? {};
  const country = addr.country ?? String(r.display_name ?? "").split(",").at(-1)?.trim() ?? "";
  const countryCode = addr.country_code?.toUpperCase();

  let kind = String(r.type ?? r.class ?? "place");
  if (["city", "town", "village", "suburb", "county", "state", "country"].includes(kind)) {
    // keep as-is
  } else if (addr.city) kind = "city";
  else if (addr.town) kind = "town";
  else if (addr.village) kind = "village";

  const wikidata = String(r.extratags && (r.extratags as Record<string,string>).wikidata || "");
  const bb = r.boundingbox as string[] | undefined;

  return {
    name,
    kind,
    country,
    countryCode,
    wikidata: wikidata || undefined,
    boundingBox: bb
      ? [parseFloat(bb[2]), parseFloat(bb[0]), parseFloat(bb[3]), parseFloat(bb[1])]
      : undefined,
  };
}

export async function resolvePlaceAt(
  lon: number,
  lat: number,
  map: maplibregl.Map,
  point: [number, number],
): Promise<PlaceResult | null> {
  // 1. Zero-latency: query already-rendered vector tile labels
  const features = map.queryRenderedFeatures(
    [point[0], point[1]] as [number, number],
    { layers: PLACE_LABEL_LAYERS.filter((l) => map.getLayer(l) !== undefined) },
  );
  if (features.length > 0) {
    const f = features[0];
    const props = f.properties ?? {};
    const name = String(props.name ?? props["name:en"] ?? "");
    if (name) {
      return {
        name,
        kind: String(props.class ?? props.type ?? props.place ?? "place"),
        population: props.population ? Number(props.population) : undefined,
        country: undefined,
        countryCode: undefined,
        wikidata: props.wikidata ? String(props.wikidata) : undefined,
      };
    }
  }

  // 2. Nominatim fallback — 1 req/s per OSM ToS
  const nowMs = Date.now();
  const gapMs = nowMs - lastNominatimMs;
  if (gapMs < 1000) await new Promise((r) => setTimeout(r, 1000 - gapMs));

  pendingAbort?.abort();
  pendingAbort = new AbortController();

  try {
    lastNominatimMs = Date.now();
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&format=jsonv2&extratags=1&addressdetails=1`;
    const res = await fetch(url, {
      signal: pendingAbort.signal,
      headers: { "Accept-Language": "en", "User-Agent": "CanWxLab/1.0" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return parseNominatim(body);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/placeResolver.ts
git commit -m "feat(pkm): place resolver — MapLibre label hit-test + Nominatim fallback"
```

---

### Task 5: Selection diamond pin layer

**Files:**
- Create: `apps/web/src/layers/renderers/selectionPin.ts`

**Interfaces:**
- Consumes: `SelectedEntity | null`
- Produces: `createSelectionPinLayer(selection): IconLayer | null`

- [ ] **Step 1: Create selection pin layer**

```ts
import { IconLayer } from "@deck.gl/layers";
import type { SelectedEntity } from "../../types/entities";

// Cyberpunk hollow-diamond with stem — inline SVG data-URI, zero network fetch.
// 22×36 canvas: diamond occupies rows 1–21, stem rows 21–35.
// Glow achieved via SVG feDropShadow filter.
const DIAMOND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="36" viewBox="0 0 22 36">
  <defs>
    <filter id="g" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="%2300f5ff" flood-opacity="0.8"/>
    </filter>
  </defs>
  <polygon points="11,2 20,11 11,20 2,11"
    fill="rgba(0,245,255,0.12)" stroke="%2300f5ff" stroke-width="1.5"
    filter="url(%23g)"/>
  <line x1="11" y1="20" x2="11" y2="34"
    stroke="%2300f5ff" stroke-width="1.2" opacity="0.75"/>
</svg>`;

const DIAMOND_DATA_URI = `data:image/svg+xml,${DIAMOND_SVG.replace(/\n\s*/g, "").replace(/"/g, "'")}`;

const ICON_MAPPING = {
  pin: { x: 0, y: 0, width: 22, height: 36, anchorY: 36, mask: false },
};

interface PinDatum {
  position: [number, number];
}

export function createSelectionPinLayer(selection: SelectedEntity | null): IconLayer<PinDatum> | null {
  if (!selection) return null;
  return new IconLayer<PinDatum>({
    id: "selection-pin",
    data: [{ position: [selection.lon, selection.lat] }],
    iconAtlas: DIAMOND_DATA_URI,
    iconMapping: ICON_MAPPING,
    getIcon: () => "pin",
    getPosition: (d) => d.position,
    getSize: 36,
    sizeUnits: "pixels",
    sizeScale: 1,
    pickable: false,
  });
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/layers/renderers/selectionPin.ts
git commit -m "feat(pkm): cyberpunk hollow-diamond selection pin — deck.gl IconLayer"
```

---

### Task 6: `TimelineEventPin` lon/lat + OSINT layer `onPick`

**Files:**
- Modify: `apps/web/src/time/eventPins.ts`
- Modify: `apps/web/src/layers/renderers/osint.ts`
- Modify: `apps/web/src/time/eventPins.test.ts` (verify tests still pass)

**Interfaces:**
- `TimelineEventPin` gains optional `lon?: number; lat?: number`
- `createQuakeLayer(quakes, nowMs, opts?: { onPick?: (q: QuakeEvent) => void })`
- `createAircraftLayers(states, nowMs, opts?: { onPick?: (s: AircraftState) => void })`

- [ ] **Step 1: Add lon/lat to `TimelineEventPin` and populate in `quakesToPins`**

In `apps/web/src/time/eventPins.ts`, change:

```ts
export interface TimelineEventPin {
  id: string;
  timeMs: number;
  label: string;
  kind: EventPinKind;
  severity: EventPinSeverity;
  lon?: number;
  lat?: number;
}
```

And update `quakesToPins`:
```ts
pins.push({
  id: `quake:${q.id}`,
  timeMs: q.timeMs,
  label: `M${q.magnitude.toFixed(1)} ${q.place}`,
  kind: "quake",
  severity: q.magnitude >= 6.0 ? "critical" : "warning",
  lon: q.lon,
  lat: q.lat,
});
```

- [ ] **Step 2: Add `onPick` option to `createQuakeLayer`**

In `apps/web/src/layers/renderers/osint.ts`, change the signature:

```ts
export function createQuakeLayer(
  quakes: QuakeEvent[],
  nowMs: number,
  opts?: { onPick?: (q: QuakeEvent) => void },
) {
  if (quakes.length === 0) return null;
  return new ScatterplotLayer<QuakeEvent>({
    id: "osint-quakes",
    data: quakes,
    getPosition: (q) => [q.lon, q.lat],
    getRadius: (q) => quakeRadiusM(q.magnitude),
    getFillColor: (q) => {
      const [r, g, b, a] = quakeColor(q.magnitude, q.timeMs, nowMs);
      return [r, g, b, Math.round(a * 0.25)];
    },
    getLineColor: (q) => quakeColor(q.magnitude, q.timeMs, nowMs),
    getLineWidth: 1.5,
    lineWidthUnits: "pixels",
    stroked: true,
    filled: true,
    radiusUnits: "meters",
    pickable: true,
    onClick: opts?.onPick ? (info) => { if (info.object) opts.onPick!(info.object); return true; } : undefined,
  });
}
```

- [ ] **Step 3: Add `onPick` option to `createAircraftLayers`**

In `apps/web/src/layers/renderers/osint.ts`, change the aircraft layers:

```ts
export function createAircraftLayers(
  states: AircraftState[],
  nowMs: number,
  opts?: { onPick?: (s: AircraftState) => void },
) {
  if (states.length === 0) return [];
  const darts = buildAircraftDarts(states, nowMs);
  return [
    new LineLayer<AircraftDart>({
      id: "osint-aircraft-heading",
      data: darts,
      getSourcePosition: (d) => d.position,
      getTargetPosition: (d) => d.tip,
      getColor: (d) => d.color,
      getWidth: 2,
      widthUnits: "pixels",
    }),
    new ScatterplotLayer<AircraftDart>({
      id: "osint-aircraft",
      data: darts,
      getPosition: (d) => d.position,
      getFillColor: (d) => d.color,
      getRadius: 5,
      radiusUnits: "pixels",
      pickable: true,
      onClick: opts?.onPick
        ? (info) => { if (info.object) opts.onPick!(info.object.state); return true; }
        : undefined,
    }),
  ];
}
```

- [ ] **Step 4: Run existing tests**

Run: `cd apps/web && npx vitest run src/time/eventPins.test.ts 2>&1 | tail -15`
Expected: all pass

- [ ] **Step 5: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/time/eventPins.ts apps/web/src/layers/renderers/osint.ts
git commit -m "feat(pkm): TimelineEventPin lon/lat + OSINT layer onPick callbacks"
```

---

### Task 7: Aircraft path + projected layers

**Files:**
- Create: `apps/web/src/layers/renderers/aircraftPaths.ts`

**Interfaces:**
- Consumes: `AircraftState` from `../../lib/liveFeeds/aircraft`, `deadReckon` from `./osint`
- Produces:
  - `createTracedPathLayer(positions: [number,number][], color: [number,number,number,number]): PathLayer | null`
  - `createProjectedPathLayer(state: AircraftState, nowMs: number): LineLayer | null`

- [ ] **Step 1: Create aircraft path layers**

```ts
import { LineLayer, PathLayer } from "@deck.gl/layers";
import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import { aircraftColor, deadReckon } from "./osint";

const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_000;

/** Trace of recorded positions (longitude, latitude pairs). */
export function createTracedPathLayer(
  positions: [number, number][],
  color: [number, number, number, number],
): PathLayer | null {
  if (positions.length < 2) return null;
  return new PathLayer({
    id: "aircraft-trace",
    data: [{ path: positions }],
    getPath: (d: { path: [number, number][] }) => d.path,
    getColor: () => color,
    getWidth: 1.5,
    widthUnits: "pixels",
    capRounded: true,
    jointRounded: true,
    pickable: false,
  });
}

/** Dead-reckon forward PROJECTION_MINUTES at current speed/heading. */
const PROJECTION_MINUTES = 30;
const PROJECTION_STEPS = 10;

export function createProjectedPathLayer(
  state: AircraftState,
  nowMs: number,
): LineLayer | null {
  if (state.onGround || state.velocityMps <= 0) return null;
  const base = deadReckon(state, nowMs);
  const headingRad = state.headingDeg * DEG_TO_RAD;
  const totalDistM = state.velocityMps * PROJECTION_MINUTES * 60;
  const stepDistM = totalDistM / PROJECTION_STEPS;
  const points: [number, number][] = [base];
  let [lon, lat] = base;
  for (let i = 0; i < PROJECTION_STEPS; i++) {
    const cosLat = Math.max(0.05, Math.cos(lat * DEG_TO_RAD));
    const dLat = (stepDistM * Math.cos(headingRad)) / EARTH_RADIUS_M / DEG_TO_RAD;
    const dLon = (stepDistM * Math.sin(headingRad)) / (EARTH_RADIUS_M * cosLat) / DEG_TO_RAD;
    lon += dLon;
    lat += dLat;
    points.push([lon, lat]);
  }
  const color = aircraftColor(state);
  return new LineLayer({
    id: "aircraft-projected",
    data: points.slice(0, -1).map((start, i) => ({ start, end: points[i + 1] })),
    getSourcePosition: (d: { start: [number, number] }) => d.start,
    getTargetPosition: (d: { end: [number, number] }) => d.end,
    getColor: () => [color[0], color[1], color[2], Math.round(180 * (1 - 0.06))],
    getWidth: () => 1.2,
    widthUnits: "pixels",
    getDashArray: () => [4, 3],
    dashJustified: true,
    extensions: [],
    pickable: false,
  });
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/layers/renderers/aircraftPaths.ts
git commit -m "feat(pkm): aircraft traced + projected path layers"
```

---

### Task 8: ICAO airline lookup

**Files:**
- Create: `apps/web/src/lib/icaoAirlines.ts`

**Interfaces:**
- Produces: `lookupAirline(icao24OrCallsign: string): string | null`

- [ ] **Step 1: Create airline lookup**

```ts
// Top ~60 ICAO airline codes → common name. Expand as needed.
const AIRLINES: Record<string, string> = {
  UAL: "United Airlines", AAL: "American Airlines", DAL: "Delta Air Lines",
  SWA: "Southwest Airlines", SKW: "SkyWest Airlines", ASA: "Alaska Airlines",
  JBU: "JetBlue Airways", FFT: "Frontier Airlines", NKS: "Spirit Airlines",
  HAL: "Hawaiian Airlines", ENY: "Envoy Air", RPA: "Republic Airways",
  BAW: "British Airways", DLH: "Lufthansa", AFR: "Air France",
  KLM: "KLM Royal Dutch Airlines", UAE: "Emirates", QFA: "Qantas",
  ACA: "Air Canada", CCA: "Air China", CES: "China Eastern",
  CSN: "China Southern", JAL: "Japan Airlines", ANA: "All Nippon Airways",
  KAL: "Korean Air", SIA: "Singapore Airlines", THA: "Thai Airways",
  QTR: "Qatar Airways", ETH: "Ethiopian Airlines", SAA: "South African Airways",
  IBE: "Iberia", VLG: "Vueling", EZY: "easyJet", RYR: "Ryanair",
  THY: "Turkish Airlines", SVR: "Aeroflot", MSR: "EgyptAir",
  AEE: "Aegean Airlines", CFG: "Condor", EIN: "Aer Lingus",
  SAS: "Scandinavian Airlines", FIN: "Finnair", LOT: "LOT Polish Airlines",
  AZA: "ITA Airways", TAP: "TAP Air Portugal", RAM: "Royal Air Maroc",
  MEA: "Middle East Airlines", GFA: "Gulf Air", OMA: "Oman Air",
  PIA: "Pakistan International Airlines", AIZ: "Airzena Georgian Airways",
  AMX: "Aeroméxico", LAN: "LATAM Airlines", AVA: "Avianca",
  GLO: "Gol Transportes Aéreos", TAM: "LATAM Brasil",
  VOE: "Volaris", VIV: "VivaAerobus",
  VIR: "Virgin Atlantic", TOM: "TUI Airways", TCX: "Thomas Cook Airlines",
};

export function lookupAirline(callsign: string): string | null {
  if (!callsign) return null;
  // Callsign prefix is first 3 chars (ICAO designator)
  const prefix = callsign.slice(0, 3).toUpperCase();
  return AIRLINES[prefix] ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/icaoAirlines.ts
git commit -m "feat(pkm): ICAO airline name lookup table"
```

---

### Task 9: `WindowShell` component + CSS

**Files:**
- Create: `apps/web/src/components/WindowShell.tsx`
- Modify: `apps/web/src/workbench.css` (append new classes)

**Interfaces:**
- Consumes: `WindowManager`, `ManagedWindow` from `../hooks/useWindowManager`
- Produces: `WindowShell` component

- [ ] **Step 1: Create `WindowShell.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { WindowManager } from "../hooks/useWindowManager";

export interface WindowShellProps {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  zIndex: number;
  initialPosition: { x: number; y: number };
  initialSize: { width: number; height: number };
  minWidth?: number;
  minHeight?: number;
  onClose: () => void;
  onMinimize: () => void;
  onFocus: () => void;
  onMove: (pos: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number }) => void;
  children: ReactNode;
  wm: WindowManager;
}

type Pos = { x: number; y: number };
type Size = { width: number; height: number };

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function clampPos(pos: Pos, size: Size): Pos {
  if (typeof window === "undefined") return pos;
  return {
    x: clamp(pos.x, 0, window.innerWidth - size.width - 4),
    y: clamp(pos.y, 0, window.innerHeight - 60),
  };
}

export function WindowShell({
  id, title, subtitle, icon, zIndex,
  initialPosition, initialSize,
  minWidth = 240, minHeight = 160,
  onClose, onMinimize, onFocus, onMove, onResize,
  children,
}: WindowShellProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<Pos | null>(null);
  const resizeOrigin = useRef<{ mouseX: number; mouseY: number; w: number; h: number } | null>(null);
  const [pos, setPos] = useState<Pos>(() => clampPos(initialPosition, initialSize));
  const [size, setSize] = useState<Size>(initialSize);

  // Drag — header
  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
    onFocus();
  }, [pos.x, pos.y, onFocus]);

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    const off = dragOffset.current;
    if (!off) return;
    const next = clampPos({ x: e.clientX - off.x, y: e.clientY - off.y }, size);
    setPos(next);
  }, [size]);

  const onHeaderPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragOffset.current) return;
    dragOffset.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /**/ }
    onMove(pos);
  }, [pos, onMove]);

  // Resize — bottom-right handle
  const onResizePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    resizeOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, w: size.width, h: size.height };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [size]);

  const onResizePointerMove = useCallback((e: React.PointerEvent) => {
    const o = resizeOrigin.current;
    if (!o) return;
    const newW = clamp(o.w + (e.clientX - o.mouseX), minWidth, 640);
    const newH = clamp(o.h + (e.clientY - o.mouseY), minHeight, 820);
    setSize({ width: newW, height: newH });
  }, [minWidth, minHeight]);

  const onResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (!resizeOrigin.current) return;
    resizeOrigin.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /**/ }
    onResize(size);
  }, [size, onResize]);

  // Re-clamp after mount (saved position may be off-screen)
  useEffect(() => {
    setPos((p) => clampPos(p, size));
  }, [size]);

  const style: CSSProperties = {
    position: "fixed",
    left: pos.x,
    top: pos.y,
    width: size.width,
    height: size.height,
    zIndex,
  };

  return (
    <div
      ref={shellRef}
      className="wb-shell"
      style={style}
      role="dialog"
      aria-label={typeof title === "string" ? title : id}
    >
      {/* Header */}
      <div
        className="wb-shell-header"
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
      >
        <div className="wb-shell-title-block">
          {icon && <span className="wb-shell-icon">{icon}</span>}
          <div className="wb-shell-title">{title}</div>
          {subtitle && <div className="wb-shell-subtitle">{subtitle}</div>}
        </div>
        <div className="wb-shell-controls" data-no-drag="">
          <button type="button" className="wb-shell-btn" onClick={onMinimize} title="Minimize" aria-label="Minimize panel">−</button>
          <button type="button" className="wb-shell-btn wb-shell-close" onClick={onClose} title="Close" aria-label="Close panel">×</button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="wb-shell-body">{children}</div>

      {/* Resize handle */}
      <div
        className="wb-shell-resize-handle"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        aria-hidden="true"
      />
    </div>
  );
}
```

- [ ] **Step 2: Add CSS to `workbench.css`**

Append to the end of `apps/web/src/workbench.css`:

```css
/* ===== WINDOW SHELL (PKM floating panels) ===== */
.wb-shell {
  display: flex;
  flex-direction: column;
  background: var(--wb-panel);
  border: 1px solid var(--wb-line);
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,245,255,0.06);
  user-select: none;
}
.wb-shell-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 7px;
  background: var(--wb-panel-hi);
  border-bottom: 1px solid var(--wb-line);
  cursor: grab;
  touch-action: none;
  flex-shrink: 0;
}
.wb-shell-header:active { cursor: grabbing; }
.wb-shell-title-block { display: flex; align-items: baseline; gap: 5px; min-width: 0; flex: 1; }
.wb-shell-icon { font-size: 11px; flex-shrink: 0; }
.wb-shell-title {
  font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
  color: var(--wb-accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.wb-shell-subtitle {
  font-size: 9px; color: var(--wb-muted); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; flex-shrink: 1;
}
.wb-shell-controls { display: flex; gap: 3px; flex-shrink: 0; }
.wb-shell-btn {
  width: 20px; height: 20px; padding: 0; font-size: 13px; line-height: 1;
  background: transparent; color: var(--wb-muted);
  border: 1px solid var(--wb-line); border-radius: 2px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.wb-shell-btn:hover { color: var(--wb-text); border-color: var(--wb-accent-dim); }
.wb-shell-close:hover { color: var(--wb-err); border-color: var(--wb-err); }
.wb-shell-body { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 10px; user-select: text; }
.wb-shell-resize-handle {
  position: absolute; bottom: 0; right: 0; width: 14px; height: 14px;
  cursor: se-resize; touch-action: none;
}
.wb-shell-resize-handle::after {
  content: "";
  position: absolute; bottom: 3px; right: 3px;
  width: 6px; height: 6px;
  border-right: 1.5px solid var(--wb-muted); border-bottom: 1.5px solid var(--wb-muted);
  border-radius: 0 0 2px 0;
}
/* ── Entity panel shared styles ── */
.wb-ep-hero { text-align: center; padding: 8px 0 4px; }
.wb-ep-hero-val { font-size: 36px; font-weight: 800; color: var(--wb-text); line-height: 1; }
.wb-ep-hero-label { font-size: 10px; color: var(--wb-muted); letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
.wb-ep-grid { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 11px; margin: 8px 0; }
.wb-ep-grid dt { color: var(--wb-muted); }
.wb-ep-grid dd { color: var(--wb-text); font-weight: 600; margin: 0; }
.wb-ep-badge {
  display: inline-block; padding: 1px 6px; border-radius: 2px; font-size: 9px;
  font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase;
  background: var(--wb-accent-glow); color: var(--wb-accent); border: 1px solid var(--wb-accent-dim);
}
.wb-ep-badge.critical { background: rgba(255,61,96,0.15); color: var(--wb-err); border-color: var(--wb-err); }
.wb-ep-badge.warning  { background: rgba(232,192,64,0.15); color: var(--wb-warn); border-color: var(--wb-warn); }
.wb-ep-badge.live     { background: rgba(0,224,144,0.15); color: var(--wb-live); border-color: var(--wb-live); }
.wb-ep-links { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--wb-line-dim); }
.wb-ep-links a {
  font-size: 10px; color: var(--wb-accent); text-decoration: none;
  padding: 2px 6px; border: 1px solid var(--wb-accent-dim); border-radius: 2px;
}
.wb-ep-links a:hover { background: var(--wb-accent-glow); }
.wb-ep-action-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.wb-ep-action {
  flex: 1; min-width: 80px; height: 26px; font-size: 10px; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; cursor: pointer;
  background: var(--wb-panel-hi); color: var(--wb-text);
  border: 1px solid var(--wb-line); border-radius: 2px;
}
.wb-ep-action:hover { border-color: var(--wb-accent-dim); color: var(--wb-accent); }
.wb-ep-action.primary { background: var(--wb-accent-dim); color: #fff; border-color: transparent; }
.wb-ep-action.primary:hover { background: var(--wb-accent); }
.wb-ep-section-label { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--wb-muted); margin: 10px 0 4px; }
.wb-ep-divider { height: 1px; background: var(--wb-line-dim); margin: 8px 0; }
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WindowShell.tsx apps/web/src/workbench.css
git commit -m "feat(pkm): WindowShell — drag/resize/minimize/z-index managed panel + CSS"
```

---

### Task 10: `WindowTray` (minimized window strip)

**Files:**
- Create: `apps/web/src/components/WindowTray.tsx`
- Modify: `apps/web/src/workbench.css` (append tray CSS)

**Interfaces:**
- Consumes: `WindowManager`, `ManagedWindow` from `../hooks/useWindowManager`
- Produces: `WindowTray` component

- [ ] **Step 1: Create `WindowTray.tsx`**

```tsx
import type { WindowManager } from "../hooks/useWindowManager";

interface WindowTrayProps {
  wm: WindowManager;
}

export function WindowTray({ wm }: WindowTrayProps) {
  const minimized = wm.windows.filter((w) => w.minimized);
  if (minimized.length === 0) return null;

  return (
    <div className="wb-tray" role="toolbar" aria-label="Minimized panels">
      {minimized.map((w) => {
        const label = w.entity.kind === "quake"
          ? `M${(w.entity.data as { magnitude: number }).magnitude?.toFixed(1) ?? "?"}`
          : w.entity.kind === "aircraft"
            ? (w.entity.data as { callsign?: string }).callsign || w.entity.id
            : w.entity.kind === "place"
              ? (w.entity.data as { name?: string }).name || w.entity.id
              : w.entity.id;

        const icon =
          w.kind === "quake" ? "⚡" :
          w.kind === "aircraft" ? "✈" :
          w.kind === "place" ? "◈" : "★";

        const truncated = label.length > 18 ? label.slice(0, 17) + "…" : label;

        return (
          <div key={w.id} className="wb-tray-chip">
            <button
              type="button"
              className="wb-tray-chip-btn"
              onClick={() => { wm.restore(w.id); wm.bringToFront(w.id); }}
              title={`Restore: ${label}`}
            >
              <span className="wb-tray-chip-icon">{icon}</span>
              <span className="wb-tray-chip-label">{truncated}</span>
            </button>
            <button
              type="button"
              className="wb-tray-chip-close"
              onClick={() => wm.close(w.id)}
              title="Close"
              aria-label={`Close ${label}`}
            >×</button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Append tray CSS to `workbench.css`**

```css
/* ===== WINDOW TRAY (minimized strip above timeline) ===== */
.wb-tray {
  position: fixed;
  bottom: 88px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: rgba(9, 13, 20, 0.88);
  backdrop-filter: blur(8px);
  border: 1px solid var(--wb-line);
  border-radius: 4px;
  z-index: 600;
  max-width: calc(100vw - 48px);
  overflow-x: auto;
  scrollbar-width: none;
  pointer-events: auto;
}
.wb-tray::-webkit-scrollbar { display: none; }
.wb-tray-chip {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--wb-line);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}
.wb-tray-chip-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  background: var(--wb-panel);
  color: var(--wb-text);
  border: none;
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.wb-tray-chip-btn:hover { background: var(--wb-panel-hi); color: var(--wb-accent); }
.wb-tray-chip-icon { font-size: 11px; }
.wb-tray-chip-close {
  padding: 3px 5px;
  background: transparent;
  color: var(--wb-muted);
  border: none;
  border-left: 1px solid var(--wb-line);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.wb-tray-chip-close:hover { color: var(--wb-err); background: rgba(255,61,96,0.12); }
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/WindowTray.tsx apps/web/src/workbench.css
git commit -m "feat(pkm): WindowTray — Krita-style minimized panel strip above timeline"
```

---

### Task 11: `QuakeDetailPanel`

**Files:**
- Create: `apps/web/src/components/panels/QuakeDetailPanel.tsx`
- Modify: `apps/web/src/workbench.css` (append quake-specific CSS)

**Interfaces:**
- Consumes: `SelectedEntity & { kind: "quake" }`, `WindowManager`, callbacks `onSeekToTime` and `onFlyTo`
- Produces: `QuakeDetailPanel` component

- [ ] **Step 1: Create panel**

```tsx
import type { SelectedEntity } from "../../types/entities";
import type { WindowManager } from "../../hooks/useWindowManager";
import { WindowShell } from "../WindowShell";

interface Props {
  entity: SelectedEntity & { kind: "quake" };
  wm: WindowManager;
  win: import("../../hooks/useWindowManager").ManagedWindow;
  onSeekToTime: (ms: number) => void;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
}

/** Modified Mercalli Intensity from magnitude+depth (empirical estimate only). */
function estimateMMI(mag: number, depthKm: number): string {
  const r = Math.sqrt(depthKm ** 2 + 1);
  const mmi = 1.5 * mag - 1.5 * Math.log10(r) + 0.5;
  const clamped = Math.round(Math.max(1, Math.min(12, mmi)));
  const labels = ["","I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];
  return labels[clamped] ?? "—";
}

export function QuakeDetailPanel({ entity, wm, win, onSeekToTime, onFlyTo }: Props) {
  const q = entity.data;
  const severity = q.magnitude >= 6 ? "critical" : q.magnitude >= 4.5 ? "warning" : undefined;
  const utcTime = new Date(q.timeMs).toISOString().replace("T", " ").slice(0, 19) + "Z";
  const localTime = new Date(q.timeMs).toLocaleString();
  const mmi = estimateMMI(q.magnitude, q.depthKm);
  const usgsId = q.id.startsWith("us") || q.id.startsWith("ci") || q.id.startsWith("nc")
    ? q.id : null;

  return (
    <WindowShell
      id={win.id}
      title={`M${q.magnitude.toFixed(1)} Earthquake`}
      subtitle={q.place}
      icon="⚡"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(pos) => wm.move(win.id, pos)}
      onResize={(size) => wm.resize(win.id, size)}
      wm={wm}
    >
      {/* Hero magnitude */}
      <div className="wb-ep-hero">
        <div className={`wb-ep-hero-val wb-ep-quake-mag${severity ? ` ${severity}` : ""}`}>
          {q.magnitude.toFixed(1)}
        </div>
        <div className="wb-ep-hero-label">Magnitude</div>
        {severity && <div className="wb-ep-badge" style={{ marginTop: 4 }}>{severity}</div>}
      </div>

      <div className="wb-ep-divider" />

      <dl className="wb-ep-grid">
        <dt>Place</dt>      <dd>{q.place || "—"}</dd>
        <dt>Depth</dt>      <dd>{q.depthKm.toFixed(1)} km</dd>
        <dt>MMI est.</dt>   <dd>{mmi}</dd>
        <dt>Time (UTC)</dt> <dd>{utcTime}</dd>
        <dt>Local</dt>      <dd>{localTime}</dd>
        <dt>Lat / Lon</dt>  <dd>{q.lat.toFixed(3)}° / {q.lon.toFixed(3)}°</dd>
        <dt>Event ID</dt>   <dd style={{ fontSize: 9, fontFamily: "monospace" }}>{q.id}</dd>
      </dl>

      <div className="wb-ep-action-row">
        <button
          type="button"
          className="wb-ep-action primary"
          onClick={() => onFlyTo(entity.lon, entity.lat, 7)}
        >
          Fly To
        </button>
        <button
          type="button"
          className="wb-ep-action"
          onClick={() => onSeekToTime(q.timeMs)}
        >
          Seek Timeline
        </button>
      </div>

      <div className="wb-ep-links">
        {usgsId && (
          <a
            href={`https://earthquake.usgs.gov/earthquakes/eventpage/${usgsId}/executive`}
            target="_blank" rel="noreferrer"
          >USGS Event Page</a>
        )}
        <a
          href={`https://www.emsc-csem.org/Earthquake/earthquake.php?id=${q.id}`}
          target="_blank" rel="noreferrer"
        >EMSC</a>
        <a
          href={`https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q.place)}`}
          target="_blank" rel="noreferrer"
        >Wikipedia Region</a>
        <a
          href={`https://www.google.com/maps?q=${q.lat},${q.lon}`}
          target="_blank" rel="noreferrer"
        >Google Maps</a>
      </div>
    </WindowShell>
  );
}
```

- [ ] **Step 2: Append quake CSS**

```css
/* ── Quake magnitude color ── */
.wb-ep-quake-mag { color: var(--wb-warn); }
.wb-ep-quake-mag.critical { color: var(--wb-err); }
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/panels/QuakeDetailPanel.tsx apps/web/src/workbench.css
git commit -m "feat(pkm): QuakeDetailPanel — magnitude, MMI, USGS/EMSC links, fly-to"
```

---

### Task 12: `PlaceDetailPanel`

**Files:**
- Create: `apps/web/src/components/panels/PlaceDetailPanel.tsx`

**Interfaces:**
- Consumes: `SelectedEntity & { kind: "place" }`, `WindowManager`, `onInspectWeather`
- Produces: `PlaceDetailPanel`

- [ ] **Step 1: Create panel**

```tsx
import type { SelectedEntity } from "../../types/entities";
import type { WindowManager, ManagedWindow } from "../../hooks/useWindowManager";
import { WindowShell } from "../WindowShell";

const FLAG_CDN = "https://flagcdn.com/28x21";

const COUNTRY_FLAGS: Record<string, string> = {
  US: "🇺🇸", CA: "🇨🇦", GB: "🇬🇧", AU: "🇦🇺", DE: "🇩🇪", FR: "🇫🇷",
  JP: "🇯🇵", CN: "🇨🇳", IN: "🇮🇳", BR: "🇧🇷", MX: "🇲🇽", RU: "🇷🇺",
  ZA: "🇿🇦", NG: "🇳🇬", EG: "🇪🇬", TR: "🇹🇷", SA: "🇸🇦", KR: "🇰🇷",
  IT: "🇮🇹", ES: "🇪🇸", AR: "🇦🇷", SE: "🇸🇪", NO: "🇳🇴", FI: "🇫🇮",
  NZ: "🇳🇿", UA: "🇺🇦", PL: "🇵🇱", NL: "🇳🇱", BE: "🇧🇪", CH: "🇨🇭",
};

function countryFlag(code?: string): string {
  if (!code) return "";
  return COUNTRY_FLAGS[code.toUpperCase()] ?? "";
}

interface Props {
  entity: SelectedEntity & { kind: "place" };
  wm: WindowManager;
  win: ManagedWindow;
  onInspectWeather: (lon: number, lat: number) => void;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
}

export function PlaceDetailPanel({ entity, wm, win, onInspectWeather, onFlyTo }: Props) {
  const place = entity.data;
  const flag = countryFlag(place.countryCode);
  const kindLabel = place.kind.charAt(0).toUpperCase() + place.kind.slice(1);
  const pop = place.population
    ? place.population >= 1_000_000
      ? `${(place.population / 1_000_000).toFixed(1)}M`
      : place.population >= 1000
        ? `${(place.population / 1000).toFixed(0)}K`
        : String(place.population)
    : null;

  const wikiUrl = place.wikidata
    ? `https://www.wikidata.org/wiki/${place.wikidata}`
    : `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(place.name)}`;

  const osmUrl = `https://www.openstreetmap.org/?mlat=${entity.lat}&mlon=${entity.lon}&zoom=12`;
  const googleUrl = `https://www.google.com/maps?q=${entity.lat},${entity.lon}`;

  return (
    <WindowShell
      id={win.id}
      title={place.name}
      subtitle={place.country ? `${flag} ${place.country}` : undefined}
      icon="◈"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(pos) => wm.move(win.id, pos)}
      onResize={(size) => wm.resize(win.id, size)}
      wm={wm}
    >
      <div className="wb-ep-hero">
        {flag && <div style={{ fontSize: 28, lineHeight: 1 }}>{flag}</div>}
        <div className="wb-ep-hero-val" style={{ fontSize: 22, marginTop: 4 }}>{place.name}</div>
        <div className="wb-ep-hero-label">{kindLabel}</div>
      </div>

      <div className="wb-ep-divider" />

      <dl className="wb-ep-grid">
        {place.country && <><dt>Country</dt><dd>{flag} {place.country}</dd></>}
        {pop && <><dt>Population</dt><dd>{pop}</dd></>}
        <dt>Lat / Lon</dt><dd>{entity.lat.toFixed(4)}° / {entity.lon.toFixed(4)}°</dd>
        {place.wikidata && <><dt>Wikidata</dt><dd style={{ fontFamily: "monospace", fontSize: 10 }}>{place.wikidata}</dd></>}
      </dl>

      <div className="wb-ep-action-row">
        <button type="button" className="wb-ep-action primary" onClick={() => onFlyTo(entity.lon, entity.lat, 10)}>
          Fly To
        </button>
        <button type="button" className="wb-ep-action" onClick={() => onInspectWeather(entity.lon, entity.lat)}>
          Inspect Weather
        </button>
      </div>

      <div className="wb-ep-links">
        <a href={wikiUrl} target="_blank" rel="noreferrer">Wikipedia</a>
        <a href={osmUrl} target="_blank" rel="noreferrer">OpenStreetMap</a>
        <a href={googleUrl} target="_blank" rel="noreferrer">Google Maps</a>
        {place.wikidata && (
          <a href={`https://www.wikidata.org/wiki/${place.wikidata}`} target="_blank" rel="noreferrer">Wikidata</a>
        )}
      </div>
    </WindowShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head-20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/panels/PlaceDetailPanel.tsx
git commit -m "feat(pkm): PlaceDetailPanel — city/town/country info, flag, Wikipedia, weather inspect"
```

---

### Task 13: `AircraftDetailPanel`

**Files:**
- Create: `apps/web/src/components/panels/AircraftDetailPanel.tsx`
- Modify: `apps/web/src/workbench.css` (append aircraft CSS)

**Interfaces:**
- Consumes: `SelectedEntity & { kind: "aircraft" }`, `WindowManager`, `aircraftFeedState.events`, `osintNowMs`, callbacks `onFlyTo`, `onExtraLayers`
- Produces: `AircraftDetailPanel`

Note: `onExtraLayers` allows the panel to inject traced+projected path layers into `extraDeckLayers`.

- [ ] **Step 1: Create panel**

```tsx
import { useEffect, useRef } from "react";
import type { SelectedEntity } from "../../types/entities";
import type { WindowManager, ManagedWindow } from "../../hooks/useWindowManager";
import type { AircraftState } from "../../lib/liveFeeds/aircraft";
import { lookupAirline } from "../../lib/icaoAirlines";
import { aircraftColor, deadReckon } from "../../layers/renderers/osint";
import { createTracedPathLayer, createProjectedPathLayer } from "../../layers/renderers/aircraftPaths";
import { WindowShell } from "../WindowShell";

const EMERGENCY: Record<string, string> = { "7500": "HIJACK", "7600": "RADIO FAIL", "7700": "MAYDAY" };

function fmtAlt(m: number | null): string {
  if (m === null) return "On ground";
  const ft = Math.round(m * 3.28084);
  return `${ft.toLocaleString()} ft (${Math.round(m).toLocaleString()} m)`;
}

function fmtSpeed(mps: number): string {
  const kts = Math.round(mps * 1.94384);
  const kmh = Math.round(mps * 3.6);
  return `${kts} kts (${kmh} km/h)`;
}

interface Props {
  entity: SelectedEntity & { kind: "aircraft" };
  wm: WindowManager;
  win: ManagedWindow;
  liveStates: AircraftState[];
  nowMs: number;
  onFlyTo: (lon: number, lat: number, zoom?: number) => void;
  onExtraLayers: (id: string, layers: unknown[]) => void;
}

const MAX_TRACE = 40;

export function AircraftDetailPanel({ entity, wm, win, liveStates, nowMs, onFlyTo, onExtraLayers }: Props) {
  const traceRef = useRef<[number, number][]>([]);
  const lastIdRef = useRef<string>("");

  // Find live state for this aircraft (may have updated since panel opened)
  const liveState = liveStates.find((s) => s.id === entity.id) ?? entity.data;
  const pos = deadReckon(liveState, nowMs);

  // Accumulate trace positions each time liveState updates
  useEffect(() => {
    if (lastIdRef.current !== entity.id) {
      traceRef.current = [];
      lastIdRef.current = entity.id;
    }
    const last = traceRef.current.at(-1);
    const [lon, lat] = pos;
    if (!last || Math.hypot(lon - last[0], lat - last[1]) > 0.002) {
      traceRef.current = [...traceRef.current.slice(-MAX_TRACE), [lon, lat] as [number, number]];
    }
    const color = aircraftColor(liveState);
    const traceLayers: unknown[] = [];
    const trace = createTracedPathLayer(traceRef.current, [color[0], color[1], color[2], 160]);
    if (trace) traceLayers.push(trace);
    const proj = createProjectedPathLayer(liveState, nowMs);
    if (proj) traceLayers.push(proj);
    onExtraLayers(win.id, traceLayers);
  }, [liveState, nowMs, entity.id, win.id, onExtraLayers, pos]);

  // Cleanup layers when panel closes
  useEffect(() => {
    return () => onExtraLayers(win.id, []);
  }, [win.id, onExtraLayers]);

  const airline = lookupAirline(liveState.callsign);
  const emergency = liveState.squawk ? EMERGENCY[liveState.squawk] : null;

  const flightAwareUrl = liveState.callsign
    ? `https://flightaware.com/live/flight/${liveState.callsign.trim()}`
    : null;
  const fr24Url = liveState.callsign
    ? `https://www.flightradar24.com/${liveState.callsign.trim()}`
    : null;

  return (
    <WindowShell
      id={win.id}
      title={liveState.callsign || liveState.id}
      subtitle={airline ?? undefined}
      icon="✈"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(p) => wm.move(win.id, p)}
      onResize={(s) => wm.resize(win.id, s)}
      wm={wm}
    >
      {emergency && (
        <div className="wb-ep-badge critical" style={{ display: "block", textAlign: "center", marginBottom: 8 }}>
          SQUAWK {liveState.squawk} — {emergency}
        </div>
      )}

      <div className="wb-ep-hero">
        <div className="wb-ep-hero-val" style={{ fontSize: 20 }}>{liveState.callsign || liveState.id}</div>
        {airline && <div className="wb-ep-hero-label">{airline}</div>}
        <div style={{ marginTop: 6 }}>
          <span className={`wb-ep-badge ${liveState.onGround ? "" : "live"}`}>
            {liveState.onGround ? "On Ground" : "Airborne"}
          </span>
        </div>
      </div>

      <div className="wb-ep-divider" />

      <dl className="wb-ep-grid">
        <dt>ICAO24</dt>   <dd style={{ fontFamily: "monospace" }}>{liveState.id}</dd>
        {liveState.squawk && <><dt>Squawk</dt><dd style={{ fontFamily: "monospace" }}>{liveState.squawk}</dd></>}
        <dt>Altitude</dt> <dd>{fmtAlt(liveState.altitudeM)}</dd>
        <dt>Speed</dt>    <dd>{fmtSpeed(liveState.velocityMps)}</dd>
        <dt>Heading</dt>  <dd>{Math.round(liveState.headingDeg)}°</dd>
        <dt>Position</dt> <dd>{pos[1].toFixed(3)}° / {pos[0].toFixed(3)}°</dd>
        <dt>Updated</dt>  <dd>{new Date(liveState.timeMs).toISOString().slice(11, 19)}Z</dd>
      </dl>

      <div className="wb-ep-section-label">Path</div>
      <div style={{ fontSize: 10, color: "var(--wb-muted)" }}>
        Trace: {traceRef.current.length} pts · Projection: 30 min ahead
      </div>

      <div className="wb-ep-action-row">
        <button type="button" className="wb-ep-action primary" onClick={() => onFlyTo(pos[0], pos[1], 8)}>
          Fly To
        </button>
      </div>

      <div className="wb-ep-links">
        {flightAwareUrl && <a href={flightAwareUrl} target="_blank" rel="noreferrer">FlightAware</a>}
        {fr24Url && <a href={fr24Url} target="_blank" rel="noreferrer">FlightRadar24</a>}
        <a href={`https://www.planespotters.net/flight/${liveState.callsign || liveState.id}`} target="_blank" rel="noreferrer">Planespotters</a>
      </div>
    </WindowShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -20`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/panels/AircraftDetailPanel.tsx
git commit -m "feat(pkm): AircraftDetailPanel — live trace, projection, airline lookup, FlightAware links"
```

---

### Task 14: StarInfoCard migration to `WindowShell`

**Files:**
- Modify: `apps/web/src/components/StarInfoCard.tsx`

**Interfaces:**
- `StarInfoCardProps` gains `wm: WindowManager; win: ManagedWindow` (replaces `onClose`)
- `DraggablePanel` import removed, `WindowShell` used instead

- [ ] **Step 1: Migrate StarInfoCard**

Replace the file contents:

```tsx
import type { Star } from "../lib/celestialSphere";
import type { WindowManager, ManagedWindow } from "../hooks/useWindowManager";
import { WindowShell } from "./WindowShell";

interface StarInfoCardProps {
  star: Star;
  wm: WindowManager;
  win: ManagedWindow;
}

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  return n.toFixed(digits);
}

export function StarInfoCard({ star, wm, win }: StarInfoCardProps) {
  const simbadQuery = encodeURIComponent(star.name);
  const wikiQuery = encodeURIComponent(star.name + " (star)");

  return (
    <WindowShell
      id={win.id}
      title={star.name}
      subtitle={star.bayer ? `${star.bayer}${star.constellation ? ` · ${star.constellation}` : ""}` : undefined}
      icon="★"
      zIndex={win.zIndex}
      initialPosition={win.position}
      initialSize={win.size}
      onClose={() => wm.close(win.id)}
      onMinimize={() => wm.minimize(win.id)}
      onFocus={() => wm.bringToFront(win.id)}
      onMove={(pos) => wm.move(win.id, pos)}
      onResize={(size) => wm.resize(win.id, size)}
      wm={wm}
    >
      <dl className="wb-ep-grid">
        <dt>App. mag</dt>   <dd>{fmt(star.mag)}</dd>
        <dt>Distance</dt>   <dd>{star.distanceLy != null ? `${fmt(star.distanceLy, 1)} ly` : "—"}</dd>
        <dt>Spectral</dt>   <dd>{star.spectralType ?? "—"}</dd>
        <dt>Mass</dt>       <dd>{star.massSolar != null ? `${fmt(star.massSolar)} M☉` : "—"}</dd>
        <dt>Radius</dt>     <dd>{star.radiusSolar != null ? `${fmt(star.radiusSolar)} R☉` : "—"}</dd>
        <dt>Luminosity</dt> <dd>{star.luminositySolar != null ? `${fmt(star.luminositySolar, 0)} L☉` : "—"}</dd>
        <dt>RA</dt>         <dd>{fmt(star.ra, 3)}°</dd>
        <dt>Dec</dt>        <dd>{fmt(star.dec, 3)}°</dd>
        {star.hostsExoplanets && (
          <>
            <dt>Exoplanets</dt>
            <dd>{star.exoplanets?.length ? star.exoplanets.join(", ") : "Confirmed (per NASA)"}</dd>
          </>
        )}
      </dl>

      {star.notes && <p style={{ fontSize: 10, color: "var(--wb-muted)", marginTop: 6 }}>{star.notes}</p>}

      <div className="wb-ep-links">
        <a href={`https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=${simbadQuery}`} target="_blank" rel="noreferrer">SIMBAD</a>
        <a href={`https://en.wikipedia.org/wiki/Special:Search?search=${wikiQuery}`} target="_blank" rel="noreferrer">Wikipedia</a>
        {star.hostsExoplanets && (
          <a href={`https://exoplanetarchive.ipac.caltech.edu/cgi-bin/TblView/nph-tblView?app=ExoTbls&config=PSCompPars&constraint=hostname%20like%20%27${simbadQuery}%27`} target="_blank" rel="noreferrer">NASA Exoplanet Archive</a>
        )}
      </div>
    </WindowShell>
  );
}
```

- [ ] **Step 2: Verify TypeScript** (StarInfoCard callers will break; that's expected until App.tsx is wired)

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep -v "App.tsx" | head -20`
Expected: errors only in App.tsx (not in StarInfoCard itself)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/StarInfoCard.tsx
git commit -m "feat(pkm): migrate StarInfoCard to WindowShell (z-index, minimize, resize)"
```

---

### Task 15: MapView integration

**Files:**
- Modify: `apps/web/src/components/MapView.tsx`

Changes:
1. Add `onEntityClick?: (entity: import("../types/entities").SelectedEntity) => void` to `MapViewProps`
2. In the `map.on("click")` handler: after star hit-test, pick from deck.gl via `(overlayRef.current as any)?._deck?.pickObject()`; build and fire `SelectedEntity` for quakes/aircraft
3. After deck.gl pick: call `resolvePlaceAt` for place detection
4. In `map.on("dblclick")`: pick aircraft → call `onEntityDblClick` (fly-to, passed separately)
5. Add `map.doubleClickZoom.disable()` in map init to prevent zoom conflict

- [ ] **Step 1: Add `onEntityClick` to `MapViewProps` interface**

In `MapView.tsx`, add to the `MapViewProps` interface (after `onVisibleBboxChange`):

```ts
onEntityClick?: (entity: import("../types/entities").SelectedEntity) => void;
```

- [ ] **Step 2: Add `onEntityClick` to destructuring**

In the `MapView` function signature, add `onEntityClick` to the destructured props.

- [ ] **Step 3: Add `onEntityClickRef`**

After the existing `onInspectRef`, add:
```ts
const onEntityClickRef = useRef(onEntityClick);
useEffect(() => { onEntityClickRef.current = onEntityClick; });
```

- [ ] **Step 4: Import `resolvePlaceAt`**

At the top of MapView.tsx add:
```ts
import { resolvePlaceAt } from "../lib/placeResolver";
import type { SelectedEntity } from "../types/entities";
```

- [ ] **Step 5: Modify `map.on("click")` handler**

After the star hit-test block (after `return; // suppress normal inspect`) and before `inspectAtLocation`, insert:

```ts
// Deck.gl entity pick (quake, aircraft)
const deckInstance = (overlayRef.current as any)?._deck;
if (deckInstance) {
  const picked = deckInstance.pickObject({ x: event.point.x, y: event.point.y, radius: 8 });
  if (picked?.object && picked?.layer) {
    const layerId: string = picked.layer.id ?? "";
    const obj = picked.object;
    if (layerId === "osint-quakes" && typeof obj.id === "string" && typeof obj.lon === "number") {
      onEntityClickRef.current?.({
        kind: "quake", id: obj.id,
        lon: obj.lon, lat: obj.lat, data: obj,
      });
      return;
    }
    if (layerId === "osint-aircraft" && obj.state) {
      const s = obj.state;
      onEntityClickRef.current?.({
        kind: "aircraft", id: s.id,
        lon: s.lon, lat: s.lat, data: s,
      });
      return;
    }
  }
}
// Place resolution
const map = mapRef.current!;
const point: [number, number] = [event.point.x, event.point.y];
resolvePlaceAt(longitude, latitude, map, point).then((place) => {
  if (place) {
    onEntityClickRef.current?.({
      kind: "place",
      id: `place:${place.name}:${latitude.toFixed(3)},${longitude.toFixed(3)}`,
      lon: longitude, lat: latitude, data: place,
    });
  } else {
    inspectAtLocation(longitude, latitude, point);
  }
});
return; // inspectAtLocation called async above if no place
```

- [ ] **Step 6: Add `map.doubleClickZoom.disable()` to map init**

Right after `map.dragRotate.disable();`, add:
```ts
map.doubleClickZoom.disable();
```

- [ ] **Step 7: Add dblclick handler for aircraft fly-to**

After `map.on("click", ...)` block, add:

```ts
map.on("dblclick", (event) => {
  const deckInstance = (overlayRef.current as any)?._deck;
  if (!deckInstance) return;
  const picked = deckInstance.pickObject({ x: event.point.x, y: event.point.y, radius: 12 });
  if (picked?.object && picked?.layer) {
    const layerId: string = picked.layer.id ?? "";
    if (layerId === "osint-aircraft" && picked.object.state) {
      const s = picked.object.state;
      onEntityClickRef.current?.({
        kind: "aircraft", id: s.id,
        lon: s.lon, lat: s.lat, data: s,
      });
    }
  }
});
```

- [ ] **Step 8: Verify TypeScript**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | grep "MapView" | head -20`
Expected: no errors in MapView.tsx

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/MapView.tsx
git commit -m "feat(pkm): MapView — deck.gl entity pick + place resolver in click handler"
```

---

### Task 16: App.tsx wiring

**Files:**
- Modify: `apps/web/src/App.tsx`

This is the integration task. Changes:
1. Import new hooks and components
2. Call `useSelection()` and `useWindowManager()`
3. Build `handleEntityClick` callback  
4. Build `handleFlyTo` callback (calls `setCameraTarget`)
5. Build `panelExtraLayers` state for aircraft path layers
6. Add `createSelectionPinLayer` to `extraDeckLayers`
7. Pass `onEntityClick` to `MapView`
8. Pass `onPick` to `createQuakeLayer` and `createAircraftLayers`
9. Render `<QuakeDetailPanel>`, `<AircraftDetailPanel>`, `<PlaceDetailPanel>`, `<StarInfoCard>` for open windows
10. Render `<WindowTray wm={wm} />`
11. Wire timeline pin click → fly-to for quake pins (modify `seekToTime`)
12. Remove old `selectedStar` / `StarInfoCard` direct rendering (now via window manager)

- [ ] **Step 1: Add imports to App.tsx**

After existing imports, add:

```ts
import { useSelection } from "./hooks/useSelection";
import { useWindowManager } from "./hooks/useWindowManager";
import type { SelectedEntity } from "./types/entities";
import { createSelectionPinLayer } from "./layers/renderers/selectionPin";
import { WindowTray } from "./components/WindowTray";
import { QuakeDetailPanel } from "./components/panels/QuakeDetailPanel";
import { AircraftDetailPanel } from "./components/panels/AircraftDetailPanel";
import { PlaceDetailPanel } from "./components/panels/PlaceDetailPanel";
```

- [ ] **Step 2: Initialize hooks (after existing useState calls)**

```ts
const selectionApi = useSelection();
const wm = useWindowManager();
```

- [ ] **Step 3: Add panel extra layers state (for aircraft paths)**

```ts
const [panelExtraLayersMap, setPanelExtraLayersMap] = useState<Map<string, unknown[]>>(new Map());

const handlePanelExtraLayers = useCallback((id: string, layers: unknown[]) => {
  setPanelExtraLayersMap((prev) => {
    const next = new Map(prev);
    if (layers.length === 0) next.delete(id);
    else next.set(id, layers);
    return next;
  });
}, []);
```

- [ ] **Step 4: Build `handleEntityClick`**

```ts
const handleEntityClick = useCallback((entity: SelectedEntity) => {
  selectionApi.select(entity);
  wm.open(entity);
}, [selectionApi, wm]);
```

- [ ] **Step 5: Build `handleFlyTo`**

```ts
const handleFlyTo = useCallback((lon: number, lat: number, zoom = 8) => {
  setCameraTarget({
    longitude: lon,
    latitude: lat,
    zoom,
    bearing: 0,
    pitch: 0,
  });
}, []);
```

- [ ] **Step 6: Modify `osintLayers` useMemo to pass `onPick`**

Update the `createQuakeLayer` and `createAircraftLayers` calls:

```ts
if (osintQuakesEnabled) {
  const layer = createQuakeLayer(quakeFeedState.events, osintNowMs, {
    onPick: (q) => handleEntityClick({ kind: "quake", id: q.id, lon: q.lon, lat: q.lat, data: q }),
  });
  if (layer) layers.push(layer);
}
if (osintAircraftEnabled) {
  layers.push(...createAircraftLayers(aircraftFeedState.events, osintNowMs, {
    onPick: (s) => handleEntityClick({ kind: "aircraft", id: s.id, lon: s.lon, lat: s.lat, data: s }),
  }));
}
```

Add `handleEntityClick` to the `useMemo` dep array.

- [ ] **Step 7: Build `extraDeckLayers` including selection pin and panel layers**

Find the existing `extraDeckLayers` prop passed to `<MapView>` and replace its value with:

```ts
const extraDeckLayers = useMemo(() => {
  const panelLayers = Array.from(panelExtraLayersMap.values()).flat();
  const pinLayer = createSelectionPinLayer(selectionApi.selection);
  return [...osintLayers, ...panelLayers, ...(pinLayer ? [pinLayer] : [])];
}, [osintLayers, panelExtraLayersMap, selectionApi.selection]);
```

(Previously `osintLayers` was passed directly as `extraDeckLayers`; consolidate here.)

- [ ] **Step 8: Handle star clicks via window manager**

Find where `setSelectedStar` is called in App.tsx (from MapView's star hit-test). The star selection path is inside MapView; it calls back via a different prop. Find the existing `selectedStar` state and `StarInfoCard` rendering.

Replace:
- Remove `const [selectedStar, setSelectedStar] = useState<Star | null>(null)`
- In MapView, star click currently calls `setSelectedStar`. Since star clicks happen inside MapView, add a new MapView prop `onStarClick?: (star: Star) => void` and call `handleEntityClick` from App.tsx:

In MapView.tsx, add to MapViewProps:
```ts
onStarClick?: (star: Star) => void;
```

And in the click handler, replace `setSelectedStar(best.star)` with `onStarClickRef.current?.(best.star)` (add ref pattern same as other callbacks).

In App.tsx, pass:
```tsx
onStarClick={(star) => handleEntityClick({
  kind: "star", id: `star:${star.name}`, lon: 0, lat: 0, data: star,
})}
```

- [ ] **Step 9: Wire `onSeekToPin` for quake timeline fly-to**

The `eventPins` now carry `lon`/`lat`. Modify `seekToTime` to also accept a pin with location:

```ts
const seekToPin = useCallback((pin: import("./time/eventPins").TimelineEventPin) => {
  seekToTime(pin.timeMs);
  if (pin.lon !== undefined && pin.lat !== undefined && pin.kind === "quake") {
    handleFlyTo(pin.lon, pin.lat, 7);
  }
}, [seekToTime, handleFlyTo]);
```

Pass `onSeekToTime={seekToPin}` to `<BottomTimeline>` (same callback signature — `onSeekToTime` takes `timeMs` but we need the full pin; update `BottomTimeline`'s `onSeekToTime` prop to accept `PlacedEventPin` instead of just `timeMs`).

Actually, to avoid changing BottomTimeline's API, add a new `onPinClick?: (pin: PlacedEventPin) => void` prop to BottomTimeline and fire it alongside `onSeekToTime`. In App.tsx, pass both:
- `onSeekToTime={seekToTime}` (existing)
- `onPinClick={seekToPin}` (new)

In BottomTimeline, the pin button onClick becomes:
```ts
onClick={(e) => {
  e.stopPropagation();
  onSeekToTime?.(pin.timeMs);
  onPinClick?.(pin);
}}
```

- [ ] **Step 10: Render open window panels**

In the JSX (inside `<main className="wb-app">`, after `<WindowTray>`), add:

```tsx
{/* PKM Window Manager */}
<WindowTray wm={wm} />
{wm.windows.map((win) => {
  if (win.minimized) return null;
  if (win.kind === "quake") {
    const entity = win.entity as SelectedEntity & { kind: "quake" };
    return (
      <QuakeDetailPanel
        key={win.id} entity={entity} wm={wm} win={win}
        onSeekToTime={seekToTime}
        onFlyTo={handleFlyTo}
      />
    );
  }
  if (win.kind === "aircraft") {
    const entity = win.entity as SelectedEntity & { kind: "aircraft" };
    return (
      <AircraftDetailPanel
        key={win.id} entity={entity} wm={wm} win={win}
        liveStates={aircraftFeedState.events}
        nowMs={osintNowMs}
        onFlyTo={handleFlyTo}
        onExtraLayers={handlePanelExtraLayers}
      />
    );
  }
  if (win.kind === "place") {
    const entity = win.entity as SelectedEntity & { kind: "place" };
    return (
      <PlaceDetailPanel
        key={win.id} entity={entity} wm={wm} win={win}
        onFlyTo={handleFlyTo}
        onInspectWeather={(lon, lat) => {
          // trigger a weather inspection by simulating a click-inspect
          setCameraTarget({ longitude: lon, latitude: lat, zoom: 8, bearing: 0, pitch: 0 });
        }}
      />
    );
  }
  if (win.kind === "star") {
    const entity = win.entity as SelectedEntity & { kind: "star" };
    return (
      <StarInfoCard
        key={win.id}
        star={entity.data}
        wm={wm}
        win={win}
      />
    );
  }
  return null;
})}
```

- [ ] **Step 11: Pass `onEntityClick` to MapView**

Add to the `<MapView ...>` JSX:
```tsx
onEntityClick={handleEntityClick}
onStarClick={(star) => handleEntityClick({ kind: "star", id: `star:${star.name}`, lon: 0, lat: 0, data: star })}
```

- [ ] **Step 12: Verify full TypeScript build**

Run: `cd apps/web && npx tsc --noEmit 2>&1 | head -40`
Expected: no errors

- [ ] **Step 13: Run all tests**

Run: `cd apps/web && npx vitest run 2>&1 | tail -20`
Expected: all pass

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/MapView.tsx apps/web/src/components/workbench/BottomTimeline.tsx
git commit -m "feat(pkm): wire window manager, selection, entity panels, diamond pin into App"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Free-floating panels | Task 9 (WindowShell) |
| Open/close/minimize | Task 3, 9, 10 |
| Bottom tray (Krita-style) | Task 10 |
| Diamond cyberpunk pin | Task 5 |
| Generic selection system | Task 2, 3 |
| Earthquake panel + fly-to + timeline seek | Task 11 |
| Aircraft panel + trace + projection + links | Task 13 |
| City/place panel + Wikipedia + weather | Task 12 |
| Star panel migrated | Task 14 |
| MapLibre label hit-test | Task 4, 15 |
| Nominatim reverse geocode fallback | Task 4, 15 |
| Deck.gl entity click | Task 6, 15 |
| Aircraft double-click fly-to | Task 15 |
| Timeline pin click → fly-to for quakes | Task 6, 16 |
| Resizable panels | Task 9 |
| Z-index (last touched on top) | Task 3, 9 |
| ICAO airline lookup | Task 8 |
| Aircraft path/projected layers | Task 7, 13 |

**Type consistency:** `entityWindowId` used in Task 3 matches the export from Task 1. `ManagedWindow` fields (id, kind, entity, minimized, zIndex, position, size) used consistently across Tasks 3, 9, 10, 11, 12, 13, 14, 16. `WindowManager` interface methods match across Task 3 definition and Task 9/10/11/12/13/14/16 consumers.

**No placeholders:** All tasks contain actual code. No TBDs.
