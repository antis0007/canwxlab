// Curated world-city catalog for the City Picker.
//
// Goal: ~80 globally-distributed cities the meteorology and OSINT
// audience is most likely to want a quick jump-to for. Each entry has
// IANA timezone so clicking a city can update the user's active zone.
// Coordinates are city-centre to ~3 decimal places (population centroid).
//
// Not exhaustive. The picker also supports free-text search by name or
// country; if the operator needs a city not in this list they can
// right-click → "Center view here" or use the URL camera state.

export interface CityEntry {
  id: string;
  name: string;
  country: string;
  longitude: number;
  latitude: number;
  timezone: string;
  /** Used as a relevance hint when sorting; not a hard population number. */
  rank: number;
}

export const WORLD_CITIES: CityEntry[] = [
  // Canada
  { id: "yto", name: "Toronto",     country: "Canada",    longitude:  -79.383, latitude:  43.653, timezone: "America/Toronto",   rank: 4 },
  { id: "ymq", name: "Montreal",    country: "Canada",    longitude:  -73.567, latitude:  45.501, timezone: "America/Toronto",   rank: 4 },
  { id: "yvr", name: "Vancouver",   country: "Canada",    longitude: -123.117, latitude:  49.283, timezone: "America/Vancouver", rank: 4 },
  { id: "yyc", name: "Calgary",     country: "Canada",    longitude: -114.066, latitude:  51.045, timezone: "America/Edmonton",  rank: 3 },
  { id: "yeg", name: "Edmonton",    country: "Canada",    longitude: -113.490, latitude:  53.546, timezone: "America/Edmonton",  rank: 3 },
  { id: "yow", name: "Ottawa",      country: "Canada",    longitude:  -75.700, latitude:  45.421, timezone: "America/Toronto",   rank: 3 },
  { id: "ywg", name: "Winnipeg",    country: "Canada",    longitude:  -97.139, latitude:  49.895, timezone: "America/Winnipeg",  rank: 3 },
  { id: "yhz", name: "Halifax",     country: "Canada",    longitude:  -63.572, latitude:  44.649, timezone: "America/Halifax",   rank: 3 },
  { id: "yqb", name: "Quebec City", country: "Canada",    longitude:  -71.208, latitude:  46.814, timezone: "America/Toronto",   rank: 3 },
  { id: "yyz", name: "Iqaluit",     country: "Canada",    longitude:  -68.518, latitude:  63.748, timezone: "America/Iqaluit",   rank: 2 },
  // USA
  { id: "nyc", name: "New York",    country: "USA",       longitude:  -74.006, latitude:  40.713, timezone: "America/New_York",   rank: 5 },
  { id: "wdc", name: "Washington",  country: "USA",       longitude:  -77.037, latitude:  38.895, timezone: "America/New_York",   rank: 4 },
  { id: "bos", name: "Boston",      country: "USA",       longitude:  -71.058, latitude:  42.361, timezone: "America/New_York",   rank: 3 },
  { id: "mia", name: "Miami",       country: "USA",       longitude:  -80.193, latitude:  25.762, timezone: "America/New_York",   rank: 3 },
  { id: "atl", name: "Atlanta",     country: "USA",       longitude:  -84.388, latitude:  33.749, timezone: "America/New_York",   rank: 3 },
  { id: "ord", name: "Chicago",     country: "USA",       longitude:  -87.630, latitude:  41.878, timezone: "America/Chicago",    rank: 4 },
  { id: "dfw", name: "Dallas",      country: "USA",       longitude:  -96.797, latitude:  32.776, timezone: "America/Chicago",    rank: 3 },
  { id: "hou", name: "Houston",     country: "USA",       longitude:  -95.369, latitude:  29.760, timezone: "America/Chicago",    rank: 3 },
  { id: "den", name: "Denver",      country: "USA",       longitude: -104.991, latitude:  39.739, timezone: "America/Denver",     rank: 3 },
  { id: "phx", name: "Phoenix",     country: "USA",       longitude: -112.074, latitude:  33.448, timezone: "America/Phoenix",    rank: 3 },
  { id: "lax", name: "Los Angeles", country: "USA",       longitude: -118.244, latitude:  34.052, timezone: "America/Los_Angeles",rank: 4 },
  { id: "sfo", name: "San Francisco",country:"USA",       longitude: -122.419, latitude:  37.775, timezone: "America/Los_Angeles",rank: 3 },
  { id: "sea", name: "Seattle",     country: "USA",       longitude: -122.332, latitude:  47.606, timezone: "America/Los_Angeles",rank: 3 },
  { id: "anc", name: "Anchorage",   country: "USA",       longitude: -149.900, latitude:  61.218, timezone: "America/Anchorage",  rank: 2 },
  { id: "hnl", name: "Honolulu",    country: "USA",       longitude: -157.858, latitude:  21.307, timezone: "Pacific/Honolulu",   rank: 2 },
  // Latin America
  { id: "mex", name: "Mexico City", country: "Mexico",    longitude:  -99.133, latitude:  19.433, timezone: "America/Mexico_City",rank: 4 },
  { id: "gua", name: "Guatemala City", country: "Guatemala", longitude: -90.522, latitude: 14.628, timezone: "America/Guatemala", rank: 2 },
  { id: "pty", name: "Panama City", country: "Panama",    longitude:  -79.518, latitude:   8.984, timezone: "America/Panama",     rank: 2 },
  { id: "bog", name: "Bogotá",      country: "Colombia",  longitude:  -74.072, latitude:   4.711, timezone: "America/Bogota",     rank: 3 },
  { id: "lim", name: "Lima",        country: "Peru",      longitude:  -77.043, latitude: -12.046, timezone: "America/Lima",       rank: 3 },
  { id: "scl", name: "Santiago",    country: "Chile",     longitude:  -70.673, latitude: -33.448, timezone: "America/Santiago",   rank: 3 },
  { id: "eze", name: "Buenos Aires",country: "Argentina", longitude:  -58.382, latitude: -34.604, timezone: "America/Argentina/Buenos_Aires", rank: 3 },
  { id: "gru", name: "São Paulo",   country: "Brazil",    longitude:  -46.633, latitude: -23.550, timezone: "America/Sao_Paulo",  rank: 4 },
  { id: "gig", name: "Rio de Janeiro",country:"Brazil",   longitude:  -43.196, latitude: -22.907, timezone: "America/Sao_Paulo",  rank: 3 },
  // Europe
  { id: "lon", name: "London",      country: "UK",        longitude:   -0.128, latitude:  51.507, timezone: "Europe/London",      rank: 5 },
  { id: "dub", name: "Dublin",      country: "Ireland",   longitude:   -6.260, latitude:  53.349, timezone: "Europe/Dublin",      rank: 2 },
  { id: "par", name: "Paris",       country: "France",    longitude:    2.352, latitude:  48.857, timezone: "Europe/Paris",       rank: 4 },
  { id: "mad", name: "Madrid",      country: "Spain",     longitude:   -3.703, latitude:  40.417, timezone: "Europe/Madrid",      rank: 3 },
  { id: "lis", name: "Lisbon",      country: "Portugal",  longitude:   -9.139, latitude:  38.722, timezone: "Europe/Lisbon",      rank: 2 },
  { id: "ams", name: "Amsterdam",   country: "Netherlands", longitude:  4.900, latitude:  52.367, timezone: "Europe/Amsterdam",   rank: 3 },
  { id: "ber", name: "Berlin",      country: "Germany",   longitude:   13.405, latitude:  52.520, timezone: "Europe/Berlin",      rank: 3 },
  { id: "rom", name: "Rome",        country: "Italy",     longitude:   12.496, latitude:  41.903, timezone: "Europe/Rome",        rank: 3 },
  { id: "ath", name: "Athens",      country: "Greece",    longitude:   23.728, latitude:  37.984, timezone: "Europe/Athens",      rank: 2 },
  { id: "war", name: "Warsaw",      country: "Poland",    longitude:   21.012, latitude:  52.230, timezone: "Europe/Warsaw",      rank: 2 },
  { id: "kbp", name: "Kyiv",        country: "Ukraine",   longitude:   30.524, latitude:  50.450, timezone: "Europe/Kyiv",        rank: 3 },
  { id: "mow", name: "Moscow",      country: "Russia",    longitude:   37.618, latitude:  55.756, timezone: "Europe/Moscow",      rank: 4 },
  { id: "led", name: "St. Petersburg",country:"Russia",   longitude:   30.336, latitude:  59.934, timezone: "Europe/Moscow",      rank: 2 },
  { id: "ist", name: "Istanbul",    country: "Turkey",    longitude:   28.978, latitude:  41.008, timezone: "Europe/Istanbul",    rank: 4 },
  // Middle East / Africa
  { id: "tlv", name: "Tel Aviv",    country: "Israel",    longitude:   34.781, latitude:  32.085, timezone: "Asia/Jerusalem",     rank: 2 },
  { id: "cai", name: "Cairo",       country: "Egypt",     longitude:   31.235, latitude:  30.044, timezone: "Africa/Cairo",       rank: 4 },
  { id: "dxb", name: "Dubai",       country: "UAE",       longitude:   55.276, latitude:  25.205, timezone: "Asia/Dubai",         rank: 4 },
  { id: "ruh", name: "Riyadh",      country: "Saudi Arabia", longitude: 46.770, latitude: 24.713, timezone: "Asia/Riyadh",        rank: 3 },
  { id: "thr", name: "Tehran",      country: "Iran",      longitude:   51.389, latitude:  35.689, timezone: "Asia/Tehran",        rank: 3 },
  { id: "los", name: "Lagos",       country: "Nigeria",   longitude:    3.379, latitude:   6.524, timezone: "Africa/Lagos",       rank: 4 },
  { id: "add", name: "Addis Ababa", country: "Ethiopia",  longitude:   38.748, latitude:   9.030, timezone: "Africa/Addis_Ababa", rank: 3 },
  { id: "nbo", name: "Nairobi",     country: "Kenya",     longitude:   36.821, latitude:  -1.292, timezone: "Africa/Nairobi",     rank: 3 },
  { id: "jnb", name: "Johannesburg",country: "South Africa",longitude: 28.046, latitude: -26.204, timezone: "Africa/Johannesburg",rank: 3 },
  { id: "cpt", name: "Cape Town",   country: "South Africa",longitude: 18.424, latitude: -33.925, timezone: "Africa/Johannesburg",rank: 3 },
  // Asia
  { id: "khi", name: "Karachi",     country: "Pakistan",  longitude:   67.010, latitude:  24.861, timezone: "Asia/Karachi",       rank: 4 },
  { id: "del", name: "Delhi",       country: "India",     longitude:   77.209, latitude:  28.614, timezone: "Asia/Kolkata",       rank: 5 },
  { id: "bom", name: "Mumbai",      country: "India",     longitude:   72.878, latitude:  19.076, timezone: "Asia/Kolkata",       rank: 5 },
  { id: "blr", name: "Bengaluru",   country: "India",     longitude:   77.595, latitude:  12.972, timezone: "Asia/Kolkata",       rank: 4 },
  { id: "ccu", name: "Kolkata",     country: "India",     longitude:   88.364, latitude:  22.572, timezone: "Asia/Kolkata",       rank: 4 },
  { id: "dac", name: "Dhaka",       country: "Bangladesh",longitude:   90.412, latitude:  23.811, timezone: "Asia/Dhaka",         rank: 4 },
  { id: "rgn", name: "Yangon",      country: "Myanmar",   longitude:   96.157, latitude:  16.866, timezone: "Asia/Yangon",        rank: 2 },
  { id: "bkk", name: "Bangkok",     country: "Thailand",  longitude:  100.502, latitude:  13.756, timezone: "Asia/Bangkok",       rank: 4 },
  { id: "sgn", name: "Ho Chi Minh City",country:"Vietnam",longitude:  106.660, latitude:  10.823, timezone: "Asia/Ho_Chi_Minh",   rank: 3 },
  { id: "han", name: "Hanoi",       country: "Vietnam",   longitude:  105.834, latitude:  21.028, timezone: "Asia/Ho_Chi_Minh",   rank: 3 },
  { id: "sin", name: "Singapore",   country: "Singapore", longitude:  103.820, latitude:   1.353, timezone: "Asia/Singapore",     rank: 4 },
  { id: "kul", name: "Kuala Lumpur",country: "Malaysia",  longitude:  101.687, latitude:   3.139, timezone: "Asia/Kuala_Lumpur",  rank: 3 },
  { id: "jkt", name: "Jakarta",     country: "Indonesia", longitude:  106.845, latitude:  -6.208, timezone: "Asia/Jakarta",       rank: 4 },
  { id: "mnl", name: "Manila",      country: "Philippines",longitude: 120.984, latitude:  14.599, timezone: "Asia/Manila",        rank: 4 },
  { id: "hkg", name: "Hong Kong",   country: "China",     longitude:  114.169, latitude:  22.320, timezone: "Asia/Hong_Kong",     rank: 4 },
  { id: "tpe", name: "Taipei",      country: "Taiwan",    longitude:  121.565, latitude:  25.033, timezone: "Asia/Taipei",        rank: 3 },
  { id: "pek", name: "Beijing",     country: "China",     longitude:  116.408, latitude:  39.904, timezone: "Asia/Shanghai",      rank: 5 },
  { id: "sha", name: "Shanghai",    country: "China",     longitude:  121.474, latitude:  31.230, timezone: "Asia/Shanghai",      rank: 5 },
  { id: "icn", name: "Seoul",       country: "South Korea",longitude: 126.978, latitude:  37.566, timezone: "Asia/Seoul",         rank: 4 },
  { id: "fnj", name: "Pyongyang",   country: "North Korea",longitude: 125.755, latitude:  39.039, timezone: "Asia/Pyongyang",     rank: 2 },
  { id: "hnd", name: "Tokyo",       country: "Japan",     longitude:  139.692, latitude:  35.690, timezone: "Asia/Tokyo",         rank: 5 },
  { id: "ovb", name: "Novosibirsk", country: "Russia",    longitude:   82.920, latitude:  55.030, timezone: "Asia/Novosibirsk",   rank: 2 },
  { id: "vvo", name: "Vladivostok", country: "Russia",    longitude:  131.886, latitude:  43.117, timezone: "Asia/Vladivostok",   rank: 2 },
  // Oceania
  { id: "syd", name: "Sydney",      country: "Australia", longitude:  151.209, latitude: -33.869, timezone: "Australia/Sydney",   rank: 4 },
  { id: "mel", name: "Melbourne",   country: "Australia", longitude:  144.963, latitude: -37.814, timezone: "Australia/Melbourne",rank: 4 },
  { id: "per", name: "Perth",       country: "Australia", longitude:  115.857, latitude: -31.953, timezone: "Australia/Perth",    rank: 3 },
  { id: "akl", name: "Auckland",    country: "New Zealand",longitude: 174.764, latitude: -36.848, timezone: "Pacific/Auckland",   rank: 3 },
  // High latitudes
  { id: "rkv", name: "Reykjavik",   country: "Iceland",   longitude:  -21.940, latitude:  64.146, timezone: "Atlantic/Reykjavik", rank: 2 },
  { id: "trd", name: "Tromsø",      country: "Norway",    longitude:   18.955, latitude:  69.649, timezone: "Europe/Oslo",        rank: 2 },
  { id: "lyr", name: "Longyearbyen",country: "Svalbard",  longitude:   15.633, latitude:  78.222, timezone: "Arctic/Longyearbyen",rank: 1 },
  { id: "mcm", name: "McMurdo",     country: "Antarctica",longitude:  166.668, latitude: -77.846, timezone: "Antarctica/McMurdo", rank: 1 },
];

export function searchCities(query: string, limit = 24): CityEntry[] {
  const term = query.trim().toLowerCase();
  if (term.length === 0) {
    return WORLD_CITIES.slice().sort((a, b) => b.rank - a.rank).slice(0, limit);
  }
  const matches: Array<{ city: CityEntry; score: number }> = [];
  for (const city of WORLD_CITIES) {
    const name = city.name.toLowerCase();
    const country = city.country.toLowerCase();
    let score = 0;
    if (name === term) score = 100;
    else if (name.startsWith(term)) score = 80 + city.rank;
    else if (name.includes(term)) score = 40 + city.rank;
    else if (country.startsWith(term)) score = 25 + city.rank;
    else if (country.includes(term)) score = 12 + city.rank;
    if (score > 0) matches.push({ city, score });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map((entry) => entry.city);
}
