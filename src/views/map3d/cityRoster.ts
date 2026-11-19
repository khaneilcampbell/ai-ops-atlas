import type { Agent } from "../../catalog/types";
import { isAiAgent } from "../../catalog/roles";
import { identityFor, type ResolvedIdentity } from "../../registry/identity";
import { DEFAULT_TIME_ZONE } from "../../routine/cron";
import { OPERATIONAL_LABEL, type AgentOps } from "../../routine/operations";
import { clock, runWorking, type Segment } from "../../routine/routine";

/**
 * The map's "City agents" roster (CityAgentsPanel.tsx): one row per active named agent, built from
 * the same registry, identities and operational state as the agent card, the Agents tab and the
 * Inside view. Pure, so the counts and filters are tested without a map.
 *
 * Two things stay apart here, as everywhere in Atlas (docs/agent-routine.md):
 * - city activity (walking, at the park, on the gold jet), which only pictures the day;
 * - work status, from real runs and schedules only. When live run data isn't readable, the work
 *   status says "Status unavailable", never "idle", and the schedule says "Schedule unavailable".
 */

/**
 * Every active registered agent the city has a character for: AI agents with their own identity,
 * not retired. Automations and n8n workflows are not agents (they show their owner's persona), so
 * several workflows owned by one agent never add rows; background pedestrians aren't in the
 * catalog at all. Catalog order, so the list is stable.
 */
export function rosterAgents(agents: readonly Agent[]): { agent: Agent; identity: ResolvedIdentity }[] {
  const seen = new Set<string>();
  const out: { agent: Agent; identity: ResolvedIdentity }[] = [];
  for (const a of agents) {
    if (!a.registry?.identity || !isAiAgent(a) || a.status === "retired") continue;
    const identity = identityFor(a.id, agents);
    if (identity.kind !== "own" || identity.retired || seen.has(identity.personaId)) continue;
    seen.add(identity.personaId);
    out.push({ agent: a, identity });
  }
  return out;
}

export type RosterFilter = "all" | "working" | "free" | "attention";
export const FILTER_LABEL: Record<RosterFilter, string> = { all: "All", working: "Working", free: "Free time", attention: "Attention" };

/** Tone of a work status, always shown with its words (never colour alone). */
export type WorkTone = "running" | "attention" | "good" | "neutral" | "unknown";

export interface WorkStatus {
  label: string;
  tone: WorkTone;
  /** False when Atlas can't see this agent's runs right now: the label says so instead of "idle". */
  known: boolean;
}

/** Where its desk is, from the building definition the Inside view draws (buildings/buildingDefinition.ts). */
export interface DeskInfo {
  buildingId: string;
  projectId: string;
  building: string;
  district: string | null;
  floor: number;
  /** 1-based, in the floor's own order. */
  desk: number;
  of: number;
}

export interface RosterRow {
  personaId: string;
  identity: ResolvedIdentity;
  role: string;
  /** The building it is assigned to (its workplace), for search and the district menu. */
  assigned: string;
  district: string | null;
  desk: DeskInfo | null;
  work: WorkStatus;
  /** City activity, e.g. "Relaxing" or "Heading to office"; null when the map hasn't placed it. */
  activity: string | null;
  /** Where it is now, as the map last drew it; null when unknown. */
  location: string | null;
  free: boolean;
  attention: boolean;
  working: boolean;
}

/** The agent's real work state, honest about what Atlas can't see. */
export function workStatus(ops: AgentOps | undefined, identityStatus?: string): WorkStatus {
  if (!ops) return { label: "Status unavailable", tone: "unknown", known: false };
  const s = ops.state;
  if (s === "running" || s === "queued") return { label: OPERATIONAL_LABEL[s], tone: "running", known: true };
  if (s === "waiting_approval" || s === "failed") return { label: OPERATIONAL_LABEL[s], tone: "attention", known: true };
  if (s === "succeeded") return { label: "Last run succeeded", tone: "good", known: true };
  if (s === "cancelled") return { label: "Last run cancelled", tone: "neutral", known: true };
  const n8n = ops.workflows.some((w) => w.source === "n8n");
  const github = ops.workflows.some((w) => w.source === "github");
  // Without live n8n, "nothing scheduled" can't be told apart from "can't see the schedule".
  if (n8n && !ops.live) return { label: "Status unavailable", tone: "unknown", known: false };
  if (s === "scheduled") return { label: OPERATIONAL_LABEL.scheduled, tone: "neutral", known: true };
  if (!ops.workflows.length) return { label: identityStatus === "failed" ? "Needs attention" : "No workflow linked", tone: identityStatus === "failed" ? "attention" : "neutral", known: true };
  if (github && !n8n) return { label: "No run seen in 24 h", tone: "neutral", known: true };
  return { label: OPERATIONAL_LABEL.idle, tone: "neutral", known: true };
}

/** Short time zone name, such as "EST", for the zone at that moment. */
export function zoneAbbr(t: number, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(t)).find((p) => p.type === "timeZoneName");
  return part?.value ?? tz;
}

/** "Today 11:00 AM EST" or "Thu 11:00 AM EST". */
export function whenText(t: number, now: number, tz: string): string {
  const day = (x: number) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).format(new Date(x));
  const d = day(t) === day(now) ? "Today" : new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(t));
  return `${d} ${clock(t, tz)} ${zoneAbbr(t, tz)}`;
}

export interface ScheduleText {
  text: string;
  /** False for "Schedule unavailable": Atlas can't read it, not "there is none". */
  known: boolean;
}

/** The agent's next scheduled run with its time zone, or why it can't be shown. */
export function scheduleText(ops: AgentOps | undefined, now: number): ScheduleText {
  if (!ops) return { text: "Schedule unavailable", known: false };
  if (ops.next) return { text: `${ops.next.workflow.name} · ${whenText(ops.next.at, now, ops.next.workflow.timeZone)}`, known: true };
  if (ops.due) return { text: `${ops.due.workflow.name} was due ${clock(ops.due.at, ops.due.workflow.timeZone)} ${zoneAbbr(ops.due.at, ops.due.workflow.timeZone)}, waiting for n8n to report it`, known: true };
  if (!ops.workflows.length) return { text: "No workflow linked, so nothing is scheduled", known: true };
  const n8n = ops.workflows.filter((w) => w.source === "n8n");
  if (n8n.length && !ops.live) return { text: "Schedule unavailable: live n8n data isn't readable here", known: false };
  if (!n8n.length) return { text: "Schedule unavailable: Atlas doesn't read GitHub Actions schedules yet", known: false };
  if (n8n.every((w) => w.published === false)) return { text: "No schedule: its n8n workflows are drafts (switched off)", known: true };
  return { text: "No schedule in n8n: it runs on its trigger", known: true };
}

export const zoneName = (tz: string) => (tz === DEFAULT_TIME_ZONE ? "New York" : tz);

export interface RowInput {
  agent: Agent;
  identity: ResolvedIdentity;
  ops: AgentOps | undefined;
  identityStatus?: string;
  seg: Segment | null;
  /** Where the map last drew it (routinePose place). */
  place: string | null;
  assigned: string;
  desk: DeskInfo | null;
  district: string | null;
}

export function rosterRow(i: RowInput): RosterRow {
  const work = workStatus(i.ops, i.identityStatus);
  const seg = i.seg;
  const activity = seg ? activityOf(seg) : null;
  return {
    personaId: i.identity.personaId,
    identity: i.identity,
    role: i.identity.role,
    assigned: i.assigned,
    district: i.district,
    desk: i.desk,
    work,
    activity,
    location: i.place || null,
    // Free time is a city picture: out of the office between work, not at home asleep.
    free: !!seg && seg.phase === null && seg.activity !== "at_home",
    working: work.tone === "running" || (!!seg && runWorking(seg)),
    attention: work.tone === "attention" || i.identityStatus === "failed",
  };
}

function activityOf(seg: Segment): string {
  if (seg.kind === "ride" || (seg.kind === "stay" && seg.option && seg.phase === null)) return seg.option ? leisureText(seg.option.kind) : "Riding";
  if (seg.kind === "inside") return seg.phase === "working" && !runWorking(seg) ? "At desk" : seg.phase === "working" ? "Working at desk" : seg.phase === "completed" ? "Finishing up at desk" : "At desk";
  if (seg.phase === "heading") return "Heading to office";
  if (seg.phase === "entering") return "Entering building";
  if (seg.phase === "to_desk") return "Going to desk";
  if (seg.phase === "leaving") return "Leaving office";
  if (seg.phase === "completed") return "Task completed";
  return seg.activity === "at_home" ? "At home" : seg.activity === "commuting" ? "Commuting" : seg.activity === "walking" ? "Walking" : seg.activity === "visiting" ? "Visiting" : "Relaxing";
}

function leisureText(kind: string): string {
  switch (kind) {
    case "park":
      return "Relaxing at the park";
    case "district":
      return "Visiting another district";
    case "train":
      return "Riding the train";
    case "flight":
      return "Aboard the Atlas Gold Jet";
    case "yacht":
      return "On a yacht ride";
    case "wheel":
      return "Riding the Ferris wheel";
    case "arena":
      return "At the arena";
    case "home":
      return "At home";
    default:
      return "Outside its building";
  }
}

/** Search by name, role or assigned building; then the filter chip; then the district menu. */
export function matchRow(r: RosterRow, query: string, filter: RosterFilter, district: string): boolean {
  const q = query.trim().toLowerCase();
  if (q && ![r.identity.name, r.role, r.assigned, r.desk?.building ?? ""].some((s) => s.toLowerCase().includes(q))) return false;
  if (filter === "working" && !r.working) return false;
  if (filter === "free" && !r.free) return false;
  if (filter === "attention" && !r.attention) return false;
  if (district && r.district !== district) return false;
  return true;
}

export function filterCounts(rows: readonly RosterRow[]): Record<RosterFilter, number> {
  return { all: rows.length, working: rows.filter((r) => r.working).length, free: rows.filter((r) => r.free).length, attention: rows.filter((r) => r.attention).length };
}

/** What "Locate" can do for this agent right now. */
export type LocateTarget =
  | { kind: "point"; at: [number, number, number]; note: string | null; building: DeskInfo | null }
  | { kind: "unavailable"; reason: string };

/**
 * Where to point the camera. Inside a building it still has a point (its badge on the facade at its
 * floor) and names the building so the interior can be offered; aboard a vehicle the point moves
 * with it. Out of sight (at home, waiting in the terminal) or not placed, it says why.
 */
export function locateTarget(pos: readonly [number, number, number] | null | undefined, seg: Segment | null, desk: DeskInfo | null, mapOn: boolean): LocateTarget {
  if (!mapOn) return { kind: "unavailable", reason: "Location unavailable: switch on the 3D map to locate agents." };
  if (!seg && !pos) return { kind: "unavailable", reason: "Location unavailable: the map hasn't placed this agent yet (no city route for it on this layout)." };
  if (!pos) {
    if (seg?.activity === "at_home") return { kind: "unavailable", reason: "At home in Ellipse Residences, so it isn't drawn on the map right now." };
    if (seg && seg.kind !== "inside" && seg.option?.kind === "flight") return { kind: "unavailable", reason: "Waiting in the airport terminal for the Atlas Gold Jet, out of sight until it boards." };
    return { kind: "unavailable", reason: "Location unavailable: the agent is out of sight on the map right now." };
  }
  const at: [number, number, number] = [pos[0], pos[1], pos[2]];
  if (seg?.kind === "inside" || (seg && (seg.phase === "to_desk" || seg.phase === "entering"))) {
    return { kind: "point", at, building: desk, note: desk ? `Inside ${desk.building}, floor ${desk.floor}. Open the interior to see its desk.` : "Inside its building." };
  }
  if (seg?.kind === "ride" && seg.option) return { kind: "point", at, building: null, note: `${leisureText(seg.option.kind)}: the camera finds the vehicle.` };
  return { kind: "point", at, building: null, note: null };
}
