import { AgentAvatar } from "../../components/AgentIdentity";
import type { ResolvedIdentity } from "../../registry/identity";
import { DEFAULT_TIME_ZONE } from "../../routine/cron";
import { OPERATIONAL_LABEL, RUN_LABEL, type AgentOps, type OpRun } from "../../routine/operations";
import { activityText, clock, type Segment } from "../../routine/routine";
import { floorName, type BuildingModel } from "./buildingModel";

/**
 * The open building's summary, beside the cutaway: which floor is shown and which floors have
 * people on them, every agent assigned here with where it is now (its city activity) and,
 * separately, its real work state, and the runs actually in progress. Same sources as the agent's
 * card: routine/operations.ts for runs, the routine for the walk. A list, so everything in the
 * 3D view can also be read and reached with a keyboard or a screen reader.
 */
export interface InsidePanelAgent {
  personaId: string;
  identity: ResolvedIdentity;
  /** Desk floor and number in this building. */
  level: number;
  desk: number;
  /** Where it is now: inside on a floor (null in the lift), or elsewhere. */
  inside: { level: number | null; seated: boolean } | null;
  seg: Segment | null;
  ops: AgentOps | undefined;
}

export interface InsidePanelProps {
  model: BuildingModel;
  level: number;
  agents: InsidePanelAgent[];
  /** Desks in this building for agents with no character (automations' personas, skills). */
  otherDesks: number;
  now: number;
  source: "live" | "saved" | "none";
  fetchedAt: string | null;
  onLevel(level: number): void;
  onLocate(personaId: string): void;
  onOpenRun(run: OpRun): void;
  onClose(): void;
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function InsidePanel(p: InsidePanelProps) {
  const tz = DEFAULT_TIME_ZONE;
  const levels = [0, ...p.model.officeFloors.map((f) => f.level)];
  const here = (l: number) => p.agents.filter((a) => a.inside?.level === l).length;
  const runs = p.agents.flatMap((a) => (a.ops?.open ?? []).map((r) => ({ r, a })));
  return (
    <section className="m3-agent-profile m3-inside-panel" aria-label={`${p.model.name}, inside`} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" aria-label="Back to city" onClick={p.onClose}>
        ×
      </button>
      <div className="head">
        <div className="n">{p.model.name}</div>
        {p.model.purpose ? <div className="r">{p.model.purpose}</div> : null}
      </div>
      {levels.length > 1 && (
        <div className="floors" role="group" aria-label="Floor">
          {levels.map((l) => {
            const n = here(l);
            return (
              <button key={l} type="button" aria-pressed={l === p.level} className={n ? "occupied" : undefined} onClick={() => p.onLevel(l)} title={n ? `${n} here now` : undefined}>
                {floorName(l)}
                {n ? <span className="dot" aria-label={`${n} here now`}>{n}</span> : null}
              </button>
            );
          })}
        </div>
      )}
      <h4>Agents working here</h4>
      <ul className="people">
        {p.agents.map((a) => {
          const op = a.ops?.state;
          const where = a.inside ? (a.inside.seated ? `At desk ${a.desk}, ${floorName(a.level).toLowerCase()}` : a.inside.level === null ? "In the lift" : `Inside, ${floorName(a.inside.level).toLowerCase()}`) : a.seg ? activityText(a.seg) : "Not placed yet";
          return (
            <li key={a.personaId}>
              <AgentAvatar identity={a.identity} size={28} />
              <div>
                <b>{a.identity.name}</b>
                <span className="sub">{where}</span>
                <span className={`sub op op-${op ?? "none"}`}>Work: {op ? OPERATIONAL_LABEL[op] : "No run data"}</span>
              </div>
              <button type="button" onClick={() => p.onLocate(a.personaId)} aria-label={`Locate ${a.identity.name}`}>
                Locate
              </button>
            </li>
          );
        })}
        {!p.agents.length && <li className="sub">No agent with a character works here.</li>}
      </ul>
      {p.otherDesks > 0 && <p className="src">{p.otherDesks} more desk{p.otherDesks === 1 ? "" : "s"} for automations and skills without a character.</p>}
      <h4>Runs in progress</h4>
      {runs.length ? (
        <ul className="runs">
          {runs.map(({ r, a }) => (
            <li key={r.key} className={r.status === "failed" ? "err" : undefined}>
              <button type="button" className="link" onClick={() => p.onOpenRun(r)}>
                <b>{r.title}</b>
              </button>{" "}
              {RUN_LABEL[r.status]}
              {r.startedAt ? ` · started ${clock(r.startedAt, tz)} · ${ago(p.now - r.startedAt)} so far` : ""} · {a.identity.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className="src">No runs in progress.</p>
      )}
      <p className="src">{p.source === "live" ? "Run data: live from n8n and GitHub" : p.source === "saved" ? `Run data: saved copy${p.fetchedAt ? ` from ${clock(Date.parse(p.fetchedAt), tz)}` : ""}, live n8n not available` : "Run data: n8n not available here, GitHub and Task Center only"}</p>
      <div className="acts">
        <button type="button" onClick={p.onClose}>
          Back to city
        </button>
      </div>
    </section>
  );
}
