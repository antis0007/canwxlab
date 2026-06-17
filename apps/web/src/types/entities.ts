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
