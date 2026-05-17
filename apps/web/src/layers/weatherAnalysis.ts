// Lightweight derived-meteorology helpers.
//
// These are the standard analytic relations used by GIS / met workstations
// when displaying station observations. Inputs are in SI metric units;
// every function returns a number or `null` when the input is missing or
// out of range. Nothing here is a forecast — it is local derived state.
//
// References:
//   Magnus/Tetens formula for saturation vapour pressure (good to <0.4% in
//     the -40..+50 °C range): WMO Guide to Meteorological Instruments,
//     CIMO Guide, ch. 4.
//   Ideal gas / moist air density: WMO CIMO Guide ch. 4 §4.2.2.
//   Beaufort scale: WMO publication No. 8, Annex 4.A.

export const KELVIN_OFFSET = 273.15;
const R_DRY = 287.058; // J/(kg·K)
const R_VAPOUR = 461.495; // J/(kg·K)

export function magnusSaturationVapourHpa(tempC: number): number | null {
  if (!Number.isFinite(tempC) || tempC < -80 || tempC > 70) return null;
  // Magnus coefficients over water.
  const a = 17.625;
  const b = 243.04;
  return 6.1094 * Math.exp((a * tempC) / (b + tempC));
}

/** Dewpoint (°C) from temperature and relative humidity (%, 0..100). */
export function dewpointFromTempRH(tempC: number, rhPct: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPct)) return null;
  if (rhPct <= 0 || rhPct > 100) return null;
  const a = 17.625;
  const b = 243.04;
  const gamma = Math.log(rhPct / 100) + (a * tempC) / (b + tempC);
  return (b * gamma) / (a - gamma);
}

/** Relative humidity (%) from temperature and dewpoint (°C). */
export function rhFromTempDewpoint(tempC: number, dewpointC: number): number | null {
  const es = magnusSaturationVapourHpa(tempC);
  const e = magnusSaturationVapourHpa(dewpointC);
  if (es === null || e === null || es <= 0) return null;
  const rh = (e / es) * 100;
  return Math.max(0, Math.min(100, rh));
}

/** Moist-air density kg/m^3 using ideal gas; pressure in hPa, temp in °C. */
export function airDensityKgM3(
  pressureHpa: number,
  tempC: number,
  dewpointC?: number | null,
): number | null {
  if (!Number.isFinite(pressureHpa) || !Number.isFinite(tempC)) return null;
  const tempK = tempC + KELVIN_OFFSET;
  if (tempK <= 0) return null;
  const pressurePa = pressureHpa * 100;
  if (dewpointC == null || !Number.isFinite(dewpointC)) {
    return pressurePa / (R_DRY * tempK);
  }
  const vapourHpa = magnusSaturationVapourHpa(dewpointC) ?? 0;
  const vapourPa = vapourHpa * 100;
  const dryPartialPa = Math.max(0, pressurePa - vapourPa);
  return dryPartialPa / (R_DRY * tempK) + vapourPa / (R_VAPOUR * tempK);
}

export function windDirectionFromUVDeg(u: number, v: number): number | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  if (u === 0 && v === 0) return null;
  // Meteorological convention: direction the wind is coming FROM, degrees
  // clockwise from north. atan2 here is on the from-vector (-u, -v).
  const deg = (Math.atan2(-u, -v) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function windSpeedFromUV(u: number, v: number): number | null {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
  return Math.hypot(u, v);
}

export function cardinalDirection(degrees: number): string {
  if (!Number.isFinite(degrees)) return "—";
  const cardinals = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                     "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(((degrees % 360) + 360) % 360 / 22.5) % 16;
  return cardinals[idx];
}

export interface BeaufortLevel {
  force: number;
  label: string;
  /** Inclusive upper bound in m/s. */
  upperMs: number;
}

const BEAUFORT_TABLE: BeaufortLevel[] = [
  { force: 0,  label: "Calm",            upperMs: 0.3 },
  { force: 1,  label: "Light air",       upperMs: 1.5 },
  { force: 2,  label: "Light breeze",    upperMs: 3.3 },
  { force: 3,  label: "Gentle breeze",   upperMs: 5.4 },
  { force: 4,  label: "Moderate breeze", upperMs: 7.9 },
  { force: 5,  label: "Fresh breeze",    upperMs: 10.7 },
  { force: 6,  label: "Strong breeze",   upperMs: 13.8 },
  { force: 7,  label: "Near gale",       upperMs: 17.1 },
  { force: 8,  label: "Gale",            upperMs: 20.7 },
  { force: 9,  label: "Strong gale",     upperMs: 24.4 },
  { force: 10, label: "Storm",           upperMs: 28.4 },
  { force: 11, label: "Violent storm",   upperMs: 32.6 },
  { force: 12, label: "Hurricane force", upperMs: Number.POSITIVE_INFINITY },
];

export function beaufortFromWindMs(speedMs: number): BeaufortLevel | null {
  if (!Number.isFinite(speedMs) || speedMs < 0) return null;
  for (const level of BEAUFORT_TABLE) {
    if (speedMs <= level.upperMs) return level;
  }
  return BEAUFORT_TABLE[BEAUFORT_TABLE.length - 1];
}

/** Great-circle distance in km between two lon/lat points. */
export function haversineKm(
  lon1: number, lat1: number, lon2: number, lat2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}
