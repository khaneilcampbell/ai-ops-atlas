import { useSyncExternalStore } from "react";
import { load, save } from "./storage";

/**
 * The time zone every date and time in Atlas is shown in. One IANA zone (e.g. America/New_York),
 * chosen in Settings and kept on this device. Intl handles daylight saving, so Eastern Time reads
 * EDT in summer and EST in winter without Atlas doing anything.
 *
 * Only display changes with the zone. Timestamps stay as ISO strings and epoch numbers, and
 * charts that bucket by day still use the device clock.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

const STORAGE_KEY = "timeZone";

/** True when this browser's Intl understands the zone name. */
export function isValidTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

let zone: string = (() => {
  const saved = load<unknown>(STORAGE_KEY, DEFAULT_TIME_ZONE);
  return isValidTimeZone(saved) ? saved : DEFAULT_TIME_ZONE;
})();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function getTimeZone(): string {
  return zone;
}

export function setTimeZone(next: string) {
  if (!isValidTimeZone(next) || next === zone) return;
  zone = next;
  save(STORAGE_KEY, zone);
  listeners.forEach((l) => l());
}

/** Re-renders the caller when the zone changes in Settings. */
export function useTimeZone(): string {
  return useSyncExternalStore(subscribe, () => zone);
}

type When = string | number | Date;
const toDate = (at: When) => (at instanceof Date ? at : new Date(at));

/** The one formatter for an instant: `toLocaleString` in the chosen zone. */
export function formatDateTime(at: When, opts?: Intl.DateTimeFormatOptions, timeZone = zone): string {
  const d = toDate(at);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleString(undefined, { ...(opts ?? DEFAULT_DATE_TIME), timeZone });
}

/** Date only, in the chosen zone. */
export function formatDay(at: When, opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" }, timeZone = zone): string {
  return formatDateTime(at, opts, timeZone);
}

/** Time only, in the chosen zone. */
export function formatTime(at: When, opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit", second: "2-digit" }, timeZone = zone): string {
  return formatDateTime(at, opts, timeZone);
}

const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" };

/** "2026-11-11": the calendar day of an instant in the chosen zone, for grouping by day. */
export function dayKey(at: When, timeZone = zone): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(toDate(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** "EST" / "EDT" (or "GMT+1" where there is no short name) for the zone at that moment. */
export function zoneAbbreviation(at: When = Date.now(), timeZone = zone): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(toDate(at)).find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

export interface ZoneOption {
  zone: string;
  /** "New York" */
  city: string;
  /** "Eastern Time" */
  name: string;
  /** "GMT-5" right now */
  offset: string;
  offsetMinutes: number;
}

export interface ZoneGroup {
  region: string;
  zones: ZoneOption[];
}

// Used only where Intl.supportedValuesOf is missing (older WebKit). Covers the main cities per region.
const FALLBACK_ZONES = [
  "UTC",
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "America/Halifax", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Jamaica", "America/Bogota", "America/Lima", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "America/Puerto_Rico",
  "Pacific/Honolulu", "Pacific/Auckland", "Pacific/Fiji",
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Amsterdam", "Europe/Stockholm", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
  "Africa/Lagos", "Africa/Cairo", "Africa/Johannesburg", "Africa/Nairobi", "Africa/Accra",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Karachi", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Manila", "Asia/Jakarta",
  "Australia/Perth", "Australia/Adelaide", "Australia/Brisbane", "Australia/Sydney", "Australia/Melbourne",
  "Atlantic/Reykjavik", "Atlantic/Azores", "Indian/Maldives", "Indian/Mauritius",
];

const REGIONS = ["America", "Europe", "Africa", "Asia", "Australia", "Pacific", "Atlantic", "Indian", "Antarctica", "Arctic"];
const REGION_LABEL: Record<string, string> = { America: "Americas", Indian: "Indian Ocean", Atlantic: "Atlantic", Pacific: "Pacific" };

export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  let zones: string[];
  try {
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const list = zones.length ? zones : FALLBACK_ZONES;
  // Always offer UTC and the default, even if this engine leaves them out of its list.
  return [...new Set(["UTC", DEFAULT_TIME_ZONE, ...list])].filter(isValidTimeZone);
}

function offsetOf(zone: string, at: Date): { label: string; minutes: number } {
  const label = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(label);
  const minutes = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return { label, minutes };
}

function genericName(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function describeZone(zone: string, at = new Date()): ZoneOption {
  const off = offsetOf(zone, at);
  const city = zone === "UTC" ? "UTC" : zone.split("/").slice(1).join(" / ").replace(/_/g, " ") || zone;
  const name = zone === "UTC" ? "Coordinated Universal Time" : genericName(zone, at);
  return { zone, city, name, offset: off.label, offsetMinutes: off.minutes };
}

/** Zones grouped by region (Americas, Europe, …), each sorted west to east then by city. */
export function zoneGroups(at = new Date(), zones = allTimeZones()): ZoneGroup[] {
  const byRegion = new Map<string, ZoneOption[]>();
  for (const z of zones) {
    const prefix = z.includes("/") ? z.split("/")[0] : "Other";
    const region = REGIONS.includes(prefix) ? (REGION_LABEL[prefix] ?? prefix) : "Other";
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region)!.push(describeZone(z, at));
  }
  const order = [...REGIONS.map((r) => REGION_LABEL[r] ?? r), "Other"];
  return order
    .filter((r) => byRegion.has(r))
    .map((region) => ({ region, zones: byRegion.get(region)!.sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.city.localeCompare(b.city)) }));
}

/** Keeps groups with a zone whose city, name, id or offset matches every word of the query. */
export function filterZoneGroups(groups: ZoneGroup[], query: string): ZoneGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((g) => ({ ...g, zones: g.zones.filter((z) => {
      const hay = `${z.city} ${z.name} ${z.zone} ${z.offset} ${g.region}`.toLowerCase().replace(/_/g, " ");
      return words.every((w) => hay.includes(w));
    }) }))
    .filter((g) => g.zones.length);
}

export function zoneLabel(z: ZoneOption): string {
  return z.name ? `${z.city} · ${z.name} (${z.offset})` : `${z.city} (${z.offset})`;
}
