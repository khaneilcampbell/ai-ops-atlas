import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import { useAtlas } from "../../state";
import { taskService, useTasks } from "../../tasks/store";
import { KHANEIL, type SensitiveCategory } from "../../tasks/types";
import { useRuns } from "../../workflows/runs";
import { advise, evidenceBrief, type Recommendation } from "../../business/advisor";
import type { BusinessFilter } from "../../business/dashboard";
import type { BusinessData } from "../../business/types";
import { Empty } from "./parts";

const CATEGORIES: Partial<Record<Recommendation["area"], SensitiveCategory[]>> = {
  follow_up: ["customer_message"],
  expenses: ["financial"],
  marketing: ["financial"],
  products: ["production_deploy"],
};
const CERTAINTY = { low: "Low certainty", medium: "Medium certainty", high: "High certainty" } as const;

export function AdvisorTab({ data, filter }: { data: BusinessData; filter: BusinessFilter }) {
  const tasks = useTasks();
  const runs = useRuns();
  const { setView } = useAtlas();
  const recs = useMemo(() => advise(data, tasks, runs, filter), [data, tasks, runs, filter]);
  const [note, setNote] = useState<string | null>(null);
  const existing = new Set(tasks.map((t) => t.intakeKey).filter(Boolean));
  const keyOf = (r: Recommendation) => `business-advisor:${r.key}`;

  const createTask = (r: Recommendation) => {
    const cats = CATEGORIES[r.area] ?? [];
    const res = taskService().create(
      {
        title: r.title.slice(0, 160),
        description: [`Next step: ${r.nextAction}`, `Evidence: ${r.evidence.join("; ")}`, `Period: ${r.period.from} to ${r.period.to}`, `Assumptions: ${r.assumptions.join("; ")}`, `Certainty: ${r.certainty} (${r.uncertainty})`, `Approval: ${r.approval}`].join("\n"),
        objective: r.impact,
        priority: r.area === "goals" || r.area === "follow_up" ? "high" : "medium",
        source: "system",
        buildingId: "benjaire-site",
        buildingName: "Business Operations HQ",
        requiresApproval: cats.length > 0,
        categories: cats,
        intakeKey: keyOf(r),
      },
      KHANEIL,
    );
    setNote(res.ok ? `Task created: ${r.title}` : res.error);
  };
  const review = () => {
    const todo = recs.filter((r) => !existing.has(keyOf(r)));
    todo.forEach(createTask);
    setNote(todo.length ? `Business review: ${todo.length} follow-up task${todo.length === 1 ? "" : "s"} created in the Task Center.` : "Business review: every finding already has a task.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(evidenceBrief(recs, filter));
      setNote("Evidence brief copied. It has no personal details.");
    } catch {
      setNote("Couldn't copy here.");
    }
  };

  return (
    <>
      <div className="biz-actions-row">
        <p className="muted small">Advice comes from fixed rules over your records, so it can't invent a figure and costs nothing to run. Each finding shows its evidence, dates, assumptions and certainty. Nothing is changed for you: a task is created only when you ask, and the Task Center's approval rules apply.</p>
        <div className="task-actions">
          <button className="btn primary" onClick={review} disabled={!recs.length}><Icon name="tasks" size={14} /> Run business review</button>
          <button className="btn" onClick={copy} disabled={!recs.length}><Icon name="copy" size={14} /> Copy evidence brief</button>
        </div>
      </div>
      {note && <div className="task-callout good" role="status"><span>{note}</span>{note.startsWith("Task") || note.startsWith("Business review:") ? <button className="text-btn small" onClick={() => setView("tasks")}>Open Task Center</button> : null}</div>}
      {filter.provenance === "test" && <div className="task-callout warn"><b>Advice on test data</b><span>These findings come from test records and say nothing about the real business.</span></div>}
      {recs.length ? recs.map((r) => (
        <article key={r.key} className="card card-pad biz-rec">
          <div className="biz-goal-head"><b>{r.title}</b><span className="chip">{CERTAINTY[r.certainty]}</span><span className="muted small">{r.period.from} to {r.period.to}</span></div>
          <div className="biz-rec-grid">
            <div><div className="eyebrow">Supporting data</div><ul>{r.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
            <div><div className="eyebrow">Assumptions</div><ul>{r.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul><div className="eyebrow">Uncertainty</div><p className="small">{r.uncertainty}</p></div>
            <div><div className="eyebrow">Expected impact</div><p className="small">{r.impact}</p><div className="eyebrow">Next step</div><p className="small">{r.nextAction}</p><div className="eyebrow">Approval</div><p className="small">{r.approval}</p></div>
          </div>
          <div className="task-actions">{existing.has(keyOf(r)) ? <span className="muted small">Task already created</span> : <button className="btn" onClick={() => createTask(r)}>Create task</button>}</div>
        </article>
      )) : <Empty title="No findings for this period"><p className="muted">The advisor needs enough records to say something useful (for example three leads at a stage before it comments on a conversion rate).</p></Empty>}
    </>
  );
}
