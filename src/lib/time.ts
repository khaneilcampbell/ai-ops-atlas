const DAY = 86_400_000;

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor((now - t) / DAY);
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "Not recorded";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "Unknown";
  const diff = now - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.round(mo / 12)} y ago`;
}

/** "Resets in 12 min" for a GitHub rate-limit reset given in epoch seconds. */
export function resetsIn(resetSec: number, now = Date.now()): string {
  const min = Math.ceil((resetSec * 1000 - now) / 60_000);
  if (min <= 0) return "Resets at the next refresh";
  if (min < 60) return `Resets in ${min} min`;
  return `Resets in ${Math.round(min / 60)} h`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Not recorded";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
