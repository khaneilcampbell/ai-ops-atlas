import { cost, groupRows, type UsageRecord } from "../usage/model";

// The Model Intelligence Lab's lists: which models the workspace's agents call, and what each
// costs. Built only from the usage records Atlas already has (this Mac's runs, agent reports,
// local Claude Code and Codex logs, imports). Nothing here calls a provider. A model whose price
// isn't configured shows an unknown cost, never $0; subscription usage shows as covered by a plan.

export const WINDOW_DAYS = 30;
const DAY = 86_400_000;

export interface ModelRow {
  model: string;
  providers: string[];
  agents: string[];
  requests: number;
  tokens: number;
  last: string;
  /** Known cost in the window: estimated plus billed. */
  costUsd: number;
  /** Some calls had a cost Atlas can't price. The known cost is then a lower bound. */
  unpriced: number;
  /** Calls covered by a subscription plan: tokens counted, no per-call cost. */
  plan: number;
  /** All of the known cost is the provider's own billed figure. */
  billedOnly: boolean;
  /** Known cost per call, only when every call in the window has a cost. */
  perRequestUsd: number | null;
}

const recent = (records: readonly UsageRecord[], now: number) => records.filter((r) => now - Date.parse(r.at) <= WINDOW_DAYS * DAY && Date.parse(r.at) <= now);

function rows(records: readonly UsageRecord[], now: number): ModelRow[] {
  const inWindow = recent(records, now);
  return groupRows(inWindow, "model").map((g) => {
    const mine = inWindow.filter((r) => (r.model ?? "Unknown model") === g.key);
    const known = cost(g);
    const priced = g.unpriced === 0 && g.plan === 0;
    return {
      model: g.key,
      providers: g.providers,
      agents: [...new Set(mine.map((r) => r.agent))].sort(),
      requests: g.requests,
      tokens: g.input + g.output + g.cacheRead + g.cacheWrite,
      last: g.last,
      costUsd: known,
      unpriced: g.unpriced,
      plan: g.plan,
      billedOnly: g.billedUsd > 0 && g.estimatedUsd === 0,
      perRequestUsd: priced && g.requests > 0 ? known / g.requests : null,
    };
  });
}

/** Every model called in the last 30 days, most recently used first. */
export function modelInventory(records: readonly UsageRecord[], now = Date.now()): ModelRow[] {
  return rows(records, now).sort((a, b) => b.last.localeCompare(a.last) || a.model.localeCompare(b.model));
}

/** The same models, highest known cost first. Models with no known cost go last. */
export function costPerModel(records: readonly UsageRecord[], now = Date.now()): ModelRow[] {
  return rows(records, now).sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests || a.model.localeCompare(b.model));
}
