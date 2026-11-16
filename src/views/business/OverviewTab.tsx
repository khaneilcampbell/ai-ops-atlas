import { isMissing, type BusinessFilter, type Overview } from "../../business/dashboard";
import { money } from "../../business/revenue";
import { STAGE_LABEL } from "../../business/types";
import { GoalBars } from "./GoalsTab";
import { moneyList, pct, Tile, Value } from "./parts";

export function OverviewTab({ o, filter, go }: { o: Overview; filter: BusinessFilter; go: (t: "goals" | "finance" | "pipeline") => void }) {
  const estimated = !isMissing(o.expenses) && o.expenses.some((e) => e.estimated);
  return (
    <>
      <div className="tiles biz-kpis">
        <Tile label="Net revenue" sub="Cash received, not accounting revenue"><Value m={o.revenue} render={moneyList} /></Tile>
        <Tile label="Expenses" sub={estimated ? "Includes estimates" : "Recorded expenses"}><Value m={o.expenses} render={moneyList} /></Tile>
        <Tile label="Est. operating profit" sub="An estimate, not an accounting result"><Value m={o.profit} render={moneyList} /></Tile>
        <Tile label="Active leads" sub="Open in the pipeline"><Value m={o.activeLeads} render={(n) => n} /></Tile>
        <Tile label="Win rate" sub="Won of won + lost"><Value m={o.winRate} render={pct} /></Tile>
        <Tile label="Products launched" sub="Live page confirmed"><Value m={o.productsLaunched} render={(n) => n} /></Tile>
        <Tile label="Goals" sub="Achieved · on track · at risk"><Value m={o.goalSummary} render={(g) => `${g.achieved} · ${g.onTrack} · ${g.atRisk}`} /></Tile>
      </div>

      <div className="biz-grid">
        <section className="card card-pad">
          <div className="section-head"><div className="section-title">Revenue over time</div><button className="text-btn small" onClick={() => go("finance")}>Revenue & costs</button></div>
          {o.revenueByMonth.length ? <RevenueBars rows={o.revenueByMonth} /> : <p className="muted small">No sales recorded {filter.provenance === "test" ? "in the test data" : "yet"}.</p>}
        </section>
        <section className="card card-pad">
          <div className="section-head"><div className="section-title">Pipeline</div><button className="text-btn small" onClick={() => go("pipeline")}>Leads & customers</button></div>
          {o.conversion.total ? (
            <ol className="biz-funnel">
              {o.conversion.stages.map((s) => (
                <li key={s.stage}><span>{STAGE_LABEL[s.stage]}</span><span className="bar" style={{ width: `${Math.max(4, (s.reached / o.conversion.total) * 100)}%` }} /><b>{s.reached}</b><small className="muted">{s.current} now</small></li>
              ))}
            </ol>
          ) : <p className="muted small">No leads recorded yet.</p>}
        </section>
      </div>

      <section className="card card-pad">
        <div className="section-head"><div className="section-title">Goal progress</div><button className="text-btn small" onClick={() => go("goals")}>All goals</button></div>
        {o.goals.length ? o.goals.slice(0, 5).map(({ goal, progress }) => <GoalBars key={goal.id} goal={goal} p={progress} compact />) : <p className="muted small">No goals set yet. Add one on the Goals tab.</p>}
      </section>

      <section className="card card-pad">
        <div className="section-title">Revenue by product</div>
        {o.revenueByProduct.length ? (
          <table className="table compact">
            <thead><tr><th>Product</th><th>Orders</th><th>Net revenue</th><th>Product costs</th><th>Contribution</th></tr></thead>
            <tbody>{o.revenueByProduct.map((r) => <tr key={`${r.productRef}-${r.currency}`}><td>{r.title}</td><td>{r.orders}</td><td>{money(r.netRevenueCents, r.currency)}</td><td>{money(r.costCents, r.currency)}</td><td>{money(r.netRevenueCents - r.costCents, r.currency)}</td></tr>)}</tbody>
          </table>
        ) : <p className="muted small">No product sales in this period.</p>}
      </section>
    </>
  );
}

export function RevenueBars({ rows }: { rows: { month: string; currency: string; cents: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const currencies = [...new Set(rows.map((r) => r.currency))];
  return (
    <div className="biz-bars" role="img" aria-label="Net revenue by month">
      {currencies.map((c) => (
        <div key={c} className="biz-bar-row">
          {rows.filter((r) => r.currency === c).map((r) => (
            <div key={r.month} className="biz-bar" title={`${r.month}: ${money(r.cents, c)}`}>
              <span style={{ height: `${Math.max(2, (Math.max(0, r.cents) / max) * 100)}%` }} />
              <small>{r.month.slice(5)}</small>
            </div>
          ))}
          <small className="muted">{c}</small>
        </div>
      ))}
    </div>
  );
}
