/**
 * Next run times for the schedules n8n declares (server/n8n.ts turns each Schedule Trigger into a
 * five-field cron in the workflow's time zone). Plain code, no library: day by day in the
 * workflow's own zone, so daylight saving is handled by the platform's time zone data.
 *
 * Only predicts when n8n should start a run. Whether it did is read from n8n's run list.
 */
export const DEFAULT_TIME_ZONE = "America/New_York";

type Field = Set<number>;
export interface Cron {
  minute: Field;
  hour: Field;
  dom: Field;
  month: Field;
  dow: Field;
  /** Day of month and day of week both restricted: cron runs when either matches. */
  either: boolean;
}

function field(text: string, lo: number, hi: number): Field | null {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const every = m[2] ? Number(m[2]) : 1;
    if (every < 1) return null;
    let a = lo, b = hi;
    if (m[1] !== "*") {
      const [x, y] = m[1].split("-").map(Number);
      a = x;
      b = y ?? (m[2] ? hi : x);
    }
    if (a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += every) out.add(v);
  }
  return out;
}

/** Parses "m h dom mon dow"; Sunday is 0 (7 is accepted too). Null when the text is not a cron Atlas can read. */
export function parseCron(text: string): Cron | null {
  const p = text.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const minute = field(p[0], 0, 59), hour = field(p[1], 0, 23), dom = field(p[2], 1, 31), month = field(p[3], 1, 12), dow = field(p[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.has(7)) dow.add(0);
  return { minute, hour, dom, month, dow, either: p[2] !== "*" && p[4] !== "*" && !p[2].startsWith("*/") };
}

const parts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = parts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    parts.set(tz, f);
  }
  return f;
}

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall clock parts of an instant in a time zone. */
export function zoned(ms: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; dow: number } {
  const o: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(new Date(ms))) o[x.type] = x.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, dow: DOW[o.weekday] ?? 0 };
}

/** The instant a wall clock time in `tz` names (the earlier one in an autumn repeat; skipped spring times move on). */
export function fromZoned(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 3; i++) {
    const z = zoned(t, tz);
    const diff = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi) - guess;
    if (diff === 0) break;
    t -= diff;
  }
  return t;
}

/** A valid IANA zone name, or the default. */
export function zoneOr(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    fmt(tz);
    return tz;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** ISO week number of a calendar date (for "every 2 weeks" rules). */
function isoWeek(y: number, mo: number, d: number): number {
  const t = new Date(Date.UTC(y, mo - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / 86_400_000 + 1) / 7);
}

/**
 * The first time strictly after `after` (ms) that the cron names, in `tz`, within `horizonDays`.
 * Null when there is none (an impossible date such as 31 February).
 */
export function nextCron(c: Cron, tz: string, after: number, horizonDays = 400, everyWeeks = 1): number | null {
  const start = zoned(after, tz);
  const hours = [...c.hour].sort((a, b) => a - b), minutes = [...c.minute].sort((a, b) => a - b);
  for (let k = 0; k <= horizonDays; k++) {
    // Calendar day k after the start day, in the zone's own calendar.
    const day = new Date(Date.UTC(start.y, start.mo - 1, start.d + k));
    const y = day.getUTCFullYear(), mo = day.getUTCMonth() + 1, d = day.getUTCDate(), dow = day.getUTCDay();
    if (!c.month.has(mo)) continue;
    const domOk = c.dom.has(d), dowOk = c.dow.has(dow);
    if (c.either ? !(domOk || dowOk) : !(domOk && dowOk)) continue;
    if (everyWeeks > 1 && isoWeek(y, mo, d) % everyWeeks !== 0) continue;
    for (const h of hours) {
      if (k === 0 && h < start.h) continue;
      for (const mi of minutes) {
        const t = fromZoned(y, mo, d, h, mi, tz);
        if (t > after) {
          // A spring-forward gap moves the time; keep it only if it still reads as this hour.
          const z = zoned(t, tz);
          if (z.h === h && z.mi === mi) return t;
        }
      }
    }
  }
  return null;
}

/** The latest time at or before `at` the cron names, looking back at most `windowMs`. */
export function previousCron(c: Cron, tz: string, at: number, windowMs: number, everyWeeks = 1): number | null {
  let best: number | null = null;
  const days = Math.ceil(windowMs / 86_400_000) + 1;
  let t = nextCron(c, tz, at - windowMs - 1, days, everyWeeks);
  while (t !== null && t <= at) {
    best = t;
    t = nextCron(c, tz, t, days, everyWeeks);
  }
  return best;
}
