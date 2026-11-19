import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { directoryItems, isAiAgent } from "../../catalog/roles";
import type { Agent } from "../../catalog/types";
import type { N8nSnapshot, N8nWorkflowRuns } from "../../n8n/types";
import { identityFor } from "../../registry/identity";
import { agentOps, type AgentOps } from "../../routine/operations";
import type { Segment } from "../../routine/routine";
import { filterCounts, locateTarget, matchRow, rosterAgents, rosterRow, scheduleText, workStatus, type DeskInfo, type RosterRow } from "./cityRoster";

const NY = "America/New_York";
const MIN = 60_000;
const now = Date.parse("2026-11-18T20:30:00Z"); // 3:30 PM EST

const base = { purpose: "", framework: "n8n", lastRun: null, history: [], projectId: "benjaire-site", repository: "khaneilcampbell/benjaire.com" };
const reg = (displayName?: string, type = "A") => ({ classification: { type }, ...(displayName ? { identity: { displayName, role: "Shop manager" } } : {}) }) as unknown as Agent["registry"];
const AGENTS: Agent[] = [
  { ...base, id: "shop-manager", name: "Shop manager", status: "active", links: [], registry: reg("Mateo Rossi") },
  { ...base, id: "shop-follow-ups", name: "Shop follow ups", status: "active", ownedBy: "shop-manager", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/1QdoYrF1XVxT4Xyu" }], registry: reg(undefined, "B") },
  { ...base, id: "shop-delivery", name: "Shop delivery", status: "active", ownedBy: "shop-manager", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/pjj7ORgRjeGGTIFL" }], registry: reg(undefined, "B") },
  { ...base, id: "gone", name: "Gone", status: "retired", links: [], registry: reg("Retired Person") },
  { ...base, id: "reviewer", name: "Reviewer", status: "active", links: [], registry: reg("Margaret Lindqvist") },
];

const wf = (id: string, name: string, extra: Partial<N8nWorkflowRuns> = {}): N8nWorkflowRuns => ({ id, name, active: true, runs: [], failures24h: 0, schedules: [], timezone: NY, savesSuccess: true, ...extra });
const snap = (workflows: N8nWorkflowRuns[]): N8nSnapshot => ({ state: "ok", instance: "https://khancam15.app.n8n.cloud", fetchedAt: "2026-11-18T20:29:00Z", window: 250, workflows });
const opsOf = (id: string, n8n: N8nSnapshot | null): AgentOps => agentOps(id, { agents: AGENTS, n8n, repos: {}, tasks: [], seen: new Map(), personaOf: (x) => AGENTS.find((a) => a.id === x)?.ownedBy ?? x, now });

const FOLLOW = wf("1QdoYrF1XVxT4Xyu", "Shop follow ups", { schedules: [{ label: "Every 4 hours at :48", cron: "48 */4 * * *" }] });

describe("City agents roster", () => {
  it("lists one row per active agent: no automations, no retired agents, workflows never duplicate their owner", () => {
    const ids = rosterAgents(AGENTS).map((r) => r.identity.personaId);
    expect(ids).toEqual(["shop-manager", "reviewer"]);
  });

  it("counts the real registry: every active named agent, each once", () => {
    const rows = rosterAgents(catalog.agents);
    const ids = rows.map((r) => r.identity.personaId);
    expect(new Set(ids).size).toBe(ids.length);
    // Every row is an active AI agent with its own identity.
    for (const r of rows) {
      expect(isAiAgent(r.agent)).toBe(true);
      expect(r.agent.status).not.toBe("retired");
      expect(r.identity.kind).toBe("own");
    }
    // Every active AI agent is in the roster, or shows another agent's persona (Product Lab skills).
    for (const a of directoryItems(catalog.agents, "agents")) {
      const persona = identityFor(a.id, catalog.agents).personaId;
      if (a.registry?.identity) expect(ids).toContain(a.id);
      else expect(persona === a.id ? [] : ids).toContain(persona);
    }
    // No automation is ever counted as an agent.
    for (const a of directoryItems(catalog.agents, "automations")) expect(ids).not.toContain(a.id);
  });

  it("shows real work only, and Status unavailable when live n8n can't be read", () => {
    const running = snap([{ ...FOLLOW, runs: [{ id: "1", status: "running", mode: "trigger", startedAt: new Date(now - 2 * MIN).toISOString(), stoppedAt: null }] }]);
    expect(workStatus(opsOf("shop-manager", running))).toMatchObject({ label: "Running", tone: "running", known: true });
    // No live n8n: never "idle" or "no scheduled work".
    expect(workStatus(opsOf("shop-manager", null))).toEqual({ label: "Status unavailable", tone: "unknown", known: false });
    expect(workStatus(undefined)).toMatchObject({ label: "Status unavailable", known: false });
    // An agent with no workflow at all says so, rather than claiming it is idle.
    expect(workStatus(opsOf("reviewer", snap([])))).toMatchObject({ label: "No workflow linked", known: true });
    const failed = snap([{ ...FOLLOW, runs: [{ id: "2", status: "error", mode: "trigger", startedAt: new Date(now - 30 * MIN).toISOString(), stoppedAt: new Date(now - 29 * MIN).toISOString() }] }]);
    expect(workStatus(opsOf("shop-manager", failed))).toMatchObject({ label: "Failed", tone: "attention" });
  });

  it("gives the next run with its time zone, or Schedule unavailable", () => {
    const s = scheduleText(opsOf("shop-manager", snap([FOLLOW])), now);
    expect(s.known).toBe(true);
    expect(s.text).toBe("Shop follow ups · Today 4:48 PM EST");
    expect(scheduleText(opsOf("shop-manager", null), now)).toEqual({ text: "Schedule unavailable: live n8n data isn't readable here", known: false });
    expect(scheduleText(opsOf("reviewer", snap([])), now).text).toMatch(/No workflow linked/);
  });

  it("keeps city activity apart from work: relaxing at the park doesn't hide a running workflow", () => {
    const park = { kind: "stay", t0: now - MIN, t1: now + MIN, at: "park", activity: "relaxing", phase: null, note: "", option: { id: "park", kind: "park", label: "Park", spot: "park", exit: "park", stay: [60, 120] } } as Segment;
    const running = snap([{ ...FOLLOW, runs: [{ id: "1", status: "running", mode: "webhook", startedAt: new Date(now - MIN).toISOString(), stoppedAt: null }] }]);
    const [{ agent, identity }] = rosterAgents(AGENTS);
    const row = rosterRow({ agent, identity, ops: opsOf("shop-manager", running), seg: park, place: "Atlas Park", assigned: "Benjaire HQ", desk: null, district: "Business Operations" });
    expect(row.activity).toBe("Relaxing at the park");
    expect(row.work.label).toBe("Running");
    expect(row.free).toBe(true);
    expect(row.working).toBe(true);
  });

  it("searches name, role and building, then filters and narrows by district", () => {
    const mk = (name: string, role: string, assigned: string, district: string, flags: Partial<RosterRow>): RosterRow =>
      ({ personaId: name, identity: { name } as RosterRow["identity"], role, assigned, district, desk: null, work: { label: "x", tone: "neutral", known: true }, activity: null, location: null, free: false, working: false, attention: false, ...flags }) as RosterRow;
    const rows = [mk("Priya Raman", "Health Monitor", "Atlas Command Center", "AI Operations", { working: true }), mk("Mateo Rossi", "Shop manager", "Benjaire HQ", "Business Operations", { free: true }), mk("Yusuf Demir", "Agent operations", "Atlas Command Center", "AI Operations", { attention: true })];
    expect(rows.filter((r) => matchRow(r, "command", "all", "")).map((r) => r.identity.name)).toEqual(["Priya Raman", "Yusuf Demir"]);
    expect(rows.filter((r) => matchRow(r, "shop", "all", "")).map((r) => r.identity.name)).toEqual(["Mateo Rossi"]);
    expect(rows.filter((r) => matchRow(r, "", "attention", "")).map((r) => r.identity.name)).toEqual(["Yusuf Demir"]);
    expect(rows.filter((r) => matchRow(r, "", "free", "")).map((r) => r.identity.name)).toEqual(["Mateo Rossi"]);
    expect(rows.filter((r) => matchRow(r, "", "all", "AI Operations"))).toHaveLength(2);
    expect(rows.filter((r) => matchRow(r, "zzz", "all", ""))).toHaveLength(0);
    expect(filterCounts(rows)).toEqual({ all: 3, working: 1, free: 1, attention: 1 });
  });

  it("locates agents inside buildings and aboard vehicles, and explains when it can't", () => {
    const desk: DeskInfo = { buildingId: "project:ai-ops-atlas", projectId: "ai-ops-atlas", building: "Atlas Command Center", district: null, floor: 4, desk: 3, of: 3 };
    const inside = { kind: "inside", t0: 0, t1: 1, at: "desk", activity: "at_desk", phase: "working", note: "", work: { label: "x", runs: [], scheduledAt: null, alreadyStarted: false, outcome: null } } as Segment;
    const t = locateTarget([1, 2, 3], inside, desk, true);
    expect(t).toMatchObject({ kind: "point", at: [1, 2, 3], building: desk });
    expect(t.kind === "point" && t.note).toMatch(/Inside Atlas Command Center, floor 4/);
    const jet = { kind: "ride", t0: 0, t1: 1, at: "gate", activity: "riding", phase: null, note: "", option: { id: "jet", kind: "flight", label: "Jet", spot: "gate", exit: "gate", stay: [0, 0] }, times: {} } as unknown as Segment;
    expect(locateTarget([5, 9, 5], jet, null, true)).toMatchObject({ kind: "point", note: expect.stringMatching(/Gold Jet/) });
    const home = { kind: "stay", t0: 0, t1: 1, at: "home", activity: "at_home", phase: null, note: "" } as Segment;
    expect(locateTarget(null, home, null, true)).toMatchObject({ kind: "unavailable", reason: expect.stringMatching(/At home/) });
    expect(locateTarget(null, null, null, true)).toMatchObject({ kind: "unavailable", reason: expect.stringMatching(/Location unavailable/) });
    expect(locateTarget([1, 2, 3], inside, desk, false)).toMatchObject({ kind: "unavailable", reason: expect.stringMatching(/3D map/) });
  });
});
