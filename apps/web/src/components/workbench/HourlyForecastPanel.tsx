import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { HourlySlot } from "../../lib/api";
import { formatInZone } from "../../lib/timezone";

interface HourlyForecastPanelProps {
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
  onClose: () => void;
}

// WMO weather code → short label
const WMO_LABELS: Record<number, string> = {
  0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Showers", 81: "Showers", 82: "Heavy showers",
  85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm + hail", 99: "Thunderstorm + hail",
};

function wmoLabel(code: number | null): string {
  if (code === null) return "--";
  return WMO_LABELS[code] ?? `WMO ${code}`;
}

// Wind direction degrees → 8-point arrow
const WIND_ARROWS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
function windArrow(deg: number | null): string {
  if (deg === null) return "--";
  const idx = Math.round(((deg % 360) + 360) / 45) % 8;
  return WIND_ARROWS[idx];
}

function fmt1(v: number | null, fallback = "--"): string {
  return v !== null ? v.toFixed(1) : fallback;
}

function fmt0(v: number | null, fallback = "--"): string {
  return v !== null ? Math.round(v).toString() : fallback;
}

function HourlyCard({ slot, timeZone }: { slot: HourlySlot; timeZone: string }) {
  const ms = Date.parse(slot.time);
  const timeStr = Number.isFinite(ms)
    ? formatInZone(ms, { timeZone, withSeconds: false })
    : slot.time;
  const isObs = slot.source === "observed";

  return (
    <div className={`hf-card${isObs ? " hf-card--observed" : ""}`} title={isObs ? "Observed" : "Forecast"}>
      <div className="hf-card-time">{timeStr}</div>
      <div className="hf-card-wx">{wmoLabel(slot.weather_code)}</div>
      <div className="hf-card-temp">
        {fmt1(slot.temperature_c)}<span className="hf-card-unit">°C</span>
      </div>
      <div className="hf-card-wind">
        {windArrow(slot.wind_direction_deg)} {fmt0(slot.wind_speed_kmh)}<span className="hf-card-unit">km/h</span>
      </div>
      <div className="hf-card-precip">
        {fmt0(slot.precipitation_probability_pct)}<span className="hf-card-unit">%</span>
        {slot.precipitation_mm !== null && slot.precipitation_mm > 0 && (
          <span className="hf-card-unit"> {fmt1(slot.precipitation_mm)}mm</span>
        )}
      </div>
      <div className="hf-card-rh">RH {fmt0(slot.relative_humidity_pct)}<span className="hf-card-unit">%</span></div>
    </div>
  );
}

function SkeletonCard() {
  return <div className="hf-card hf-card--skeleton" aria-hidden="true" />;
}

export function HourlyForecastPanel({ latitude, longitude, timeZone, onClose }: HourlyForecastPanelProps) {
  const [slots, setSlots] = useState<HourlySlot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Panel position (top-left corner)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 80, y: 64 });
  const dragStart = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const fetch = useCallback(() => {
    if (latitude === null || longitude === null) return;
    setLoading(true);
    setError(null);
    api.hourlyForecast(latitude, longitude, 48)
      .then((res) => {
        setSlots(res.slots);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Fetch failed");
        setLoading(false);
      });
  }, [latitude, longitude]);

  useEffect(() => { fetch(); }, [fetch]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
  }, [pos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    setPos({
      x: Math.max(0, dragStart.current.ox + e.clientX - dragStart.current.px),
      y: Math.max(0, dragStart.current.oy + e.clientY - dragStart.current.py),
    });
  }, []);

  const onPointerUp = useCallback(() => { dragStart.current = null; }, []);

  const locationStr = latitude !== null && longitude !== null
    ? `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
    : "No location";

  return (
    <div
      className="hf-panel"
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Hourly Forecast"
    >
      <div
        className="hf-header"
        ref={headerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="hf-header-title">HOURLY FORECAST</span>
        <span className="hf-header-loc">{locationStr}</span>
        <div className="hf-header-actions">
          <button type="button" className="wb-icon-btn" onClick={fetch} title="Refresh" disabled={loading}>
            {loading ? "..." : "↺"}
          </button>
          <button type="button" className="wb-icon-btn" onClick={onClose} title="Close">
            X
          </button>
        </div>
      </div>

      <div className="hf-scroll">
        {error ? (
          <div className="hf-error">{error}</div>
        ) : loading || !slots ? (
          Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)
        ) : slots.length === 0 ? (
          <div className="hf-empty">No forecast data available.</div>
        ) : (
          slots.map((slot) => (
            <HourlyCard key={slot.time} slot={slot} timeZone={timeZone} />
          ))
        )}
      </div>
    </div>
  );
}
