import type { UsageRecord } from "../usage/model";

// The spend caps this workspace has set, and how much of each Atlas has seen used this month.
// Provider caps are set on the provider's own page; Atlas only reads usage it already logs, so for
// those it shows a lower bound and links to the page that has the full figure. Atlas's own agent
// budget is the one Atlas enforces, so its figure is exact.

export interface SpendCap {
  id: string;
  label: string;
  /** What the cap covers, in plain words. */
  covers: string;
  /** Monthly limit in USD; null when it comes from settings that aren't loaded here. */
  limitUsd: number | null;
  /** Where the cap is set and the full spend is shown: a web page, or Atlas's own Settings. */
  where: { label: string; url: string } | { label: string; view: "settings" };
  /**
   * How Atlas measures spend against it. "atlas-budget": the repository intelligence agent's own
   * month-to-date total. "provider": priced usage records for that provider (a lower bound).
   * "none": the spend happens where Atlas can't see it.
   */
  measure: { kind: "atlas-budget" } | { kind: "provider"; provider: string } | { kind: "none"; reason: string };
}

const ANTHROPIC_LIMITS = "https://platform.claude.com/settings/limits";

export const SPEND_CAPS: readonly SpendCap[] = [
  {
    id: "atlas-intel",
    label: "Atlas agents",
    covers: "Repository intelligence and the Senior Engineering Reviewer, run from this Mac",
    limitUsd: null,
    where: { label: "Atlas Settings", view: "settings" },
    measure: { kind: "atlas-budget" },
  },
  {
    id: "anthropic-org",
    label: "Anthropic organization",
    covers: "Every Claude API key in the organization",
    limitUsd: 20,
    where: { label: "Claude Console limits", url: ANTHROPIC_LIMITS },
    measure: { kind: "provider", provider: "anthropic" },
  },
  {
    id: "anthropic-benjaire-flow",
    label: "Anthropic benjaire-flow workspace",
    covers: "The n8n Flow intake key",
    limitUsd: 5,
    where: { label: "Claude Console workspaces", url: "https://platform.claude.com/settings/workspaces" },
    measure: { kind: "none", reason: "n8n makes these calls, and n8n doesn't report token use to Atlas" },
  },
];

export type CapState = "ok" | "near" | "over" | "unseen";

export interface CapStatus {
  cap: SpendCap;
  limitUsd: number | null;
  /** Spend Atlas has seen this calendar month (UTC); null when it can't see this spend. */
  spentUsd: number | null;
  /** True when spentUsd covers every call under the cap, false when it is a lower bound. */
  exact: boolean;
  share: number | null;
  state: CapState;
}

/** Share of a cap at which it shows as nearly used. */
export const NEAR = 0.8;

const monthStart = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

/** Priced, pay-per-use spend for one provider this calendar month. Subscription and local-log usage carries no bill, so it isn't counted. */
export function providerMonthSpend(records: readonly UsageRecord[], provider: string, now = new Date()): number {
  const from = monthStart(now);
  return records
    .filter((r) => r.provider === provider && r.source !== "local" && r.costKind !== "plan" && r.costUsd !== null && Date.parse(r.at) >= from && Date.parse(r.at) <= now.getTime())
    .reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
}

export function capStatus(cap: SpendCap, records: readonly UsageRecord[], atlasBudget: { month: number; budget: number } | null, now = new Date()): CapStatus {
  let spentUsd: number | null = null;
  let limitUsd = cap.limitUsd;
  let exact = false;
  if (cap.measure.kind === "atlas-budget") {
    if (atlasBudget) {
      spentUsd = atlasBudget.month;
      limitUsd = atlasBudget.budget;
      exact = true;
    }
  } else if (cap.measure.kind === "provider") {
    spentUsd = providerMonthSpend(records, cap.measure.provider, now);
  }
  const share = spentUsd !== null && limitUsd ? spentUsd / limitUsd : null;
  const state: CapState = spentUsd === null || limitUsd === null ? "unseen" : share! >= 1 ? "over" : share! >= NEAR ? "near" : "ok";
  return { cap, limitUsd, spentUsd, exact, share, state };
}
