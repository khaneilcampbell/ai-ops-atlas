import { useMemo } from "react";
import { agentJobs } from "../../catalog/agentJobs";
import { projectOfficeAgents } from "../../catalog/workplaces";
import { ExternalLink } from "../../components/bits";
import { identityFor } from "../../registry/identity";
import { DEFAULT_TIME_ZONE } from "../../routine/cron";
import { CONNECTION_LABEL, OPERATIONAL_LABEL, RUN_LABEL, type OwnedWorkflow } from "../../routine/operations";
import { clock } from "../../routine/routine";
import { setRoutineHeld, useRoutineHeld, useRoutineOps, useWhere } from "../../routine/useRoutineOps";
import { useAtlas } from "../../state";
import { planOffice } from "../office/model";
import { useN8nRuns } from "../../n8n/runs";
import { buildingDisplayName } from "../../modules/names";
import { SELF_REPORTS, reportsLive } from "../../selfReports/selfReports";

/**
 * The agent's daily routine settings (Agents → Workday, and the map's agent sheet): where it lives
 * and works, its own desk, every workflow it owns with how far Atlas can vouch for it, the schedule
 * and time zone, the next run and last result, approvals it needs and what's missing, and a switch
 * for its city routine. All read from the same sources as the map (routine/useRoutineOps.ts).
 *
 * The switch only pauses the character's routine in Atlas: real scheduled work keeps running until it
 * is unpublished where it runs, so each workflow links there. Atlas has no write access to n8n.
 */
const dayTime = (t: number, tz: string) => `${new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(t))}, ${clock(t, tz)}`;
const zoneName = (tz: string) => (tz === DEFAULT_TIME_ZONE ? "New York" : tz);

export function RoutinePanel({ agentId }: { agentId: string }) {
  const { catalog } = useAtlas();
  const personaId = identityFor(agentId, catalog.agents).personaId;
  const ids = useMemo(() => [personaId], [personaId]);
  const { ops: all, source, fetchedAt, message } = useRoutineOps(ids);
  const ops = all.get(personaId);
  const held = useRoutineHeld().has(personaId);
  const where = useWhere(personaId);
  const n8n = useN8nRuns();
  const job = useMemo(() => agentJobs(catalog).find((j) => j.agentId === personaId), [catalog, personaId]);
  const desk = useMemo(() => {
    if (!job || job.work.kind !== "headquarters") return null;
    const project = catalog.projects.find((p) => p.id === job.work.projectId);
    if (!project) return null;
    const plan = planOffice(project, projectOfficeAgents(catalog.agents, project.id));
    const i = plan.workstations.findIndex((w) => w.agentId === personaId);
    return i < 0 ? null : { n: i + 1, of: plan.workstations.length, office: project.name };
  }, [catalog, job, personaId]);
  if (!ops || !job) return <p className="muted small">No routine: this isn't an active named agent.</p>;
  const approvals = ops.workflows.filter((w) => w.approval);
  return (
    <div className="routine-panel">
      <div className="section-title">Daily routine</div>
      <dl className="kv">
        <dt>Residence</dt>
        <dd>{job.home.label}</dd>
        <dt>Office</dt>
        <dd>{job.work.label}</dd>
        <dt>Desk</dt>
        <dd>{desk ? `Desk ${desk.n} of ${desk.of} in ${desk.office} (open it with Inside on the map)` : "Not documented: no desk for it in this office plan"}</dd>
        <dt>Right now</dt>
        <dd>
          {where ? `${where.activity} · ${where.place}` : "Open the map to place it"}
          {where?.note ? <div className="muted small">{where.note}</div> : null}
        </dd>
        <dt>Work</dt>
        <dd>
          {OPERATIONAL_LABEL[ops.state]}
          {ops.lastResult && <div className="muted small">Last result: {ops.lastResult.title}, {RUN_LABEL[ops.lastResult.status].toLowerCase()}{ops.lastResult.stoppedAt ? ` at ${dayTime(ops.lastResult.stoppedAt, DEFAULT_TIME_ZONE)}` : ""}{ops.lastResult.url ? <> · <ExternalLink href={ops.lastResult.url}>Open run</ExternalLink></> : null}</div>}
        </dd>
        <dt>Next run</dt>
        <dd>{ops.next ? `${ops.next.workflow.name}, ${dayTime(ops.next.at, ops.next.workflow.timeZone)} (${zoneName(ops.next.workflow.timeZone)})` : "No schedule found for its workflows"}</dd>
        <dt>Self-report</dt>
        <dd>
          <SelfReport personaId={personaId} live={reportsLive(SELF_REPORTS, n8n.value?.state === "ok" ? n8n.value.workflows : null)} known={n8n.value?.state === "ok"} />
        </dd>
      </dl>

      <div className="section-title">Workflows it owns</div>
      {ops.workflows.length === 0 ? (
        <p className="muted small">None linked in the catalog. Its work comes from the Task Center or by hand.</p>
      ) : (
        <ul className="routine-wf">
          {ops.workflows.map((w) => (
            <WorkflowRow key={w.key} w={w} />
          ))}
        </ul>
      )}

      {(approvals.length > 0 || ops.missing.length > 0) && (
        <>
          <div className="section-title">Approvals and missing setup</div>
          <ul className="small">
            {approvals.map((w) => (
              <li key={w.key}>
                {w.name}: {w.approval}
              </li>
            ))}
            {ops.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}

      <div className="section-title">City routine</div>
      <label className="small routine-switch">
        <input type="checkbox" checked={!held} onChange={(e) => setRoutineHeld(personaId, !e.target.checked)} /> {held ? "Paused in Atlas: stays at home on the map" : "On: commutes for its scheduled work and has free time between"}
      </label>
      <p className="muted small">This only changes the map. Its scheduled runs keep running where they live; to pause one, switch the workflow off there (links above). Atlas can't change n8n.</p>
      <p className="muted small">{source === "live" ? "Run data: live from n8n." : source === "saved" ? `Run data: saved copy${fetchedAt ? ` from ${dayTime(Date.parse(fetchedAt), DEFAULT_TIME_ZONE)}` : ""}. ${message ?? ""}` : `Run data: ${message ?? "n8n isn't available here."} GitHub and the Task Center still count.`}</p>
    </div>
  );
}

/** Its daily report to the Data Intelligence Center (catalog/workspace/self-reports.yaml). */
function SelfReport({ personaId, live, known }: { personaId: string; live: boolean; known: boolean }) {
  const slot = SELF_REPORTS.slots[personaId];
  if (!slot) return <>No report time set</>;
  const place = buildingDisplayName(SELF_REPORTS.building, "Data Intelligence Center");
  const url = `https://khancam15.app.n8n.cloud/workflow/${SELF_REPORTS.workflowId}`;
  return (
    <>
      Daily at {slot} ({zoneName(SELF_REPORTS.timeZone)}) at the {place}
      <div className="muted small">
        {live ? "Published in n8n: it walks there at that time when it is free." : known ? "Draft, not running yet: no report or walk until the workflow is published." : "Draft until n8n shows the workflow published: no walk is drawn."} <ExternalLink href={url}>n8n workflow</ExternalLink>
      </div>
    </>
  );
}

function WorkflowRow({ w }: { w: OwnedWorkflow }) {
  return (
    <li>
      <div>
        <ExternalLink href={w.url}>{w.name}</ExternalLink> <span className={`conn conn-${w.connection}`}>{CONNECTION_LABEL[w.connection]}</span>
      </div>
      <div className="muted small">
        {w.source === "n8n" ? "n8n" : "GitHub Actions"} · {w.schedules.length ? `${w.schedules.map((s) => s.label).join(", ")} (${zoneName(w.timeZone)}${w.zoneSource === "default" ? ", default" : ""})` : w.trigger ?? "No schedule: runs on its trigger"}
        {w.nextRun ? ` · next ${dayTime(w.nextRun, w.timeZone)}` : ""}
      </div>
      <div className="muted small">{w.note}</div>
      {w.source === "n8n" && w.published && <div className="small"><ExternalLink href={w.url}>Pause in n8n</ExternalLink></div>}
    </li>
  );
}
