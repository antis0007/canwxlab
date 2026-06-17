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
