// Time-zone preference helpers.
//
// The active IANA timezone is shared by the top-bar VALID/NOW readout,
// the bottom timeline, and the inspector so the operator sees one
// consistent local time across the workstation. Persisted in
// localStorage["canwxlab.timezone"] so it survives reloads.

const STORAGE_KEY = "canwxlab.timezone";

export interface TimeZoneOption {
  id: string;
  label: string;
  /** Short hint shown next to the label so operators recognise the zone. */
  hint: string;
}

/**
 * Curated short-list shown first in the picker. The full set of IANA zones is
 * far larger; the picker also lets the user type any IANA string the runtime
 * accepts. These cover the major OSINT/meteorology operations centres.
 */
export const COMMON_TIME_ZONES: TimeZoneOption[] = [
  { id: "UTC",                       label: "UTC",                hint: "Zulu / Coordinated Universal Time" },
  { id: "America/Halifax",           label: "Halifax",            hint: "Atlantic — UTC-4 / DST UTC-3" },
  { id: "America/Toronto",           label: "Toronto",            hint: "Eastern — UTC-5 / DST UTC-4" },
  { id: "America/New_York",          label: "New York",           hint: "Eastern — UTC-5 / DST UTC-4" },
  { id: "America/Chicago",           label: "Chicago",            hint: "Central — UTC-6 / DST UTC-5" },
  { id: "America/Denver",            label: "Denver",             hint: "Mountain — UTC-7 / DST UTC-6" },
  { id: "America/Edmonton",          label: "Edmonton",           hint: "Mountain — UTC-7 / DST UTC-6" },
  { id: "America/Los_Angeles",       label: "Los Angeles",        hint: "Pacific — UTC-8 / DST UTC-7" },
  { id: "America/Vancouver",         label: "Vancouver",          hint: "Pacific — UTC-8 / DST UTC-7" },
  { id: "America/Anchorage",         label: "Anchorage",          hint: "Alaska — UTC-9 / DST UTC-8" },
  { id: "America/Mexico_City",       label: "Mexico City",        hint: "Central Mexico — UTC-6" },
  { id: "America/Sao_Paulo",         label: "São Paulo",          hint: "Brazil — UTC-3" },
  { id: "Europe/London",             label: "London",             hint: "GMT / BST UTC+1" },
  { id: "Europe/Paris",              label: "Paris",              hint: "CET — UTC+1 / CEST UTC+2" },
  { id: "Europe/Berlin",             label: "Berlin",             hint: "CET — UTC+1 / CEST UTC+2" },
  { id: "Europe/Moscow",             label: "Moscow",             hint: "MSK — UTC+3" },
  { id: "Africa/Cairo",              label: "Cairo",              hint: "EET — UTC+2" },
  { id: "Africa/Johannesburg",       label: "Johannesburg",       hint: "SAST — UTC+2" },
  { id: "Asia/Dubai",                label: "Dubai",              hint: "GST — UTC+4" },
  { id: "Asia/Kolkata",              label: "Kolkata",            hint: "IST — UTC+5:30" },
  { id: "Asia/Singapore",            label: "Singapore",          hint: "SGT — UTC+8" },
  { id: "Asia/Shanghai",             label: "Shanghai",           hint: "CST — UTC+8" },
  { id: "Asia/Tokyo",                label: "Tokyo",              hint: "JST — UTC+9" },
  { id: "Asia/Seoul",                label: "Seoul",              hint: "KST — UTC+9" },
  { id: "Australia/Sydney",          label: "Sydney",             hint: "AEST UTC+10 / AEDT UTC+11" },
  { id: "Pacific/Auckland",          label: "Auckland",           hint: "NZST UTC+12 / NZDT UTC+13" },
  { id: "Pacific/Honolulu",          label: "Honolulu",           hint: "HST — UTC-10" },
];

export function browserDefaultTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  } catch {
    /* fall through */
  }
  return "UTC";
}

export function isValidTimeZone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function getStoredTimeZone(): string {
  if (typeof window === "undefined") return "UTC";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isValidTimeZone(raw)) return raw;
  } catch {
    /* ignore */
  }
  return browserDefaultTimeZone();
}

export function setStoredTimeZone(tz: string): void {
  if (typeof window === "undefined") return;
  if (!isValidTimeZone(tz)) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, tz);
  } catch {
    /* ignore */
  }
}

export interface FormatOptions {
  timeZone: string;
  withSeconds?: boolean;
  withDate?: boolean;
}

const TIME_FORMAT_CACHE = new Map<string, Intl.DateTimeFormat>();

function formatterFor(opts: FormatOptions): Intl.DateTimeFormat {
  const key = `${opts.timeZone}|${opts.withSeconds ? "s" : ""}|${opts.withDate ? "d" : ""}`;
  let fmt = TIME_FORMAT_CACHE.get(key);
  if (fmt) return fmt;
  const init: Intl.DateTimeFormatOptions = {
    timeZone: opts.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (opts.withSeconds) init.second = "2-digit";
  if (opts.withDate) {
    init.year = "numeric";
    init.month = "2-digit";
    init.day = "2-digit";
  }
  fmt = new Intl.DateTimeFormat("en-CA", init);
  TIME_FORMAT_CACHE.set(key, fmt);
  return fmt;
}

export function formatInZone(ms: number, opts: FormatOptions): string {
  if (!Number.isFinite(ms)) return "--:--:--";
  try {
    return formatterFor(opts).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/** Short "UTC+05:30" / "UTC-08:00" style offset label for the picker. */
export function utcOffsetLabel(tz: string, ms: number = Date.now()): string {
  if (!isValidTimeZone(tz)) return "";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = fmt.formatToParts(new Date(ms));
    const offset = parts.find((part) => part.type === "timeZoneName")?.value;
    return offset ?? "";
  } catch {
    return "";
  }
}
