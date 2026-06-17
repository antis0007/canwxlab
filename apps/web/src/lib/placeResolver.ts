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
  const displayNameParts = String(r.display_name ?? "").split(",");
  const country = addr.country ?? displayNameParts[displayNameParts.length - 1]?.trim() ?? "";
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
