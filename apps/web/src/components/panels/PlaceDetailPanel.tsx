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
