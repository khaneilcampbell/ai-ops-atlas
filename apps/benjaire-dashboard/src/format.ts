// Display formatting. Times show in New York, where Benjaire is based.

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const count = new Intl.NumberFormat('en-US');

export const money = (cents: number) => usd.format(cents / 100);
export const number = (n: number) => count.format(n);

export function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(iso));
}

export function date(isoDate: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`));
}

export function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

/** "▲ 12.5% vs Sep" style comparison. Direction is shown with text, never color alone. */
export function delta(current: number, previous: number, label: string): string {
  if (previous === 0) return current === 0 ? `No change vs ${label}` : `New vs ${label}`;
  const pct = ((current - previous) / previous) * 100;
  if (Math.abs(pct) < 0.05) return `No change vs ${label}`;
  return `${pct > 0 ? '▲ up' : '▼ down'} ${Math.abs(pct).toFixed(1)}% vs ${label}`;
}

export const STATE_LABEL: Record<string, string> = {
  live: 'Live',
  delayed: 'Delayed',
  estimated: 'Estimated',
  manual: 'Manual',
  not_connected: 'Not connected',
  awaiting_sync: 'Awaiting first sync',
  failing: 'Failing',
  empty: 'No entries yet',
};
