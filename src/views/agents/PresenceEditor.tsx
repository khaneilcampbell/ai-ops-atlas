import { useMemo, useState } from "react";
import { agentJobs, homeLabel, type AgentJob } from "../../catalog/agentJobs";
import { PRESENCE, PRESENCE_LABEL, presenceAt, setAssignment, usePresenceAssignments, validateAssignment, type PresenceAssignment } from "../../catalog/agentPresence";
import { useIntel } from "../../intel/state";
import { agentTelemetry } from "../../registry/registry";
import { useAtlas } from "../../state";
import type { Agent, Catalog } from "../../catalog/types";
import { COMMON_ZONES, getTimeZone } from "../../lib/timezone";
import type { Telemetry } from "../../registry/types";
import { FINANCIAL_BUILDINGS } from "../map3d/financialPlan";
import { RUNTIME_LABEL, runtimeFor } from "../office/model";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOMES = FINANCIAL_BUILDINGS.map((b) => b.id);

/** Edit where an agent lives and works, and its presence hours. Presence only: it never starts a run. */
export function PresenceEditor({ job, agent, catalog, telemetry, now = new Date() }: { job: AgentJob; agent: Agent; catalog: Catalog; telemetry: Telemetry; now?: Date }) {
  const works = catalog.projects.map((p) => p.id);
  const [draft, setDraft] = useState<PresenceAssignment>(() => job.presence ?? { home: job.home.building, work: works.includes(job.work.projectId) ? job.work.projectId : works[0], days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone: getTimeZone() });
  const errors = validateAssignment(draft, HOMES, works);
  const set = (patch: Partial<PresenceAssignment>) => setDraft({ ...draft, ...patch });
  const runtime = runtimeFor(agent, telemetry);
  const zones = COMMON_ZONES.includes(draft.timeZone) ? COMMON_ZONES : [draft.timeZone, ...COMMON_ZONES];
  return (
    <div className="reg-stack" data-testid="presence-editor">
      <div className="section-title">Presence schedule</div>
      <p className="muted small">Moves the agent on the map only. Its automations keep their own triggers; this never starts, stops or reports a run.</p>
      <dl className="kv">
        <dt>Now</dt>
        <dd data-testid="presence-now">{job.presence ? PRESENCE_LABEL[presenceAt(job.presence, now).place] : "No schedule saved: follows the simulated map day"}</dd>
        <dt>Activity</dt>
        <dd data-testid="presence-activity">{RUNTIME_LABEL[runtime.state]}<div className="muted small">{runtime.reason}</div></dd>
      </dl>
      <label className="small">Home <select value={draft.home} onChange={(e) => set({ home: e.target.value })}>{HOMES.map((id) => <option key={id} value={id}>{homeLabel(id)}</option>)}</select></label>
      <label className="small">Workplace <select value={draft.work} onChange={(e) => set({ work: e.target.value })}>{catalog.projects.map((p) => <option key={p.id} value={p.id}>{p.name} headquarters</option>)}</select></label>
      <div className="small" role="group" aria-label="Working days">{DAYS.map((d, i) => <label key={d} style={{ marginRight: 8 }}><input type="checkbox" checked={draft.days.includes(i)} onChange={(e) => set({ days: e.target.checked ? [...draft.days, i].sort() : draft.days.filter((x) => x !== i) })} /> {d}</label>)}</div>
      <label className="small">Starts <input type="time" value={draft.start} onChange={(e) => set({ start: e.target.value })} /></label>
      <label className="small">Ends <input type="time" value={draft.end} onChange={(e) => set({ end: e.target.value })} /></label>
      <label className="small">Time zone <select value={draft.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
      <p className="muted small">Walks for {PRESENCE.commuteMinutes} minutes before the start and after the end. An end before the start runs overnight.</p>
      {errors.map((e) => <p key={e} className="small" role="alert">{e}</p>)}
      <div>
        <button className="btn" disabled={errors.length > 0} onClick={() => setAssignment(job.agentId, draft)}>Save schedule</button>{" "}
        {job.presence && <button className="btn ghost" onClick={() => setAssignment(job.agentId, null)}>Clear</button>}
      </div>
    </div>
  );
}

/** The editor for the phone and map agent sheet, which has no registry entry: works out the job and telemetry itself. */
export function AgentPresence({ agentId }: { agentId: string }) {
  const { catalog, repos } = useAtlas(), { telemetry: intel } = useIntel(), assignments = usePresenceAssignments();
  const job = useMemo(() => agentJobs(catalog, assignments).find((j) => j.agentId === agentId), [catalog, assignments, agentId]);
  const agent = catalog.agents.find((a) => a.id === agentId);
  if (!job || !agent) return <p className="muted small">Only AI agents have a home and workplace.</p>;
  const telemetry = agentTelemetry(catalog, agent, repos, intel);
  return <PresenceEditor key={agentId} job={job} agent={agent} catalog={catalog} telemetry={telemetry} />;
}
