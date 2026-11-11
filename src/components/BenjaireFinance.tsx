import { useMemo } from "react";
import { buildingFinance, datasetState, FINANCE_BUSINESS, FINANCE_STATUS_LABEL, type BuildingFinance, type FeedSnapshot } from "../finance/benjaire";
import { capStatus, SPEND_CAPS } from "../finance/caps";
import { useIntel } from "../intel/state";
import { useUsageData } from "../usage/data";
import { relative } from "../lib/time";

/**
 * The "Benjaire finance" section of a Financial District building: the data sets the building
 * holds for Benjaire (catalog/workspace/finance.yaml), each with its status, source and as-of date.
 * Everything is Not connected until real data exists; only feeds Atlas already has can show Live.
 */
export function BenjaireFinance({ building }: { building: string }) {
  const plan = buildingFinance(building);
  if (!plan) return null;
  return plan.datasets.some((d) => d.feed) ? <WithFeeds plan={plan} /> : <FinanceList plan={plan} feeds={{}} />;
}

/** Reads the existing usage and spend-cap feeds, only for buildings that have a data set served by one. */
function WithFeeds({ plan }: { plan: BuildingFinance }) {
  const intel = useIntel();
  const usage = useUsageData({ push: false });
  const budget = intel.status?.config ? { month: intel.status.month_spent_usd, budget: intel.status.config.monthly_budget_usd } : null;
  const feeds = useMemo<FeedSnapshot>(() => {
    const priced = usage.records.filter((r) => r.costUsd !== null);
    const latest = priced.reduce<string | null>((a, r) => (!a || r.at > a ? r.at : a), null);
    const capsSeen = SPEND_CAPS.map((c) => capStatus(c, usage.records, budget)).some((s) => s.state !== "unseen");
    return { "ai-spend": priced.length ? { asOf: latest } : null, "spend-caps": capsSeen ? { asOf: usage.updatedAt ?? latest } : null };
  }, [usage.records, usage.updatedAt, budget?.month, budget?.budget]); // eslint-disable-line react-hooks/exhaustive-deps
  return <FinanceList plan={plan} feeds={feeds} loading={usage.firstLoad} />;
}

export function FinanceList({ plan, feeds, loading = false }: { plan: BuildingFinance; feeds: FeedSnapshot; loading?: boolean }) {
  const rows = plan.datasets.map((d) => datasetState(d, feeds));
  const connected = rows.filter((r) => r.status !== "not-connected").length;
  return (
    <section className="benjaire-finance" aria-label={`${FINANCE_BUSINESS} finance`}>
      <div className="section-title">{FINANCE_BUSINESS} finance</div>
      <p className="muted small">{plan.focus} · {connected ? `${connected} of ${rows.length} data sets have data` : `${rows.length} data sets, none connected yet`}</p>
      <ul className="finance-datasets">
        {rows.map((r) => (
          <li key={r.dataset.id} data-status={r.status}>
            <div className="finance-row">
              <strong>{r.dataset.label}</strong>
              <span className={`chip finance-status ${r.status}`}>{loading && r.dataset.feed && r.status === "not-connected" ? "Loading" : FINANCE_STATUS_LABEL[r.status]}</span>
            </div>
            <div className="muted small">{r.dataset.holds}</div>
            <div className="muted small">
              {r.status === "not-connected"
                ? `No data yet · Can come from ${r.dataset.sources.join(" or ")}`
                : `From ${r.source}${r.asOf ? ` · As of ${relative(r.asOf)}` : ""}`}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
