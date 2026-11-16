import { useMemo } from "react";
import { useAtlas } from "../state";
import { useTasks } from "../tasks/store";
import { useRuns } from "../workflows/runs";
import { isMissing, overview } from "../business/dashboard";
import { monthOf } from "../business/finance";
import { focusBusinessTab } from "../business/focus";
import { useBusiness } from "../business/store";
import { Icon } from "./Icon";

/**
 * Business Operations HQ's link to the Business view, with this month's headline numbers from real
 * records only. Reads the device store; nothing is drawn on the map.
 */
export function BusinessLink() {
  const data = useBusiness();
  const tasks = useTasks();
  const runs = useRuns();
  const { setView, select } = useAtlas();
  const o = useMemo(() => overview(data, tasks, runs, { period: monthOf(new Date()), product: "", area: "", source: "all", provenance: "real" }), [data, tasks, runs]);
  const open = () => {
    focusBusinessTab("overview");
    select(null);
    setView("business");
  };
  return (
    <section className="business-link">
      <div className="section-head">
        <div className="section-title">Business</div>
        <button className="text-btn small" onClick={open}><Icon name="briefcase" size={13} /> Open Business</button>
      </div>
      <div className="chips">
        <span className="chip">{isMissing(o.activeLeads) ? "No leads yet" : `${o.activeLeads} active leads`}</span>
        <span className="chip">{isMissing(o.revenue) ? "No sales recorded" : `${o.statement.currencies.reduce((n, c) => n + c.orders, 0)} orders this month`}</span>
        <span className="chip">{isMissing(o.goalSummary) ? "No goals set" : `${o.goalSummary.total} goals`}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Goals, leads, products, revenue and costs from records on this device.</p>
    </section>
  );
}
