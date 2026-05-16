// Celestial-sphere math + bright-star catalogue.
//
// Coordinates:
//   ECEF  — Earth-Centered, Earth-Fixed.        x toward (lon=0,lat=0), z = rotation axis.
//   ECI   — Earth-Centered, Inertial (J2000ish). x toward vernal equinox, z = celestial north pole.
//   Stars — RA (deg, 0..360 east of vernal equinox), Dec (deg).
//
// Transform: ECI = Rz(GMST) · ECEF.  (Earth's rotation about its axis.)
// We treat ECEF z-axis ≡ celestial north for visualisation. Precession/nutation/proper
// motion are negligible at single-pixel star-symbol precision.
//
// COSMIC-TODO(B): Generalise to a heliocentric J2000 frame for solar-system bodies.
//   Add: helio↔geo rotation, light-time correction, optional aberration. Keep ECEF↔ECI here;
//   put the new transforms in `lib/ephemeris/frames.ts`. See docs/cosmic-scope-roadmap.md §2.
// COSMIC-TODO(A): Vendor the HYG database (~120k stars) as a static asset; lazy-load when the
//   user zooms out far enough that BRIGHT_STARS is no longer enough. Apply spectral-type → B-V
//   colour ramp at draw time. See docs/cosmic-scope-roadmap.md §9 Phase A.

export interface Star {
  name: string;
  ra: number;   // degrees, 0..360
  dec: number;  // degrees, -90..+90
  mag: number;  // apparent visual magnitude (V band)
  // OSINT enrichment — sourced from Hipparcos/Simbad/NASA Exoplanet Archive (J2000 epoch).
  // All optional so we can ship partial data and fill in later from external feeds.
  distanceLy?: number;          // light-years
  spectralType?: string;        // e.g. "B8Ia", "G2V"
  massSolar?: number;           // M☉
  radiusSolar?: number;         // R☉
  luminositySolar?: number;     // L☉ (visual)
  constellation?: string;
  bayer?: string;               // "α CMa" etc.
  notes?: string;               // 1-2 sentence pop-sci description
  exoplanets?: string[];        // names of confirmed planets, if any
  hostsExoplanets?: boolean;    // true even if names unknown (per NASA archive)
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const DEG = Math.PI / 180;
export const EARTH_RADIUS_KM = 6371;

/** ms-since-epoch → Julian Date (UT1≈UTC for visualisation). */
export function julianDate(ms: number): number {
  return ms / 86_400_000 + 2_440_587.5;
}

/** Greenwich Mean Sidereal Time, radians. Vallado, low-precision. */
export function gmstRadians(ms: number): number {
  const jd = julianDate(ms);
  const T = (jd - 2_451_545.0) / 36_525;
  // degrees:
  let g = 280.46061837
        + 360.98564736629 * (jd - 2_451_545.0)
        + 0.000387933 * T * T
        - (T * T * T) / 38_710_000;
  g = ((g % 360) + 360) % 360;
  return g * DEG;
}

/** Camera position on Earth surface (or above it) → ECI unit vector × distance(km). */
export function cameraEci(lat: number, lon: number, altitudeKm: number, gmst: number): Vec3 {
  const r = EARTH_RADIUS_KM + altitudeKm;
  const latR = lat * DEG;
  const lonR = lon * DEG;
  // ECEF
  const xe = r * Math.cos(latR) * Math.cos(lonR);
  const ye = r * Math.cos(latR) * Math.sin(lonR);
  const ze = r * Math.sin(latR);
  // Rz(GMST)
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  return {
    x: c * xe - s * ye,
    y: s * xe + c * ye,
    z: ze,
  };
}

/** Star RA/Dec → ECI unit direction. */
export function starEci(s: Star): Vec3 {
  const raR = s.ra * DEG;
  const decR = s.dec * DEG;
  return {
    x: Math.cos(decR) * Math.cos(raR),
    y: Math.cos(decR) * Math.sin(raR),
    z: Math.sin(decR),
  };
}

function vlen(v: Vec3) { return Math.hypot(v.x, v.y, v.z); }
function vnorm(v: Vec3): Vec3 { const L = vlen(v) || 1; return { x: v.x / L, y: v.y / L, z: v.z / L }; }
function vdot(a: Vec3, b: Vec3) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function vcross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export interface CameraBasis {
  forward: Vec3; // toward Earth centre (unit)
  right:   Vec3; // screen +x  (unit)
  up:      Vec3; // screen +y  (unit)
  distance: number; // |camera| from Earth centre, km
}

/** Build a camera basis at the given ECI position, looking at Earth's centre.
 *  `up` is the projection of celestial north onto the screen plane, then rotated by bearing. */
export function buildCameraBasis(camEci: Vec3, bearingDeg: number): CameraBasis {
  const D = vlen(camEci);
  const forward: Vec3 = { x: -camEci.x / D, y: -camEci.y / D, z: -camEci.z / D };

  // Project celestial north onto the plane perpendicular to forward.
  const north: Vec3 = { x: 0, y: 0, z: 1 };
  const dotFN = vdot(forward, north);
  let up: Vec3 = {
    x: north.x - dotFN * forward.x,
    y: north.y - dotFN * forward.y,
    z: north.z - dotFN * forward.z,
  };
  if (vlen(up) < 1e-6) {
    // Camera is on or extremely near the celestial axis — pick an arbitrary up.
    up = { x: 1, y: 0, z: 0 };
  } else {
    up = vnorm(up);
  }
  // Right-handed: right = forward × up (screen +x).
  const right = vnorm(vcross(forward, up));

  // Rotate (right, up) around forward by -bearing so a positive bearing rotates the world CCW.
  const b = -bearingDeg * DEG;
  const cb = Math.cos(b), sb = Math.sin(b);
  const rRight: Vec3 = {
    x: right.x * cb + up.x * sb,
    y: right.y * cb + up.y * sb,
    z: right.z * cb + up.z * sb,
  };
  const rUp: Vec3 = {
    x: -right.x * sb + up.x * cb,
    y: -right.y * sb + up.y * cb,
    z: -right.z * sb + up.z * cb,
  };

  return { forward, right: rRight, up: rUp, distance: D };
}

export interface Projected {
  x: number;     // screen px (origin top-left)
  y: number;
  z: number;     // depth (camera-forward dot star), > 0 = in front of camera
  occluded: boolean;
}

/** Project a star direction onto the screen. Returns null when off-screen behind the camera. */
export function projectStarToScreen(
  star: Vec3,
  basis: CameraBasis,
  focalPx: number,
  halfW: number,
  halfH: number,
  earthAngularRadiusRad: number,
): Projected | null {
  const zc = vdot(star, basis.forward);
  if (zc <= 0) return null; // behind camera

  const xc = vdot(star, basis.right);
  const yc = vdot(star, basis.up);

  // Earth disk occlusion: if star direction is within the angular radius of Earth (centered on forward), it's hidden.
  // cos(angle(s, forward)) = zc (both unit). zc > cos(earthAngularRadiusRad)  ⇒ inside disk.
  const occluded = zc > Math.cos(earthAngularRadiusRad);

  return {
    x: halfW + (xc / zc) * focalPx,
    y: halfH - (yc / zc) * focalPx,
    z: zc,
    occluded,
  };
}

/** Approximate camera altitude above Earth's surface as a function of MapLibre globe zoom. */
export function altitudeKmFromZoom(zoom: number): number {
  // Empirical fit so that at zoom 0 Earth ~fills viewport, at zoom 4 we're close enough that mercator takes over.
  // Returns altitude above surface in km.
  const z = Math.max(0, zoom);
  return EARTH_RADIUS_KM * (0.5 + 5 * Math.pow(2, -z));
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Bright-star catalogue. Top ~70 stars, mostly mag ≤ 2.5, plus Polaris and
 *  a few mid-mag landmarks for shape. RA in degrees (J2000), Dec in degrees.
 * ────────────────────────────────────────────────────────────────────────── */
export const BRIGHT_STARS: Star[] = [
  { name: "Sirius",         ra: 101.287, dec: -16.716, mag: -1.46, distanceLy:  8.6, spectralType: "A1V",   massSolar: 2.06,  radiusSolar: 1.71,  luminositySolar:   25.4, constellation: "Canis Major",     bayer: "α CMa", notes: "Brightest star in Earth's night sky. Binary with the white-dwarf companion Sirius B." },
  { name: "Canopus",        ra:  95.988, dec: -52.696, mag: -0.74, distanceLy: 310,  spectralType: "A9II",  massSolar: 8.0,   radiusSolar: 71,    luminositySolar: 10700,  constellation: "Carina",           bayer: "α Car", notes: "Yellow-white supergiant; second-brightest star. Used by spacecraft as a navigation reference." },
  { name: "Arcturus",       ra: 213.915, dec:  19.182, mag: -0.05, distanceLy: 36.7, spectralType: "K1.5III",massSolar: 1.08, radiusSolar: 25.4,  luminositySolar:  170,   constellation: "Boötes",           bayer: "α Boo", notes: "Old red giant moving rapidly through the local stellar neighborhood." },
  { name: "Rigil Kentaurus",ra: 219.902, dec: -60.834, mag: -0.27, distanceLy:  4.37,spectralType: "G2V+K1V",massSolar: 1.1, radiusSolar: 1.22,  luminositySolar:    1.5, constellation: "Centaurus",        bayer: "α Cen", notes: "Closest stellar system to the Sun. The A/B pair is joined by red-dwarf Proxima Centauri, which hosts the exoplanet Proxima b.", exoplanets: ["Proxima b", "Proxima c", "Proxima d"], hostsExoplanets: true },
  { name: "Vega",           ra: 279.234, dec:  38.784, mag:  0.03, distanceLy: 25.04,spectralType: "A0V",   massSolar: 2.14,  radiusSolar: 2.36,  luminositySolar:   40.1, constellation: "Lyra",             bayer: "α Lyr", notes: "Defines the zero-point of the photometric magnitude scale and pole-stars near it ~12,000 years ago." },
  { name: "Capella",        ra:  79.172, dec:  45.998, mag:  0.08, distanceLy: 42.9, spectralType: "G3III+G8III", massSolar: 2.57, radiusSolar: 11.98, luminositySolar: 78.7, constellation: "Auriga",       bayer: "α Aur", notes: "Quadruple system: two yellow giants orbiting tightly, plus a distant red-dwarf pair." },
  { name: "Rigel",          ra:  78.634, dec:  -8.202, mag:  0.13, distanceLy: 860,  spectralType: "B8Ia",  massSolar: 21,    radiusSolar: 78.9,  luminositySolar:120000,  constellation: "Orion",            bayer: "β Ori", notes: "Blue supergiant burning through hydrogen at a furious rate; will likely end as a supernova." },
  { name: "Procyon",        ra: 114.825, dec:   5.225, mag:  0.34, distanceLy: 11.46,spectralType: "F5IV-V",massSolar: 1.499, radiusSolar: 2.05,  luminositySolar:    6.93,constellation: "Canis Minor",      bayer: "α CMi", notes: "Subgiant about to leave the main sequence; orbits a faint white-dwarf companion." },
  { name: "Achernar",       ra:  24.429, dec: -57.237, mag:  0.46, distanceLy: 139,  spectralType: "B6Vep", massSolar: 6.7,   radiusSolar: 7.3,   luminositySolar: 3150,   constellation: "Eridanus",         bayer: "α Eri", notes: "Spinning so fast it is the most oblate known star — about 1.5× wider at the equator than pole-to-pole." },
  { name: "Betelgeuse",     ra:  88.793, dec:   7.407, mag:  0.50, distanceLy: 548,  spectralType: "M1-2Ia-Iab",massSolar: 16.5,radiusSolar: 887, luminositySolar:126000, constellation: "Orion",            bayer: "α Ori", notes: "Red supergiant; underwent the 2019–2020 'Great Dimming'. Candidate to go supernova within ~100,000 years." },
  { name: "Hadar",          ra: 210.956, dec: -60.373, mag:  0.61, distanceLy: 392,  spectralType: "B1III", massSolar: 10.7,  radiusSolar: 9,     luminositySolar: 41700,  constellation: "Centaurus",        bayer: "β Cen", notes: "Triple system of hot blue giants; close neighbour of Rigil Kentaurus on the sky." },
  { name: "Altair",         ra: 297.696, dec:   8.868, mag:  0.77, distanceLy: 16.73,spectralType: "A7V",   massSolar: 1.79,  radiusSolar: 1.63,  luminositySolar:   10.6, constellation: "Aquila",           bayer: "α Aql", notes: "Rotates once every 9 hours — visibly oblate to interferometers. Forms the Summer Triangle with Vega and Deneb." },
  { name: "Acrux",          ra: 186.650, dec: -63.099, mag:  0.81, distanceLy: 320,  spectralType: "B0.5IV+B1V",massSolar: 17.8,radiusSolar: 7.8, luminositySolar: 25000,  constellation: "Crux",             bayer: "α Cru", notes: "Brightest star of the Southern Cross; multi-star system of hot blue subgiants." },
  { name: "Aldebaran",      ra:  68.980, dec:  16.509, mag:  0.85, distanceLy: 65.3, spectralType: "K5III", massSolar: 1.16,  radiusSolar: 45.1,  luminositySolar:  439,   constellation: "Taurus",           bayer: "α Tau", notes: "Orange giant; the 'eye' of Taurus. Voyager 2 will pass within 1.7 light-years of it in ~2 million years." },
  { name: "Spica",          ra: 201.298, dec: -11.161, mag:  0.97, distanceLy: 250,  spectralType: "B1III-IV+B2V",massSolar: 11.43,radiusSolar: 7.47,luminositySolar: 20512,constellation: "Virgo",            bayer: "α Vir", notes: "Close binary with both members hot blue stars; show subtle tidal deformation as they orbit every 4 days." },
  { name: "Antares",        ra: 247.352, dec: -26.432, mag:  1.06, distanceLy: 550,  spectralType: "M1.5Iab-Ib",massSolar: 12,radiusSolar: 680, luminositySolar: 75900, constellation: "Scorpius",           bayer: "α Sco", notes: "Red supergiant comparable in size to Betelgeuse; name means 'rival of Mars'." },
  { name: "Pollux",         ra: 116.329, dec:  28.026, mag:  1.14, distanceLy: 33.78,spectralType: "K0III", massSolar: 1.91,  radiusSolar: 9.06,  luminositySolar:   32.7, constellation: "Gemini",           bayer: "β Gem", notes: "Closest giant star to Earth. Confirmed exoplanet Pollux b (Thestias) discovered in 2006.", exoplanets: ["Pollux b"], hostsExoplanets: true },
  { name: "Fomalhaut",      ra: 344.413, dec: -29.622, mag:  1.16, distanceLy: 25.13,spectralType: "A3V",   massSolar: 1.92,  radiusSolar: 1.84,  luminositySolar:   16.6, constellation: "Piscis Austrinus", bayer: "α PsA", notes: "Surrounded by an inner asteroid belt and a vast outer dust ring; JWST has resolved structure suggestive of planet sculpting.", hostsExoplanets: true },
  { name: "Deneb",          ra: 310.358, dec:  45.280, mag:  1.25, distanceLy: 2615, spectralType: "A2Ia",  massSolar: 19,    radiusSolar: 203,   luminositySolar:196000,  constellation: "Cygnus",           bayer: "α Cyg", notes: "Most luminous of the Summer Triangle stars; its intrinsic brightness is staggering despite its great distance." },
  { name: "Mimosa",         ra: 191.930, dec: -59.689, mag:  1.25, distanceLy: 280,  spectralType: "B0.5III",massSolar:16,    radiusSolar: 8.4,   luminositySolar: 34000,  constellation: "Crux",             bayer: "β Cru", notes: "Beta-Cephei-type pulsating blue giant; another member of the Southern Cross." },
  { name: "Regulus",        ra: 152.093, dec:  11.967, mag:  1.35, distanceLy: 79.3, spectralType: "B8IVn", massSolar: 3.8,   radiusSolar: 4.35,  luminositySolar:  316,   constellation: "Leo",              bayer: "α Leo", notes: "Spins near break-up speed (~96.5% of critical); strongly oblate and faster-rotating than any other bright star." },
  { name: "Adhara",         ra: 104.656, dec: -28.972, mag:  1.50 },
  { name: "Castor",         ra: 113.650, dec:  31.888, mag:  1.58 },
  { name: "Shaula",         ra: 263.402, dec: -37.104, mag:  1.62 },
  { name: "Gacrux",         ra: 187.791, dec: -57.113, mag:  1.63 },
  { name: "Bellatrix",      ra:  81.283, dec:   6.350, mag:  1.64 },
  { name: "Elnath",         ra:  81.573, dec:  28.608, mag:  1.65 },
  { name: "Miaplacidus",    ra: 138.300, dec: -69.717, mag:  1.69 },
  { name: "Alnilam",        ra:  84.053, dec:  -1.202, mag:  1.69 },
  { name: "Alnitak",        ra:  85.190, dec:  -1.943, mag:  1.74 },
  { name: "Alnair",         ra: 332.058, dec: -46.961, mag:  1.74 },
  { name: "Alioth",         ra: 193.507, dec:  55.960, mag:  1.76 },
  { name: "Dubhe",          ra: 165.932, dec:  61.751, mag:  1.79 },
  { name: "Mirfak",         ra:  51.081, dec:  49.861, mag:  1.79 },
  { name: "Wezen",          ra: 107.098, dec: -26.393, mag:  1.83 },
  { name: "Kaus Australis", ra: 276.043, dec: -34.385, mag:  1.85 },
  { name: "Alkaid",         ra: 206.885, dec:  49.313, mag:  1.85 },
  { name: "Sargas",         ra: 264.330, dec: -42.998, mag:  1.86 },
  { name: "Avior",          ra: 125.628, dec: -59.510, mag:  1.86 },
  { name: "Menkalinan",     ra:  89.882, dec:  44.948, mag:  1.90 },
  { name: "Atria",          ra: 252.166, dec: -69.028, mag:  1.91 },
  { name: "Alhena",         ra:  99.428, dec:  16.399, mag:  1.93 },
  { name: "Peacock",        ra: 306.412, dec: -56.735, mag:  1.94 },
  { name: "Polaris",        ra:  37.955, dec:  89.264, mag:  1.98 },
  { name: "Mirzam",         ra:  95.675, dec: -17.956, mag:  1.98 },
  { name: "Alphard",        ra: 141.897, dec:  -8.659, mag:  1.99 },
  { name: "Algol",          ra:  47.042, dec:  40.956, mag:  2.12 },
  { name: "Hamal",          ra:  31.793, dec:  23.462, mag:  2.00 },
  { name: "Diphda",         ra:  10.897, dec: -17.987, mag:  2.04 },
  { name: "Nunki",          ra: 283.816, dec: -26.297, mag:  2.05 },
  { name: "Saiph",          ra:  86.939, dec:  -9.670, mag:  2.07 },
  { name: "Mizar",          ra: 200.981, dec:  54.926, mag:  2.23 },
  { name: "Kochab",         ra: 222.676, dec:  74.156, mag:  2.07 },
  { name: "Rasalhague",     ra: 263.734, dec:  12.561, mag:  2.08 },
  { name: "Algieba",        ra: 154.993, dec:  19.842, mag:  2.08 },
  { name: "Denebola",       ra: 177.265, dec:  14.572, mag:  2.13 },
  { name: "Tiaki",          ra: 340.667, dec: -46.885, mag:  2.07 },
  { name: "Caph",           ra:   2.295, dec:  59.150, mag:  2.27 },
  { name: "Schedar",        ra:  10.127, dec:  56.537, mag:  2.24 },
  { name: "Navi",           ra:  14.177, dec:  60.717, mag:  2.47 },
  { name: "Ruchbah",        ra:  21.454, dec:  60.235, mag:  2.66 },
  { name: "Almach",         ra:  30.975, dec:  42.330, mag:  2.10 },
  { name: "Mirach",         ra:  17.433, dec:  35.621, mag:  2.05 },
  { name: "Alpheratz",      ra:   2.097, dec:  29.090, mag:  2.07 },
  { name: "Markab",         ra: 346.190, dec:  15.205, mag:  2.49 },
  { name: "Scheat",         ra: 345.943, dec:  28.083, mag:  2.42 },
  { name: "Algenib",        ra:   3.309, dec:  15.184, mag:  2.83 },
  { name: "Enif",           ra: 326.046, dec:   9.875, mag:  2.39 },
  { name: "Sadr",           ra: 305.557, dec:  40.257, mag:  2.23 },
  { name: "Albireo",        ra: 292.680, dec:  27.960, mag:  3.05 },
  { name: "Eltanin",        ra: 269.152, dec:  51.489, mag:  2.23 },
  { name: "Etamin",         ra: 269.151, dec:  51.488, mag:  2.23 },
  { name: "Izar",           ra: 221.247, dec:  27.074, mag:  2.37 },
  { name: "Phecda",         ra: 178.458, dec:  53.694, mag:  2.41 },
  { name: "Merak",          ra: 165.460, dec:  56.382, mag:  2.34 },
  { name: "Megrez",         ra: 183.857, dec:  57.033, mag:  3.31 },
];
