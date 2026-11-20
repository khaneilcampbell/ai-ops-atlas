import { useMemo } from "react";
import { useAtlas } from "../state";
import { useIntel } from "../intel/state";
import { rollup, usd } from "../intel/format";
import { relative, resetsIn } from "../lib/time";

/** GitHub reports what is left; people read a full bar as nearly maxed out, so show what was used. */
const used = (r: { limit: number; remaining: number }) => Math.max(0, r.limit - r.remaining);

/** GitHub API budget and this month's model API spend. Shown in Mission Control and on API Usage. */
export function ApiBudgets() {
  const { usage, setView } = useAtlas();
  const intel = useIntel();
  const intelRuns = intel.status?.runs;
  const spend = useMemo(() => (intelRuns ? rollup(intelRuns) : null), [intelRuns]);
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="grow">API usage and cost</h2>
      </div>
      <div className="api-rows">
        <div className="api-row">
          <div className="grow">
            <div className="title">GitHub API</div>
            <div className="meta">{usage?.rate ? `Hourly limit · ${resetsIn(usage.rate.reset)}` : "Budget appears after the first refresh"}</div>
          </div>
          {usage?.rate ? (
            <div className="api-num">
              {used(usage.rate).toLocaleString()}
              <span className="muted"> used of {usage.rate.limit.toLocaleString()}</span>
            </div>
          ) : (
            <span className="na">Not available</span>
          )}
        </div>
        {usage?.rate && (
          <div className="meter" role="img" aria-label={`${used(usage.rate)} of ${usage.rate.limit} GitHub requests used this hour`}>
            <i style={{ width: `${Math.min(100, Math.round((used(usage.rate) / Math.max(1, usage.rate.limit)) * 100))}%` }} />
          </div>
        )}
        {usage && (
          <div className="meta small muted">
            Last refresh {relative(usage.at)}: {usage.requests} requests, {usage.counted} counted against the budget
          </div>
        )}
        <div className="api-row">
          <div className="grow">
            <div className="title">Model API spend this month</div>
            <div className="meta">
              {intel.status
                ? `Repository intelligence · ${spend?.runsWithCost ?? 0} priced runs · estimated from reported tokens`
                : "Appears once repository intelligence has run in the desktop app."}
            </div>
          </div>
          {intel.status ? (
            <button className="api-num text-btn" onClick={() => setView("intel")} title="Open Intel">
              {usd(intel.status.month_spent_usd, 2)}
              {intel.status.config.monthly_budget_usd > 0 && <span className="muted"> / {usd(intel.status.config.monthly_budget_usd, 0)}</span>}
            </button>
          ) : (
            <span className="na">Not available</span>
          )}
        </div>
        {intel.status && intel.status.config.monthly_budget_usd > 0 && (
          <div
            className="meter"
            role="img"
            aria-label={`${usd(intel.status.month_spent_usd, 2)} of ${usd(intel.status.config.monthly_budget_usd, 0)} monthly model budget used`}
          >
            <i style={{ width: `${Math.min(100, Math.round((intel.status.month_spent_usd / intel.status.config.monthly_budget_usd) * 100))}%`, background: "var(--gold)" }} />
          </div>
        )}
      </div>
    </section>
  );
}
