import { describe, expect, it } from "vitest";
import type { UsageRecord } from "../usage/model";
import { capStatus, providerMonthSpend, SPEND_CAPS } from "./caps";

const now = new Date("2026-11-10T12:00:00Z");
const rec = (over: Partial<UsageRecord>): UsageRecord => ({
  id: Math.random().toString(36), at: "2026-11-05T00:00:00Z", provider: "anthropic", model: "m", agent: "a", project: null,
  requests: 1, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 1, costKind: "estimated", source: "atlas", ...over,
});
const cap = (id: string) => SPEND_CAPS.find((c) => c.id === id)!;

describe("spend caps", () => {
  it("counts only this month's priced, pay-per-use calls for the provider", () => {
    const records = [
      rec({ costUsd: 2 }),
      rec({ costUsd: 3, costKind: "billed", source: "agent" }),
      rec({ at: "2026-10-31T23:59:00Z", costUsd: 50 }), // last month
      rec({ costUsd: null }), // unpriced
      rec({ costKind: "plan", costUsd: 9 }), // subscription
      rec({ source: "local", costUsd: 9 }), // Claude Code log
      rec({ provider: "openai", costUsd: 9 }),
    ];
    expect(providerMonthSpend(records, "anthropic", now)).toBe(5);
  });

  it("shows provider spend as a lower bound and flags a nearly used or reached cap", () => {
    const s = capStatus(cap("anthropic-org"), [rec({ costUsd: 4 })], null, now);
    expect(s).toMatchObject({ spentUsd: 4, limitUsd: 20, exact: false, state: "ok" });
    expect(capStatus(cap("anthropic-org"), [rec({ costUsd: 17 })], null, now).state).toBe("near");
    expect(capStatus(cap("anthropic-org"), [rec({ costUsd: 21 })], null, now).state).toBe("over");
  });

  it("never guesses spend it can't see", () => {
    expect(capStatus(cap("anthropic-benjaire-flow"), [rec({ costUsd: 4 })], null, now)).toMatchObject({ spentUsd: null, state: "unseen" });
    expect(capStatus(cap("atlas-intel"), [], null, now)).toMatchObject({ spentUsd: null, limitUsd: null, state: "unseen" });
  });

  it("reads Atlas's own budget exactly from its settings", () => {
    expect(capStatus(cap("atlas-intel"), [], { month: 4.5, budget: 5 }, now)).toMatchObject({ spentUsd: 4.5, limitUsd: 5, exact: true, state: "near" });
  });
});
