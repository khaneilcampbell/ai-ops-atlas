// The AI usage command center: which workflows use the most, and where they could use less.
// Pure functions over the same records the rest of the API Usage tab totals, so every number is
// testable. Nothing here calls a model or a provider; the advice is fixed rules, not AI.
import { cost, groupRows, type UsageRecord } from "./model";

export interface ModelShare {
  model: string;
  requests: number;
  tokens: number;
  costUsd: number;
}

export interface WorkflowRow {
  key: string;
  providers: string[];
  requests: number;
  records: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  costUsd: number;
  unpriced: number;
  /** Share of all known cost in the window, 0..1. */
  costShare: number;
  /** Share of all tokens in the window, 0..1. */
  tokenShare: number;
  /** Cached prompt tokens read ÷ all prompt tokens, 0..1, or null when no prompt tokens were sent. */
  cacheHitRate: number | null;
  inputPerRequest: number;
  outputPerRequest: number;
  costPerRequest: number | null;
  models: ModelShare[];
  last: string;
}

/** Total prompt tokens: uncached input plus cache reads and writes. */
const promptTokens = (r: { input: number; cacheRead: number; cacheWrite: number }) => r.input + r.cacheRead + r.cacheWrite;

export function cacheHitRate(r: { input: number; cacheRead: number; cacheWrite: number }): number | null {
  const p = promptTokens(r);
  return p > 0 ? r.cacheRead / p : null;
}

const allTokens = (r: { input: number; output: number; cacheRead: number; cacheWrite: number }) => r.input + r.output + r.cacheRead + r.cacheWrite;

export function modelMix(records: UsageRecord[]): ModelShare[] {
  return groupRows(records, "model")
    .map((g) => ({ model: g.key, requests: g.requests, tokens: allTokens(g), costUsd: cost(g) }))
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);
}

/** Workflows (agents) ranked by known cost, then by tokens when cost is unknown or equal. */
export function rankWorkflows(records: UsageRecord[]): WorkflowRow[] {
  const groups = groupRows(records, "agent");
  const totalCost = groups.reduce((s, g) => s + cost(g), 0);
  const totalTokens = groups.reduce((s, g) => s + allTokens(g), 0);
  return groups
    .map((g) => {
      const mine = records.filter((r) => r.agent === g.key);
      const tokens = allTokens(g);
      const priced = g.records - g.unpriced;
      return {
        key: g.key,
        providers: g.providers,
        requests: g.requests,
        records: g.records,
        input: g.input,
        output: g.output,
        cacheRead: g.cacheRead,
        cacheWrite: g.cacheWrite,
        tokens,
        costUsd: cost(g),
        unpriced: g.unpriced,
        costShare: totalCost > 0 ? cost(g) / totalCost : 0,
        tokenShare: totalTokens > 0 ? tokens / totalTokens : 0,
        cacheHitRate: cacheHitRate(g),
        inputPerRequest: g.requests ? promptTokens(g) / g.requests : 0,
        outputPerRequest: g.requests ? g.output / g.requests : 0,
        costPerRequest: priced > 0 && g.requests ? cost(g) / g.requests : null,
        models: modelMix(mine),
        last: g.last,
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens || a.key.localeCompare(b.key));
}

// ── Optimization findings ───────────────────────────────────────────────────

export type Impact = "high" | "medium" | "low";

export interface Finding {
  id: string;
  workflow: string | null;
  impact: Impact;
  title: string;
  detail: string;
}

/** Frontier tiers: the most expensive models. KC's rule: Haiku classifies, Sonnet summarises and reviews, Opus writes code. */
export function isFrontier(model: string): boolean {
  const m = model.toLowerCase();
  if (/opus|fable/.test(m)) return true;
  // OpenAI flagship models, but not their mini or nano versions.
  return /^(gpt-5(\.\d+)?|o1|o3|o1-pro|o3-pro)$/.test(m);
}

/** Thresholds, kept together so the tests and the docs can name them. */
export const RULES = {
  /** A frontier model writing this little per call is usually doing a summary, triage or classification. */
  smallOutputTokens: 2_000,
  /** Prompts this large that repeat across calls are worth caching. */
  cacheablePromptTokens: 4_000,
  lowCacheHit: 0.1,
  minRequests: 3,
  /** One workflow above this share of spend deserves a schedule check. */
  concentration: 0.5,
  /** Below this share a finding is low impact. */
  material: 0.15,
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;

function impactFor(share: number): Impact {
  if (share >= 0.4) return "high";
  if (share >= RULES.material) return "medium";
  return "low";
}

/**
 * Where usage could come down. Each finding names the workflow, why it was flagged, and what to try.
 * Rules only: nothing here guesses at a cost it can't see.
 */
export function findings(rows: WorkflowRow[]): Finding[] {
  const out: Finding[] = [];
  const priced = rows.filter((r) => r.costUsd > 0);

  for (const r of rows) {
    const share = r.costShare || r.tokenShare;
    const frontier = r.models.filter((m) => isFrontier(m.model));
    const frontierRequests = frontier.reduce((s, m) => s + m.requests, 0);
    if (frontierRequests > 0 && frontierRequests >= r.requests / 2 && r.outputPerRequest <= RULES.smallOutputTokens) {
      out.push({
        id: `tier:${r.key}`,
        workflow: r.key,
        impact: impactFor(share),
        title: `Try a smaller model for ${r.key}`,
        detail: `${frontier.map((m) => m.model).join(", ")} writes about ${Math.round(r.outputPerRequest).toLocaleString()} tokens per call here, which reads like a summary, triage or classification. Sonnet or Haiku usually handles that for a fraction of the price; keep the frontier model for writing code and critical decisions.`,
      });
    }
    const hit = r.cacheHitRate ?? 0;
    if (r.requests >= RULES.minRequests && r.inputPerRequest >= RULES.cacheablePromptTokens && hit < RULES.lowCacheHit) {
      out.push({
        id: `cache:${r.key}`,
        workflow: r.key,
        impact: impactFor(share),
        title: `Cache the repeated prompt in ${r.key}`,
        detail: `Each call sends about ${Math.round(r.inputPerRequest).toLocaleString()} prompt tokens and only ${pct(hit)} come from the cache. Mark the fixed part (system prompt, instructions, schemas) with cache_control so repeat calls read it from the cache, which is billed at a tenth of the input price.`,
      });
    }
    if (r.unpriced > 0) {
      out.push({
        id: `price:${r.key}`,
        workflow: r.key,
        impact: "low",
        title: `Add a price for ${r.key}`,
        detail: `${r.unpriced} ${r.unpriced === 1 ? "record has" : "records have"} tokens but no cost, so this workflow may rank lower than it should. Add the model's price where the agent is configured, or import billed figures.`,
      });
    }
  }

  const top = priced[0];
  if (top && priced.length > 1 && top.costShare >= RULES.concentration) {
    out.push({
      id: `concentration:${top.key}`,
      workflow: top.key,
      impact: "high",
      title: `${top.key} is ${pct(top.costShare)} of spend`,
      detail: `One workflow dominates the bill. Check how often it runs and whether every run needs the model: skip runs when nothing changed since the last one, and send only what changed.`,
    });
  }

  const order: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
  const shareOf = (f: Finding) => rows.find((r) => r.key === f.workflow)?.costShare ?? 0;
  return out.sort((a, b) => order[a.impact] - order[b.impact] || shareOf(b) - shareOf(a) || a.id.localeCompare(b.id));
}
