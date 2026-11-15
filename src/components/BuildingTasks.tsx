import { useMemo } from "react";
import { useAtlas } from "../state";
import { focusTasks } from "../tasks/focus";
import { OPEN } from "../tasks/lifecycle";
import { buildingSummary } from "../tasks/select";
import { useTasks } from "../tasks/store";
import { relative } from "../lib/time";
import { Icon } from "./Icon";

/**
 * A building's (or an agent's) tasks in the inspector: open, running, blocked and failed counts,
 * the latest change, and a link into the Task Center filtered to it. Reads the task store only;
 * nothing is drawn on the 3D map, so it costs no frame time.
 */
export function BuildingTasks({ buildingId, agentId }: { buildingId?: string; agentId?: string }) {
  const tasks = useTasks();
  const { setView, select } = useAtlas();
  const s = useMemo(() => {
    if (buildingId) return buildingSummary(tasks, buildingId);
    const mine = tasks.filter((t) => t.agentId === agentId);
    return buildingSummary(mine.map((t) => ({ ...t, buildingId: "_" })), "_");
  }, [tasks, buildingId, agentId]);
  const open = () => {
    focusTasks(buildingId ? { building: buildingId } : { agent: agentId ?? "" });
    select(null);
    setView("tasks");
  };
  const any = s.lastActivity !== null;
  const hasOpen = tasks.some((t) => (buildingId ? t.buildingId === buildingId : t.agentId === agentId) && OPEN.has(t.status));
  return (
    <section className="building-tasks">
      <div className="section-head">
        <div className="section-title">Tasks</div>
        <button className="text-btn small" onClick={open}>
          <Icon name="tasks" size={13} /> Open in Task Center
        </button>
      </div>
      {any ? (
        <>
          <div className="building-task-counts">
            <span className="chip">{s.assigned} open</span>
            <span className={`chip${s.running ? " chip-good" : ""}`}>{s.running} running</span>
            <span className={`chip${s.blocked ? " chip-warn" : ""}`}>{s.blocked} blocked or waiting</span>
            <span className={`chip${s.failed ? " chip-bad" : ""}`}>{s.failed} failed</span>
          </div>
          <div className="muted small">{hasOpen ? "Latest change" : "No open tasks · last change"} {relative(s.lastActivity)}</div>
        </>
      ) : (
        <div className="muted small">No tasks {buildingId ? "in this building" : "for this agent"} yet.</div>
      )}
    </section>
  );
}
