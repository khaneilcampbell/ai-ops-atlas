import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useActions } from "../../actions/state";
import { agentJobs } from "../../catalog/agentJobs";
import { districtLabel, districtOf } from "../../catalog/organization";
import { AgentAvatar, AiAgentLabel } from "../../components/AgentIdentity";
import { ExternalLink } from "../../components/bits";
import { Icon } from "../../components/Icon";
import { mapBuildings, useInsideFloors } from "../../buildings/insideFloors";
import { useN8nRuns } from "../../n8n/runs";
import { FREE_TIME_CHOICES, TRAVEL_CHOICES, freeTimeAvailability, requestFreeTime, type FreeTimeChoice } from "../../routine/freeTime";
import type { TravelMode } from "../../routine/routine";
import { CONNECTION_LABEL, RUN_LABEL, type AgentOps, type OwnedWorkflow } from "../../routine/operations";
import { clock, segmentAt } from "../../routine/routine";
import { setRoutineHeld, useRoutineHeld, useRoutineOps, useRoutines, useWhereAll } from "../../routine/useRoutineOps";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { TaskForm } from "../tasks/TaskForm";
import { agentPositions, setFollowedAgent, useFollowedAgent, viewOffice } from "./agentFollow";
import { selectCityAgent, useCityAgents } from "./cityAgentsStore";
import { FILTER_LABEL, filterCounts, locateTarget, matchRow, rosterAgents, rosterRow, scheduleText, whenText, zoneAbbr, zoneName, type DeskInfo, type RosterFilter, type RosterRow } from "./cityRoster";
import "../../styles/tasks.css";

/**
 * "City agents": find and manage the named agents from the map (Map.tsx toolbar). One roster of
 * every active registered agent (cityRoster.ts), searchable and filtered, with the selected agent's
 * city activity kept apart from its real work state, and actions wired to what Atlas already has:
 * Locate and Follow (the map camera), View office (the Inside view), Assign task (the Task Center's
 * own form), Schedule (its workflows' schedules, read-only, with the n8n editor linked) and Full
 * profile (Agents tab).
 *
 * Data comes from the shared stores the map and Agents tab already use (one n8n poll for everyone,
 * the routines and places the map publishes), so rows never poll on their own.
 */
const FILTERS: RosterFilter[] = ["all", "working", "free", "attention"];

export interface CityAgentsPanelProps {
  /** The 3D map is on: Locate, Follow and View office need it. */
  mapOn: boolean;
  phone: boolean;
  onLocate(at: [number, number, number]): void;
  onClose(): void;
}

export function CityAgentsPanel(p: CityAgentsPanelProps) {
  const { catalog, select, setView } = useAtlas();
  const { selected } = useCityAgents();
  const followed = useFollowedAgent();
  const held = useRoutineHeld();
  const floors = useInsideFloors();
  const roster = useMemo(() => rosterAgents(catalog.agents), [catalog.agents]);
  const ids = useMemo(() => roster.map((r) => r.identity.personaId), [roster]);
  const { ops, source, fetchedAt, message, now } = useRoutineOps(ids);
  const n8n = useN8nRuns();
  const routines = useRoutines();
  const { where, version } = useWhereAll();
  const jobs = useMemo(() => agentJobs(catalog), [catalog]);

  // Desks from the building definitions the map publishes (the same ones the Inside view draws).
  const desks = useMemo(() => {
    const out = new Map<string, DeskInfo>();
    for (const def of mapBuildings().values()) {
      for (const d of def.desks) {
        const same = def.desks.filter((x) => x.floor === d.floor);
        out.set(d.agentId, { buildingId: def.id, projectId: def.projectId, building: def.name, district: def.district, floor: d.floor, desk: same.indexOf(d) + 1, of: same.length });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- floors changes when the map publishes its buildings
  }, [floors]);

  const rows = useMemo<RosterRow[]>(
    () =>
      roster.map(({ agent, identity }) => {
        const id = identity.personaId;
        const job = jobs.find((j) => j.agentId === id);
        const project = catalog.projects.find((x) => x.id === (job?.work.projectId ?? agent.projectId));
        const routine = routines.get(id);
        return rosterRow({
          agent,
          identity,
          ops: ops.get(id),
          seg: routine ? segmentAt(routine, now) : null,
          place: where.get(id)?.place ?? null,
          assigned: job?.work.label ?? project?.name ?? "Not documented",
          desk: desks.get(id) ?? null,
          district: project ? districtLabel(districtOf(project, catalog.agents).value) : null,
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version changes when the map draws a new place
    [roster, jobs, catalog, ops, routines, now, version, desks],
  );

  // Search, filter and district stay as they are while you move between agents' details.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [district, setDistrict] = useState("");
  const districts = useMemo(() => [...new Set(rows.map((r) => r.district).filter((d): d is string => !!d))].sort(), [rows]);
  const counts = filterCounts(rows);
  const shown = rows.filter((r) => matchRow(r, query, filter, district));
  const current = rows.find((r) => r.personaId === selected) ?? null;

  const [locateNote, setLocateNote] = useState<{ id: string; text: string; office: boolean } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [freeOpen, setFreeOpen] = useState(false);
  const [freeNote, setFreeNote] = useState<{ id: string; text: string } | null>(null);
  const actions = useActions();
  useEffect(() => {
    setLocateNote(null);
    setScheduleOpen(false);
    setFreeOpen(false);
  }, [selected]);

  // Free time: only for agents in their free time now (freeTime.ts). Map picture only.
  const segOf = (id: string) => (routines.get(id) ? segmentAt(routines.get(id)!, Date.now()) : null);
  const idle = rows.filter((r) => freeTimeAvailability(segOf(r.personaId), held.has(r.personaId)).ok);
  const sendFree = (r: RosterRow, kind: FreeTimeChoice, travel: TravelMode) => {
    requestFreeTime([r.personaId], kind, Date.now(), travel);
    setFreeOpen(false);
    const going = FREE_TIME_CHOICES.find((c) => c.kind === kind)?.going ?? "free time";
    const by = travel === "car" ? " by Atlas car (picked up at the kerb)" : travel === "train" ? " by train" : travel === "walk" ? " on foot" : "";
    setFreeNote({ id: r.personaId, text: `${r.identity.name} is off to ${going}${by}. Only the map changes: runs, schedules and permissions stay as they are, and a run that comes due still calls ${r.identity.name} back.` });
  };
  const sendAllFree = () => {
    if (!idle.length) return;
    requestFreeTime(idle.map((r) => r.personaId), "any");
    setFreeNote({ id: "*", text: `Sent ${idle.length} free ${idle.length === 1 ? "agent" : "agents"} off to something they like. Only the map changes.` });
  };

  // The list keeps its scroll position across details (the detail sits above it, the list never remounts).
  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  // On a phone the list hides behind the details; it comes back scrolled where it was.
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (!selected && list.current) list.current.scrollTop = scrollTop.current;
  }, [selected]);
  // A selection made on the map scrolls its row into view.
  useLayoutEffect(() => {
    if (!selected) return;
    const box = list.current, el = box?.querySelector<HTMLElement>(`[data-agent="${CSS.escape(selected)}"]`);
    if (!box || !el || !box.clientHeight) return;
    // Scroll the list only (scrollIntoView would also scroll the map stage around it).
    const top = el.offsetTop - box.offsetTop, bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  }, [selected]);

  // Escape closes the task form first, then the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || assigning) return;
      p.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p, assigning]);

  // Arrow keys move between rows; Enter or Space selects (buttons do that natively).
  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button.ca-row") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[next]?.focus();
  };

  const locate = (r: RosterRow) => {
    selectCityAgent(r.personaId);
    const target = locateTarget(agentPositions.get(r.personaId), routines.get(r.personaId) ? segmentAt(routines.get(r.personaId)!, Date.now()) : null, r.desk, p.mapOn);
    if (target.kind === "unavailable") return setLocateNote({ id: r.personaId, text: target.reason, office: !!r.desk && p.mapOn });
    p.onLocate(target.at);
    setLocateNote({ id: r.personaId, text: target.note ?? `Found ${r.identity.name}${r.location ? ` at ${r.location}` : ""}.`, office: !!target.building });
  };
  const follow = (r: RosterRow) => {
    if (followed === r.personaId) return setFollowedAgent(null);
    selectCityAgent(r.personaId);
    if (!agentPositions.get(r.personaId)) {
      const target = locateTarget(agentPositions.get(r.personaId), routines.get(r.personaId) ? segmentAt(routines.get(r.personaId)!, Date.now()) : null, r.desk, p.mapOn);
      if (target.kind === "unavailable") return setLocateNote({ id: r.personaId, text: `Can't follow yet. ${target.reason}`, office: false });
    }
    setFollowedAgent(r.personaId);
  };
  const openOffice = (r: RosterRow) => {
    if (!r.desk) return;
    viewOffice({ towerKey: r.desk.buildingId, projectId: r.desk.projectId, personaId: r.personaId, floor: r.desk.floor });
  };
  const fullProfile = (r: RosterRow) => {
    p.onClose();
    select({ kind: "agent", id: r.personaId });
    setView("agents");
  };

  const freshness = source === "live" ? { tone: "live", text: `Live: n8n, GitHub and Task Center${fetchedAt ? `, checked ${clock(Date.parse(fetchedAt))} ${zoneAbbr(Date.parse(fetchedAt), "America/New_York")}` : ""}` } : source === "saved" ? { tone: "saved", text: `Saved copy${fetchedAt ? ` from ${whenText(Date.parse(fetchedAt), now, "America/New_York")}` : ""}: live n8n not reachable` } : n8n.state === "loading" ? { tone: "loading", text: "Connecting to run data…" } : { tone: "error", text: `No live n8n here${message ? ` (${message})` : ""}. GitHub and Task Center only.` };

  return (
    <aside
      className={`city-agents ${p.phone ? "sheet" : ""} ${current ? "has-detail" : ""}`}
      aria-labelledby="city-agents-title"
      role="dialog"
      // Clicks, drags, wheels and keys inside the panel never reach the map.
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Handled here: the keys stop at the panel, so the map's own shortcuts never see them.
        if (e.key === "Escape" && !assigning) {
          e.preventDefault();
          p.onClose();
        }
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <header className="ca-head">
        <div>
          <h2 id="city-agents-title" ref={heading} tabIndex={-1}>
            City agents
          </h2>
          <p>Find and manage your team</p>
        </div>
        <button type="button" className="ca-x" aria-label="Close City agents" onClick={p.onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="ca-tools">
        <label className="ca-search">
          <Icon name="search" size={14} />
          <span className="sr-only">Search agents by name, role or building</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, role or building" autoComplete="off" />
        </label>
        <div className="ca-filters" role="group" aria-label="Filter agents">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {FILTER_LABEL[f]} <span className="n">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="ca-district">
          <span className="sr-only">District</span>
          <select value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">All districts</option>
            {districts.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className={`ca-fresh ${freshness.tone}`} role="status">
        <i aria-hidden /> {freshness.text}
      </p>

      {!current && (
        <div className="ca-freeall">
          <button type="button" onClick={sendAllFree} disabled={!idle.length || !p.mapOn} title={p.mapOn ? "Send every agent in its free time to the Ferris wheel, yacht, train, parks and more. Map picture only." : "Switch on the 3D map to send agents on free time"}>
            <Icon name="sun" size={14} /> Free time for idle agents <span className="n">{idle.length}</span>
          </button>
          {freeNote?.id === "*" && (
            <p className="ca-note" role="status">
              {freeNote.text}
            </p>
          )}
        </div>
      )}

      {current && (
        <section className="ca-detail" aria-label={`${current.identity.name} details`}>
          <div className="ca-who">
            <AgentAvatar identity={current.identity} size={52} />
            <div>
              <div className="ca-name">{current.identity.name}</div>
              <div className="ca-role">{current.role}</div>
              <AiAgentLabel />
            </div>
            <button type="button" className="ca-back" onClick={() => selectCityAgent(null)} aria-label="Back to the list">
              <Icon name="close" size={14} />
            </button>
          </div>
          <dl>
            <dt>In the city</dt>
            <dd>
              {current.activity ?? (p.mapOn ? "Not placed yet" : "Unavailable: the 3D map is off")}
              <span className="sub">{current.location ?? "Location unavailable"}</span>
              <span className="sub hint">City activity is a picture of the day; it never says whether work is running.</span>
            </dd>
            <dt>Assigned</dt>
            <dd>
              {current.district ?? "District not documented"}
              <span className="sub">{current.desk ? `${current.desk.building} · Floor ${current.desk.floor} · Desk ${current.desk.desk} of ${current.desk.of}` : `${current.assigned} · no desk in this building's plan`}</span>
            </dd>
            <dt>Work</dt>
            <dd className={`ca-work t-${current.work.tone}`}>
              <StatusMark tone={current.work.tone} /> {current.work.label}
              <CurrentTask ops={ops.get(current.personaId)} now={now} />
            </dd>
            <dt>Next run</dt>
            <dd className={scheduleText(ops.get(current.personaId), now).known ? "" : "unknown"}>{scheduleText(ops.get(current.personaId), now).text}</dd>
          </dl>

          <div className="ca-actions">
            <button type="button" onClick={() => locate(current)} disabled={!p.mapOn} title={p.mapOn ? "Glide to this agent and highlight it" : "Switch on the 3D map to locate agents"}>
              <Icon name="locate" size={14} /> Locate
            </button>
            <button type="button" aria-pressed={followed === current.personaId} onClick={() => follow(current)} disabled={!p.mapOn}>
              <Icon name="compass" size={14} /> {followed === current.personaId ? "Stop following" : "Follow"}
            </button>
            <button type="button" onClick={() => openOffice(current)} disabled={!current.desk || !p.mapOn} title={current.desk ? `Open ${current.desk.building}, floor ${current.desk.floor}` : "No desk for this agent in a building's office plan"}>
              <Icon name="cutaway" size={14} /> View office
            </button>
            <button type="button" onClick={() => setAssigning(true)}>
              <Icon name="tasks" size={14} /> Assign task
            </button>
            <button type="button" aria-expanded={scheduleOpen} onClick={() => setScheduleOpen((o) => !o)}>
              <Icon name="clock" size={14} /> Schedule
            </button>
            <button type="button" aria-expanded={freeOpen} onClick={() => setFreeOpen((o) => !o)} disabled={!p.mapOn} title={p.mapOn ? "Send this agent off to the Ferris wheel, yacht, train or a park. Map picture only." : "Switch on the 3D map to send agents on free time"}>
              <Icon name="sun" size={14} /> Free time
            </button>
            <button type="button" onClick={() => fullProfile(current)}>
              <Icon name="agents" size={14} /> Full profile
            </button>
          </div>
          {locateNote?.id === current.personaId && (
            <p className="ca-note" role="status">
              {locateNote.text}
              {locateNote.office && current.desk && (
                <button type="button" className="ca-link" onClick={() => openOffice(current)}>
                  Open the interior
                </button>
              )}
            </p>
          )}
          {followed === current.personaId && <p className="ca-note">Following {current.identity.name}. Move the map yourself or press Stop following to let go.</p>}
          {freeOpen && <FreeTime row={current} availability={freeTimeAvailability(segOf(current.personaId), held.has(current.personaId))} onPick={(k, t) => sendFree(current, k, t)} />}
          {freeNote?.id === current.personaId && !freeOpen && (
            <p className="ca-note" role="status">
              {freeNote.text}
            </p>
          )}
          {scheduleOpen && <Schedule ops={ops.get(current.personaId)} held={held.has(current.personaId)} personaId={current.personaId} now={now} live={source === "live"} />}
        </section>
      )}

      <ul ref={list} className="ca-list" aria-label={`Agents, ${shown.length} of ${rows.length}`} onKeyDown={onListKey}>
        {shown.map((r) => (
          <li key={r.personaId} data-agent={r.personaId}>
            <button type="button" className={`ca-row ${r.personaId === selected ? "sel" : ""}`} aria-current={r.personaId === selected ? "true" : undefined} aria-label={`${r.identity.name}, ${r.role}. Work: ${r.work.label}. ${r.activity ? `${r.activity}, ` : ""}${r.location ?? "location unavailable"}.`} onClick={() => {
                scrollTop.current = list.current?.scrollTop ?? 0;
                selectCityAgent(r.personaId);
              }}>
              <AgentAvatar identity={r.identity} size={36} />
              <span className="ca-row-main">
                <span className="ca-row-name">{r.identity.name}</span>
                <span className="ca-row-role">{r.role}</span>
                <span className="ca-row-where">{r.location ?? (p.mapOn ? "Location unavailable" : "Location unavailable (3D map off)")}</span>
              </span>
              <span className={`ca-badge t-${r.work.tone}`}>
                <StatusMark tone={r.work.tone} />
                {r.work.label}
              </span>
            </button>
            <button type="button" className="ca-loc" aria-label={`Locate ${r.identity.name}`} title="Locate on the map" onClick={() => locate(r)} disabled={!p.mapOn}>
              <Icon name="locate" size={15} />
            </button>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="ca-empty">
            {rows.length === 0 ? "No active agents are registered." : "No agents match."}
            {rows.length > 0 && (
              <button
                type="button"
                className="ca-link"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                  setDistrict("");
                }}
              >
                Clear search and filters
              </button>
            )}
          </li>
        )}
      </ul>

      {assigning && current && (
        <TaskForm
          preset={{ agentId: current.personaId, buildingId: current.desk?.projectId }}
          ctx={{ desktop: actions.available, agentsToken: !!actions.status?.agents_token }}
          onClose={() => setAssigning(false)}
          onDone={(id) => {
            setAssigning(false);
            focusTasks({}, id);
            p.onClose();
            setView("tasks");
          }}
        />
      )}
    </aside>
  );
}

/** What the agent can go and do, and how it gets there, or why it can't go now. */
function FreeTime({ row, availability, onPick }: { row: RosterRow; availability: ReturnType<typeof freeTimeAvailability>; onPick(kind: FreeTimeChoice, travel: TravelMode): void }) {
  const [travel, setTravel] = useState<TravelMode>("auto");
  const label = useId();
  return (
    <div className="ca-freetime" role="group" aria-label={`Free time for ${row.identity.name}`}>
      {availability.ok ? (
        <>
          <p className="sub" id={label}>Travel by</p>
          <div className="ca-travel" role="radiogroup" aria-labelledby={label}>
            {TRAVEL_CHOICES.map((c) => (
              <button key={c.mode} type="button" role="radio" aria-checked={travel === c.mode} className={travel === c.mode ? "on" : ""} title={c.hint} onClick={() => setTravel(c.mode)}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="sub hint">{TRAVEL_CHOICES.find((c) => c.mode === travel)?.hint}.</p>
          <p className="sub">Where should {row.identity.name} go?</p>
          <div className="ca-freechoices">
            {FREE_TIME_CHOICES.map((c) => (
              <button key={c.kind} type="button" onClick={() => onPick(c.kind, travel)}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="sub">{availability.reason}</p>
      )}
      <p className="sub hint">Only changes the map picture. Runs, schedules, workflows and permissions stay as they are.</p>
    </div>
  );
}

/** A shape as well as a colour, so the state reads without colour. */
function StatusMark({ tone }: { tone: RosterRow["work"]["tone"] }) {
  return <i className={`ca-mark m-${tone}`} aria-hidden />;
}

function CurrentTask({ ops, now }: { ops: AgentOps | undefined; now: number }) {
  const task = ops?.open[0];
  if (task) return <span className="sub">Current task: {task.title} · {RUN_LABEL[task.status]}{task.startedAt ? ` since ${clock(task.startedAt)}` : ""}</span>;
  if (ops?.lastResult) return <span className="sub">No task running. Last: {ops.lastResult.title}, {RUN_LABEL[ops.lastResult.status].toLowerCase()}{ops.lastResult.stoppedAt ? ` ${whenText(ops.lastResult.stoppedAt, now, "America/New_York")}` : ""}</span>;
  return <span className="sub">No current task seen</span>;
}

/**
 * The agent's workflow schedules, read-only. Atlas reads n8n with a read-only key, so schedules are
 * changed in the n8n editor (linked), where approval rules, time zone and the single trigger per
 * workflow are enforced; Atlas never writes a second trigger.
 */
function Schedule({ ops, held, personaId, now, live }: { ops: AgentOps | undefined; held: boolean; personaId: string; now: number; live: boolean }) {
  if (!ops) return <p className="ca-note">Schedule unavailable: no run data for this agent.</p>;
  return (
    <div className="ca-schedule" aria-label="Schedule">
      <p className="ca-ro">
        <Icon name="lock" size={12} /> Read-only in Atlas. Atlas reads n8n with a read-only key, so schedules are edited in n8n.
      </p>
      {ops.workflows.length === 0 ? (
        <p className="sub">No workflow linked in the catalog: its work comes from the Task Center.</p>
      ) : (
        <ul>
          {ops.workflows.map((w) => (
            <ScheduleRow key={w.key} w={w} now={now} live={live} />
          ))}
        </ul>
      )}
      <p className="sub">
        <b>Pausing a schedule</b> stops future runs: switch the workflow off in n8n. <b>Cancelling a running task</b> stops only the run in progress: open the run (Current task) or the Task Center.
      </p>
      <label className="ca-switch">
        <input type="checkbox" checked={!held} onChange={(e) => setRoutineHeld(personaId, !e.target.checked)} /> City routine {held ? "paused in Atlas (stays home on the map)" : "on"}
        <span className="sub">Only changes the map picture, never a real run.</span>
      </label>
    </div>
  );
}

function ScheduleRow({ w, now, live }: { w: OwnedWorkflow; now: number; live: boolean }) {
  const recurrence = w.schedules.length ? w.schedules.map((s) => s.label).join(", ") : w.source === "github" ? "GitHub Actions schedule not read yet" : !live ? "Schedule unavailable" : (w.trigger ?? "Runs on its trigger");
  return (
    <li>
      <div className="ca-wf">
        <b>{w.name}</b> <span className={`conn conn-${w.connection}`}>{CONNECTION_LABEL[w.connection]}</span>
      </div>
      <div className="sub">
        {recurrence}
        {w.schedules.length ? ` · ${zoneName(w.timeZone)}${w.zoneSource === "default" ? " (default zone)" : ""}` : ""}
        {w.nextRun ? ` · next ${whenText(w.nextRun, now, w.timeZone)}` : ""}
      </div>
      {w.approval && <div className="sub">Approval: {w.approval}</div>}
      <div className="sub">
        <ExternalLink href={w.url}>{w.source === "n8n" ? "Edit schedule in n8n" : "Open in GitHub"}</ExternalLink>
      </div>
    </li>
  );
}
