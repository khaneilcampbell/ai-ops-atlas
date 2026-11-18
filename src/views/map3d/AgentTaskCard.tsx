import { AgentAvatar, AiAgentLabel } from "../../components/AgentIdentity";
import type { IdentityStatus } from "../../registry/agentStatus";
import type { ResolvedIdentity as AgentIdentity } from "../../registry/identity";
import { DEFAULT_TIME_ZONE } from "../../routine/cron";
import { OPERATIONAL_LABEL, RUN_LABEL, type AgentOps, type OpRun } from "../../routine/operations";
import { activityText, clock, type Segment } from "../../routine/routine";

/**
 * The card that opens when you pick a named agent on the map: what it's doing in the city and,
 * separately, what its real work is doing. Run states come only from n8n, GitHub and the Task
 * Center (routine/operations.ts); the walk to the desk never stands in for a result.
 */
export interface AgentTaskCardProps {
  identity: AgentIdentity;
  status: IdentityStatus;
  workLabel: string;
  ops: AgentOps | undefined;
  seg: Segment | null;
  place: string;
  now: number;
  source: "live" | "saved" | "none";
  fetchedAt: string | null;
  following: boolean;
  hasOffice: boolean;
  /** Shown in the map's corner rather than above the agent. */
  docked?: boolean;
  onClose(): void;
  onFollow(): void;
  onViewOffice(): void;
  onOpenRun(run: OpRun): void;
  onProfile(): void;
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** "11:00 AM" today, "Thu 11:00 AM" on another day, in the zone. */
function dayClock(t: number, now: number, tz: string): string {
  const day = (x: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(x));
  return day(t) === day(now) ? clock(t, tz) : `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(t))} ${clock(t, tz)}`;
}

function runLine(r: OpRun, now: number, tz: string): string {
  const parts = [RUN_LABEL[r.status]];
  if (r.startedAt) parts.push(`started ${dayClock(r.startedAt, now, tz)}`);
  if (r.stoppedAt) parts.push(`ended ${dayClock(r.stoppedAt, now, tz)}`);
  else if (r.startedAt && (r.status === "running" || r.status === "waiting" || r.status === "waiting_approval")) parts.push(`${ago(now - r.startedAt)} so far`);
  if (r.retry) parts.push("retry");
  return parts.join(" · ");
}

export function AgentTaskCard(p: AgentTaskCardProps) {
  const { ops, seg, now } = p;
  const tz = DEFAULT_TIME_ZONE;
  const current = ops?.open[0] ?? null;
  const recent = (ops?.runs ?? []).filter((r) => !ops?.open.includes(r)).slice(0, 3);
  const failed = ops?.state === "failed" ? ops.lastResult : null;
  const activity = seg ? activityText(seg) : "Not placed yet";
  const openable = current ?? failed ?? ops?.lastResult ?? null;
  return (
    <div className={`m3-agent-profile m3-agent-task${p.docked ? " docked" : ""}`} role="dialog" aria-label={`${p.identity.name}, ${p.identity.role}, AI agent`} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="x" aria-label="Close" onClick={p.onClose}>
        ×
      </button>
      <div className="who">
        <AgentAvatar identity={p.identity} size={44} status={p.status} />
        <div>
          <div className="n">{p.identity.name}</div>
          <div className="r">{p.identity.role}</div>
          <AiAgentLabel />
        </div>
      </div>
      <dl>
        <dt>In the city</dt>
        <dd>
          {activity}
          {seg?.note ? <span className="sub">{seg.note}</span> : null}
        </dd>
        <dt>Where</dt>
        <dd>{p.place || p.workLabel}</dd>
        <dt>Work</dt>
        <dd className={`op op-${ops?.state ?? "idle"}`}>
          {ops?.state === "failed" && <span className="attn" aria-label="Needs attention">!</span>}
          {OPERATIONAL_LABEL[ops?.state ?? "idle"]}
        </dd>
        {current && (
          <>
            <dt>Current task</dt>
            <dd>
              {current.title}
              <span className="sub">{current.workflowName === current.title ? runLine(current, now, tz) : `${current.workflowName} · ${runLine(current, now, tz)}`}</span>
              {current.status === "waiting_approval" && <span className="sub wait">Waiting for approval</span>}
            </dd>
          </>
        )}
        {!current && ops?.lastResult && (
          <>
            <dt>Last result</dt>
            <dd>
              {ops.lastResult.title}
              <span className="sub">{runLine(ops.lastResult, now, tz)}</span>
              {failed?.detail && <span className="sub err">{failed.detail}</span>}
            </dd>
          </>
        )}
        <dt>Next run</dt>
        <dd>{ops?.next ? `${ops.next.workflow.name} · ${dayClock(ops.next.at, now, ops.next.workflow.timeZone)} (${ops.next.workflow.timeZone === DEFAULT_TIME_ZONE ? "New York" : ops.next.workflow.timeZone})` : ops?.due ? `${ops.due.workflow.name} was due at ${clock(ops.due.at, tz)}, waiting for n8n to report it` : "No schedule found"}</dd>
      </dl>
      {(ops?.open.length ?? 0) > 1 || recent.length > 0 ? (
        <ul className="runs" aria-label="Runs">
          {(ops?.open ?? []).slice(1).map((r) => (
            <li key={r.key}>
              <b>{r.title}</b> {runLine(r, now, tz)}
            </li>
          ))}
          {recent.map((r) => (
            <li key={r.key} className={r.status === "failed" ? "err" : undefined}>
              <b>{r.title}</b> {runLine(r, now, tz)}
            </li>
          ))}
        </ul>
      ) : null}
      {ops?.missing.length ? <p className="miss">{ops.missing[0]}</p> : null}
      <p className="src">{p.source === "live" ? "Run data: live from n8n and GitHub" : p.source === "saved" ? `Run data: saved copy${p.fetchedAt ? ` from ${clock(Date.parse(p.fetchedAt), tz)}` : ""}, live n8n not available` : "Run data: n8n not available here, GitHub and Task Center only"}</p>
      <div className="acts">
        <button type="button" aria-pressed={p.following} onClick={p.onFollow}>
          {p.following ? "Stop following" : "Follow agent"}
        </button>
        {p.hasOffice && (
          <button type="button" onClick={p.onViewOffice}>
            Locate agent
          </button>
        )}
        {openable ? (
          <button type="button" onClick={() => p.onOpenRun(openable)}>
            {failed && openable === failed ? "Open error" : "Open task"}
          </button>
        ) : null}
        <button type="button" onClick={p.onProfile}>
          Full profile
        </button>
      </div>
    </div>
  );
}
