import { useMemo } from "react";
import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import { useRuns } from "../../workflows/runs";
import { scoped, type BusinessFilter } from "../../business/dashboard";
import { agentImpact } from "../../business/impact";
import { money } from "../../business/revenue";
import type { BusinessData } from "../../business/types";
import { Empty, pct } from "./parts";

const cur = (m: Record<string, number>) => Object.entries(m).map(([c, n]) => money(n, c)).join(" · ");

export function ImpactTab({ data, filter }: { data: BusinessData; filter: BusinessFilter }) {
  const tasks = useTasks();
  const runs = useRuns();
  const { catalog } = useAtlas();
  const names = useMemo(() => new Map(catalog.agents.map((a) => [a.id, a.name])), [catalog.agents]);
  const rows = useMemo(() => agentImpact(scoped(data, { ...filter, product: "", area: "" }), tasks, runs, names), [data, filter, tasks, runs, names]);
  return (
    <>
      <p className="muted small">What each agent did in the Task Center, and the business results tied to it. Direct means the agent's own output closed a sale, with evidence recorded on the sale. Assisted means it worked the lead or the sale. Atlas has no attribution model, so it never estimates an agent's share of revenue. Time saved isn't measured: tasks don't record how long the work would take by hand.</p>
      {rows.length ? (
        <section className="card biz-table-card">
          <table className="table compact">
            <thead><tr><th>Agent</th><th>Tasks done</th><th>Reliability</th><th>Manual review</th><th>AI cost</th><th>Workflow runs</th><th>Direct</th><th>Assisted</th><th>Research approved</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.agentId}>
                <td>{r.agentName}</td>
                <td>{r.tasksCompleted}{r.tasksFailed ? <span className="muted small"> · {r.tasksFailed} failed</span> : null}</td>
                <td>{r.reliability === null ? <span className="na">No finished tasks</span> : pct(r.reliability)}</td>
                <td>{r.manualReviewRate === null ? <span className="na">—</span> : pct(r.manualReviewRate)}</td>
                <td>{r.aiCostUsd ? `$${r.aiCostUsd.toFixed(2)}${r.aiCostEstimated ? " est." : ""}` : "None reported"}</td>
                <td>{r.workflowRuns}</td>
                <td>{r.direct.sales ? `${r.direct.sales} · ${cur(r.direct.byCurrency)}` : "None"}</td>
                <td>{r.assisted.sales || r.assisted.wonLeads ? `${r.assisted.sales} sales · ${r.assisted.wonLeads} won leads` : "None"}</td>
                <td>{r.researchTotal === null ? "—" : `${r.researchApproved} of ${r.researchTotal}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      ) : <Empty title="No agent activity yet"><p className="muted">Agents show here once they have Task Center tasks, worked leads, attributed sales, or research picks.</p></Empty>}
      <p className="muted small">Customer response quality isn't measured yet: it needs a reviewed rating on each reply.</p>
    </>
  );
}
