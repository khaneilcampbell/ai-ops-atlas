import { useAtlas } from "../../state";
import { useTasks } from "../../tasks/store";
import type { StoredTask } from "../../tasks/types";
import { useRuns } from "../../workflows/runs";
import { goalProgress, goalsForRun } from "../../business/goals";
import { useBusiness } from "../../business/store";
import { focusBusinessTab } from "../../business/focus";
import { fmtMetric } from "./GoalsTab";

/**
 * Business outcome of a live workflow step (Workflow Intelligence inspector): the goals this run
 * counts toward with their real metric, products and lead or order references in the goals'
 * evidence, and the step's execution cost. Read-only; it never changes the workflow.
 */
export function NodeBusiness({ runId, task }: { runId: string; task: StoredTask | undefined }) {
  const data = useBusiness();
  const tasks = useTasks();
  const runs = useRuns();
  const { setView } = useAtlas();
  const goals = goalsForRun(data.goals, runId);
  const cost = task?.usage.reduce((n, u) => n + (u.cost?.usd ?? 0), 0) ?? 0;
  const estimated = task?.usage.some((u) => u.cost?.basis === "estimated");
  const refs = goals.flatMap((g) => g.evidence.filter((e) => e.kind === "sale" || e.kind === "lead" || e.kind === "product"));
  return (
    <div className="wf-insp-live biz-node">
      <div className="section-title">Business outcome</div>
      <div className="muted small">Execution cost: {task?.usage.length ? `$${cost.toFixed(4)}${estimated ? " (estimated)" : ""}` : "none reported"}</div>
      {goals.length ? (
        goals.map((g) => {
          const p = goalProgress(g, { data, tasks, runs });
          return (
            <div key={g.id} className="wf-insp-row">
              <span>
                <b>{g.title}</b> · {fmtMetric(g, p.current)} of {fmtMetric(g, g.target)} · {p.met ? "target met" : "not met yet"}
              </span>
              <button className="btn small" onClick={() => { focusBusinessTab("goals"); setView("business"); }}>Open goal</button>
            </div>
          );
        })
      ) : (
        <div className="muted small">This run isn't linked to a business goal. Link it from a goal in Business.</div>
      )}
      {refs.length > 0 && <div className="muted small">Evidence: {refs.map((e) => `${e.kind} ${e.ref}`).join(", ")}</div>}
      <div className="muted small">A finished step is work done; the goal's metric shows whether the business result happened.</div>
    </div>
  );
}
