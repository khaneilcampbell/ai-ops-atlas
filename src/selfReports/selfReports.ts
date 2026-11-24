import * as yaml from "js-yaml";
import type { ManifestIssue } from "../catalog/types";
import { fromZoned, zoned } from "../routine/cron";
import { isValidTimeZone } from "../lib/timezone";

// Agent self-reports: each named agent walks to the Data Intelligence Center once a day, at its own
// time, to report data about itself (catalog/workspace/self-reports.yaml, docs/agent-self-reports.md).
// The report itself is written by the n8n workflow "Data Intelligence · Agent Self-Reports"; the map
// only shows the walk, and only while that workflow is published in n8n (`reportsLive`), so a draft
// never puts anyone on the street.

export const SELF_REPORTS_SCHEMA = "atlas/self-reports-v1";
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export interface SelfReportPlan {
  /** Stable map id of the building agents report to (buildings.yaml). */
  building: string;
  /** The n8n workflow that writes the reports; the walk shows only while it is published. */
  workflowId: string;
  timeZone: string;
  /** How long an agent stays to report, in minutes. */
  stayMinutes: number;
  /** Catalog agent id to its daily report time ("HH:MM" in `timeZone`). */
  slots: Record<string, string>;
}

const EMPTY: SelfReportPlan = { building: "", workflowId: "", timeZone: "America/New_York", stayMinutes: 6, slots: {} };

/** Parses the self-report schedule. Problems are reported in `issues`, never thrown. */
export function parseSelfReports(file: string, text: string, issues: ManifestIssue[]): SelfReportPlan {
  const fail = (message: string) => issues.push({ file, message });
  let doc: unknown;
  try {
    doc = yaml.load(text, { schema: yaml.CORE_SCHEMA });
  } catch (e) {
    fail(`file: invalid YAML (${(e as Error).message.split("\n")[0]})`);
    return EMPTY;
  }
  const root = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
  if (root.schema !== SELF_REPORTS_SCHEMA) fail(`schema: must be "${SELF_REPORTS_SCHEMA}"`);
  const building = typeof root.building === "string" ? root.building : "";
  if (!/^service:[a-z0-9:-]+$/.test(building)) fail("building: expected a stable map id such as service:financial:residence");
  const workflowId = typeof root.n8n_workflow === "string" ? root.n8n_workflow : "";
  if (!/^[A-Za-z0-9]{8,}$/.test(workflowId)) fail("n8n_workflow: expected an n8n workflow id");
  const timeZone = typeof root.time_zone === "string" && isValidTimeZone(root.time_zone) ? root.time_zone : EMPTY.timeZone;
  if (root.time_zone !== undefined && timeZone !== root.time_zone) fail("time_zone: not a known time zone");
  const stay = typeof root.stay_minutes === "number" && root.stay_minutes > 0 && root.stay_minutes <= 30 ? root.stay_minutes : EMPTY.stayMinutes;
  const report = root.report && typeof root.report === "object" ? (root.report as Record<string, unknown>) : {};
  const raw = report.slots && typeof report.slots === "object" && !Array.isArray(report.slots) ? (report.slots as Record<string, unknown>) : {};
  const slots: Record<string, string> = {};
  const taken = new Map<string, string>();
  for (const [id, v] of Object.entries(raw)) {
    if (!ID_RE.test(id)) {
      fail(`report.slots.${id}: expected a catalog agent id`);
      continue;
    }
    if (typeof v !== "string" || !TIME_RE.test(v)) {
      fail(`report.slots.${id}: expected a time like "09:30"`);
      continue;
    }
    if (taken.has(v)) fail(`report.slots.${id}: ${v} is already ${taken.get(v)}'s time (one agent per slot)`);
    taken.set(v, id);
    slots[id] = v;
  }
  return { building, workflowId, timeZone, stayMinutes: stay, slots };
}

const files = import.meta.glob("../../catalog/workspace/self-reports.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const SELF_REPORT_ISSUES: ManifestIssue[] = [];
export const SELF_REPORTS: SelfReportPlan = Object.values(files).map((t) => parseSelfReports("workspace/self-reports.yaml", t, SELF_REPORT_ISSUES))[0] ?? EMPTY;

/** The agent's report time on the calendar day of `now` (in the plan's zone), ms; null when it has no slot. */
export function reportTimeOn(plan: SelfReportPlan, agentId: string, now: number): number | null {
  const slot = plan.slots[agentId];
  if (!slot) return null;
  const [h, m] = slot.split(":").map(Number);
  const z = zoned(now, plan.timeZone);
  return fromZoned(z.y, z.mo, z.d, h, m, plan.timeZone);
}

/**
 * Whether the report walks are real: the workflow is published (active) in live n8n. Unknown n8n state
 * (still loading, not connected) counts as not live, so the map never shows a walk nobody scheduled.
 */
export function reportsLive(plan: SelfReportPlan, workflows: readonly { id: string; active: boolean }[] | null | undefined): boolean {
  if (!plan.workflowId || !workflows) return false;
  return workflows.some((w) => w.id === plan.workflowId && w.active);
}

/** Every slot in time order, for lists: [agentId, "HH:MM"]. */
export function slotList(plan: SelfReportPlan): [string, string][] {
  return Object.entries(plan.slots).sort((a, b) => a[1].localeCompare(b[1]));
}
