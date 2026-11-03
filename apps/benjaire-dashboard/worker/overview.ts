// Executive overview tiles. Pure: takes connection states and finance
// figures, returns tiles. Until a source has synced, its tiles carry no
// value at all, never a placeholder number (ADR-0005 §5).
import type { ConnectionState, ConnectionStatus, SourceKey } from './sources';

export type TileState = ConnectionState | 'manual' | 'empty';

export interface Tile {
  key: string;
  label: string;
  unit: 'count' | 'usd_cents' | 'percent' | 'health';
  source: string;
  state: TileState;
  value: number | null;
  previous: number | null;
  note: string;
  href: string;
}

const TILES: { key: string; label: string; unit: Tile['unit']; source: SourceKey; detail: string; href: string }[] = [
  { key: 'visitors', label: 'Website visitors', unit: 'count', source: 'cloudflare', detail: 'Cloudflare Web Analytics, sampled', href: '/website' },
  { key: 'net_revenue', label: 'Net revenue', unit: 'usd_cents', source: 'stripe', detail: 'Stripe balance transactions, after fees and refunds', href: '/products' },
  { key: 'downloads', label: 'Product downloads', unit: 'count', source: 'n8n', detail: 'shop_orders via the n8n Ops feed', href: '/products' },
  { key: 'inquiries', label: 'Customer inquiries', unit: 'count', source: 'n8n', detail: 'Benjaire Flow intake via the n8n Ops feed', href: '/inquiries' },
  { key: 'conversion', label: 'Flow page conversion', unit: 'percent', source: 'stripe', detail: 'Completed checkouts ÷ /digital/flow visits, estimated', href: '/products' },
  { key: 'workflows', label: 'Active workflows', unit: 'count', source: 'n8n', detail: 'n8n Ops feed', href: '/automations' },
  { key: 'health', label: 'Infrastructure health', unit: 'health', source: 'cloudflare', detail: 'Synthetic checks, latest build, 5xx rate, Worker errors', href: '/infrastructure' },
];

export function buildTiles(
  connections: Map<SourceKey, ConnectionStatus>,
  expenses: { current: number; previous: number; hasEntries: boolean },
): Tile[] {
  const tiles: Tile[] = TILES.map((t) => {
    const state = connections.get(t.source)?.state ?? 'not_connected';
    return {
      key: t.key,
      label: t.label,
      unit: t.unit,
      source: t.detail,
      state,
      value: null,
      previous: null,
      note: state === 'not_connected' ? `Connect ${connections.get(t.source)?.name ?? t.source} to see this.` : 'Collector arrives in a later step.',
      href: t.href,
    };
  });
  tiles.push({
    key: 'expenses',
    label: 'Monthly operating expenses',
    unit: 'usd_cents',
    source: 'Manual entries, cost recognised this month',
    state: expenses.hasEntries ? 'manual' : 'empty',
    value: expenses.hasEntries ? expenses.current : null,
    previous: expenses.hasEntries ? expenses.previous : null,
    note: expenses.hasEntries ? 'Compared with last month.' : 'Add your first expense in Finance.',
    href: '/finance',
  });
  return tiles;
}
