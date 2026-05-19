// Draggable city-quick-jump panel. Searches the curated world-city
// catalog, shows a tight list, and on pick:
//   - flies the map camera to the city coordinates
//   - sets the active time zone to the city's IANA zone (optional)
//   - surfaces a "quick weather" readout from the nearest station
//     observation with source provenance flagged accordingly.
//
// The power-user view: small surface, tabular numbers, no animation,
// keyboard-first (Enter picks first match).

import { useMemo, useState } from "react";
import { DraggablePanel } from "./DraggablePanel";
import { searchCities, type CityEntry } from "../lib/cityCatalog";
import { isMeasuredObservation, nearestObservation } from "../layers/inspection";
import type { Observation } from "../types/weather";
import type { CameraState } from "../layers/types";

interface CityPickerProps {
  onClose: () => void;
  observations: Observation[];
  /** Current operator-selected city (or null on first open). */
  selectedCity: CityEntry | null;
  /** Fired when the operator clicks "Go" or double-clicks a row. */
  onPickCity: (city: CityEntry) => void;
  /** Fired separately when the operator wants to apply the city's TZ. */
  onAdoptTimeZone: (timezone: string) => void;
  /** Optional initial camera state used to estimate the default search. */
  cameraState: CameraState | null;
}

function fmtNum(value: number | undefined, digits = 1): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function buildQuickWeather(city: CityEntry, observations: Observation[]) {
  const pool = observations.filter(isMeasuredObservation);
  const nearest = nearestObservation(pool, city.longitude, city.latitude);
  if (!nearest) return null;
  return {
    station: `${nearest.station_name} (${nearest.station_id})`,
    status: nearest.source_status,
    observedAt: nearest.observed_at,
    temperature: nearest.values.temperature_2m,
    pressure: nearest.values.pressure_msl,
    windSpeed: nearest.values.wind_speed_10m,
    windDir: nearest.values.wind_direction_10m,
    dewpoint: nearest.values.dewpoint_2m,
    precipitation: nearest.values.precipitation_1h,
    units: nearest.units,
  };
}

export function CityPicker({
  onClose,
  observations,
  selectedCity,
  onPickCity,
  onAdoptTimeZone,
}: CityPickerProps) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState<CityEntry | null>(selectedCity);

  const matches = useMemo(() => searchCities(query), [query]);

  const activeCity = focused ?? matches[0] ?? null;
  const quickWeather = useMemo(
    () => (activeCity ? buildQuickWeather(activeCity, observations) : null),
    [activeCity, observations],
  );

  return (
    <DraggablePanel
      title="Cities"
      subtitle="Quick jump · weather snapshot · timezone adopt"
      onClose={onClose}
      storageKey="city-picker"
      width={340}
      defaultPosition={{ x: 96, y: 96 }}
      ariaLabel="City quick-jump panel"
      className="wb-city-picker"
    >
      <input
        className="wb-city-search"
        type="search"
        placeholder="Search city or country…"
        value={query}
        onChange={(event) => { setQuery(event.target.value); setFocused(null); }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && activeCity) {
            onPickCity(activeCity);
          }
        }}
        autoFocus
      />
      <div className="wb-city-list">
        {matches.map((city) => {
          const isActive = activeCity?.id === city.id;
          return (
            <button
              key={city.id}
              type="button"
              className={`wb-city-row${isActive ? " is-active" : ""}`}
              onClick={() => { setFocused(city); onPickCity(city); }}
              title={`${city.timezone} · ${city.latitude.toFixed(2)}, ${city.longitude.toFixed(2)}`}
            >
              <span className="wb-city-row-name">{city.name}</span>
              <span className="wb-city-row-country">{city.country}</span>
            </button>
          );
        })}
        {matches.length === 0 && (
          <div className="wb-city-empty">No cities match that query.</div>
        )}
      </div>

      {activeCity && (
        <div className="wb-city-detail">
          <div className="wb-city-detail-head">
            <strong>{activeCity.name}</strong>
            <span className="wb-city-detail-country">{activeCity.country}</span>
          </div>
          <div className="wb-city-detail-coords">
            {activeCity.latitude.toFixed(3)}°, {activeCity.longitude.toFixed(3)}° · {activeCity.timezone}
          </div>
          {quickWeather ? (
            <dl className="wb-city-weather-grid">
              <dt>Station</dt>          <dd>{quickWeather.station}</dd>
              <dt>Status</dt>           <dd>{quickWeather.status}</dd>
              <dt>Temp</dt>             <dd>{fmtNum(quickWeather.temperature)} {quickWeather.units?.temperature_2m ?? "°C"}</dd>
              <dt>Pressure</dt>         <dd>{fmtNum(quickWeather.pressure)} {quickWeather.units?.pressure_msl ?? "hPa"}</dd>
              <dt>Wind</dt>             <dd>{fmtNum(quickWeather.windSpeed)} {quickWeather.units?.wind_speed_10m ?? "m/s"} @ {fmtNum(quickWeather.windDir, 0)}°</dd>
              <dt>Dewpoint</dt>         <dd>{fmtNum(quickWeather.dewpoint)} {quickWeather.units?.dewpoint_2m ?? "°C"}</dd>
              <dt>Precip 1h</dt>        <dd>{fmtNum(quickWeather.precipitation, 2)} {quickWeather.units?.precipitation_1h ?? "mm"}</dd>
              {quickWeather.observedAt && (<><dt>Obs time</dt><dd>{new Date(quickWeather.observedAt).toLocaleString()}</dd></>)}
            </dl>
          ) : (
            <div className="wb-city-weather-empty">
              No live station observation near this city.
            </div>
          )}
          <div className="wb-city-actions">
            <button
              type="button"
              className="wb-btn-primary"
              onClick={() => onPickCity(activeCity)}
            >Fly to {activeCity.name}</button>
            <button
              type="button"
              onClick={() => onAdoptTimeZone(activeCity.timezone)}
              title={`Set workstation TZ to ${activeCity.timezone}`}
            >Use {activeCity.timezone.split("/").pop() ?? activeCity.timezone} TZ</button>
          </div>
        </div>
      )}
    </DraggablePanel>
  );
}
