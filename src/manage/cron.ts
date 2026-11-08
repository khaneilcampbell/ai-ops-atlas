// GitHub Actions schedules: five-field cron in UTC. Only the plain numeric form is accepted
// (no month or day names, no @hourly shortcuts), so what Atlas shows, checks and later writes
// is exactly what GitHub runs.

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  /** Day of month and day of week are both restricted: GitHub fires when either matches. */
  domRestricted: boolean;
  dowRestricted: boolean;
  source: string;
}

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
] as const;

const PART = /^(\*|\d{1,2}(?:-\d{1,2})?)(?:\/(\d{1,2}))?$/;

function field(text: string, f: (typeof FIELDS)[number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const m = PART.exec(part);
    if (!m) throw new Error(`"${part}" isn't a valid ${f.name}. Use numbers, *, ranges like 1-5 and steps like */4.`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new Error(`The ${f.name} step must be at least 1.`);
    let lo: number = f.min;
    let hi: number = f.max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] === undefined ? a : f.max);
    }
    if (lo < f.min || hi > f.max || lo > hi) throw new Error(`The ${f.name} must be between ${f.min} and ${f.max}.`);
    for (let v = lo; v <= hi; v += step) out.add(f.name === "day of week" && v === 7 ? 0 : v);
  }
  return out;
}

/** Parses a schedule, or throws an Error whose message says what is wrong in plain words. */
export function parseCron(source: string): Cron {
  const text = source.trim();
  if (text.length > 64) throw new Error("The schedule is too long.");
  const parts = text.split(/\s+/);
  if (parts.length !== 5) throw new Error("A schedule has five parts: minute, hour, day of month, month and day of week.");
  const [minute, hour, dom, month, dow] = parts.map((p, i) => field(p, FIELDS[i]));
  return { minute, hour, dom, month, dow, domRestricted: parts[2] !== "*", dowRestricted: parts[4] !== "*", source: parts.join(" ") };
}

function dayMatches(c: Cron, d: Date): boolean {
  if (!c.month.has(d.getUTCMonth() + 1)) return false;
  const dom = c.dom.has(d.getUTCDate());
  const dow = c.dow.has(d.getUTCDay());
  if (c.domRestricted && c.dowRestricted) return dom || dow;
  return dom && dow;
}

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;

/** Fire times from `from` (inclusive, rounded up to the minute) until `until`, at most `limit`. */
export function fireTimes(c: Cron, from: number, until: number, limit = Infinity): number[] {
  const out: number[] = [];
  const hours = [...c.hour].sort((a, b) => a - b);
  const minutes = [...c.minute].sort((a, b) => a - b);
  const start = Math.ceil(from / MINUTE) * MINUTE;
  for (let day = Math.floor(start / DAY) * DAY; day < until && out.length < limit; day += DAY) {
    if (!dayMatches(c, new Date(day))) continue;
    for (const h of hours)
      for (const m of minutes) {
        const t = day + (h * 60 + m) * MINUTE;
        if (t >= start && t < until && out.length < limit) out.push(t);
      }
  }
  return out;
}

/** The next time the schedule fires after `now`, looking up to a year ahead. */
export function nextRun(c: Cron, now: number): number | null {
  return fireTimes(c, now + 1, now + 366 * DAY, 1)[0] ?? null;
}

/**
 * The shortest gap, in minutes, between two runs over a full year, including the wrap from
 * one day or week into the next. Null when the schedule never fires (for example 31 February).
 */
export function minIntervalMinutes(c: Cron, from = Date.UTC(2027, 0, 1)): number | null {
  const times = fireTimes(c, from, from + 366 * DAY + DAY);
  if (times.length === 0) return null;
  if (times.length === 1) return 366 * 1440;
  let gap = Infinity;
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i] - times[i - 1]);
  return gap / MINUTE;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The schedule in plain words, for example "Every 4 hours at :23 UTC" or "Mon and Thu at 13:41 UTC". */
export function describeCron(source: string): string {
  let c: Cron;
  try {
    c = parseCron(source);
  } catch {
    return `Schedule "${source}" (not understood)`;
  }
  const [m, h, dom, month, dow] = c.source.split(" ");
  const everyDay = dom === "*" && month === "*";
  const stepMin = /^\*\/(\d+)$/.exec(m);
  if (stepMin && h === "*" && everyDay && dow === "*") return Number(stepMin[1]) === 1 ? "Every minute" : `Every ${stepMin[1]} minutes`;
  if (/^\d+$/.test(m) && h === "*" && everyDay && dow === "*") return `Every hour at :${pad(Number(m))} UTC`;
  const stepHour = /^\*\/(\d+)$/.exec(h);
  if (/^\d+$/.test(m) && stepHour && everyDay && dow === "*") return `Every ${stepHour[1]} hours at :${pad(Number(m))} UTC`;
  if (c.minute.size === 1 && c.hour.size === 1 && everyDay) {
    const at = `${pad([...c.hour][0])}:${pad([...c.minute][0])} UTC`;
    if (dow === "*") return `Daily at ${at}`;
    const days = [...c.dow].sort((a, b) => a - b);
    if (days.join() === "1,2,3,4,5") return `Weekdays at ${at}`;
    return `${list(days.map((d) => DAY_NAMES[d]))} at ${at}`;
  }
  return `Cron ${c.source} (UTC)`;
}
