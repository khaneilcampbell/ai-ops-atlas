import { describe, expect, it } from "vitest";
import { approvalRefusal, beginAttempt, cancel, canTransition, decideApproval, MAX_EVENTS_PER_TASK, requestApproval, retry, startProblem, transition, updateAttempt, withEvent, type Result } from "./lifecycle";
import { addArtifact, byId, editTask, LocalTaskRepository, memoryBackend, TaskService } from "./store";
import { availability, githubRunUpdate, matchGithubRun, outcomeToUpdate } from "./adapters";
import { buildingSummary, EMPTY_FILTER, matches, page, sortTasks, summarize } from "./select";
import { ruleRouter } from "./routing";
import { agentProblem, agentProfile, agentWorkflows } from "./registry";
import { githubFailureEvents, intake, n8nFailureEvents } from "./intake";
import { ATLAS, KHANEIL, type Actor, type StoredTask } from "./types";
import type { Agent, Project } from "../catalog/types";
import type { RepoState, WorkflowRun } from "../github/types";

let clock = Date.parse("2026-11-15T12:00:00Z");
const now = () => new Date((clock += 1000)).toISOString();
const service = () => new TaskService(new LocalTaskRepository(memoryBackend()), now);
const ok = (r: Result): StoredTask => {
  if (!r.ok) throw new Error(r.error);
  return r.task;
};
const agentActor: Actor = { kind: "agent", id: "github-merge-flow", name: "Production Coordinator" };

const agent = (over: Partial<Agent> = {}): Agent => ({
  id: "a1", name: "Agent One", purpose: "", framework: "n8n", status: "active", lastRun: null, history: [], links: [], projectId: "hq", repository: "me/hq", ...over,
});
const projects: Project[] = [{ id: "hq", name: "Atlas HQ", summary: "", status: "active", repository: "me/hq", tags: [], links: [], agentIds: [] }];

describe("task lifecycle", () => {
  it("creates and persists a queued task with created and assigned events", () => {
    const backend = memoryBackend();
    const s = new TaskService(new LocalTaskRepository(backend), now);
    const t = ok(s.create({ title: "Ship report", agentId: "a1", agentName: "Agent One", buildingId: "hq" }, KHANEIL));
    expect(t.status).toBe("queued");
    expect(t.events.map((e) => e.type)).toEqual(["created", "assigned"]);
    // A second repository on the same storage sees it: it was written, not only kept in memory.
    const again = new LocalTaskRepository(backend);
    expect(again.get(t.id)?.title).toBe("Ship report");
    expect(s.create({ title: "  " }, KHANEIL).ok).toBe(false);
  });

  it("allows only the documented transitions", () => {
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("failed", "queued")).toBe(true);
    expect(canTransition("completed", "queued")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
    expect(canTransition("blocked", "running")).toBe(false);
    const t = ok(service().create({ title: "x" }, KHANEIL));
    expect(transition(t, "completed", KHANEIL, now()).ok).toBe(false);
  });

  it("runs manual work to completion and records each step", () => {
    const s = service();
    const t = ok(s.create({ title: "Manual" }, KHANEIL));
    const running = ok(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)));
    expect(running.status).toBe("running");
    expect(running.attempts[0].idempotencyKey).toBe(`${t.id}:1`);
    const done = ok(s.apply(t.id, (x, _a, at) => updateAttempt(x, x.attempts[0].id, { state: "succeeded", result: "done" }, KHANEIL, at)));
    expect(done.status).toBe("completed");
    expect(done.completedAt).toBeTruthy();
    expect(done.events.map((e) => e.type)).toContain("execution_completed");
  });

  it("refuses a second start while a run is live (no duplicate execution)", () => {
    const s = service();
    const t = ok(s.create({ title: "Once" }, KHANEIL));
    ok(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "github", KHANEIL, at, null)));
    const second = s.apply(t.id, (x, all, at) => beginAttempt(x, all, "github", KHANEIL, at, null));
    expect(second.ok).toBe(false);
  });

  it("enforces dependencies and releases blocked tasks when they complete", () => {
    const s = service();
    const dep = ok(s.create({ title: "First" }, KHANEIL));
    const t = ok(s.create({ title: "Second", dependencyIds: [dep.id] }, KHANEIL));
    expect(startProblem(t, byId(s.repo.list()), null)).toMatch(/Waiting on/);
    expect(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)).ok).toBe(false);
    ok(s.apply(t.id, (x, _all, at) => transition(x, "blocked", ATLAS, at)));
    ok(s.apply(dep.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)));
    ok(s.apply(dep.id, (x, _a, at) => updateAttempt(x, x.attempts[0].id, { state: "succeeded" }, KHANEIL, at)));
    expect(s.repo.get(t.id)?.status).toBe("queued");
    // Loops are refused.
    expect(s.apply(dep.id, (x, all, at) => editTask(x, { dependencyIds: [t.id] }, all, KHANEIL, at, null)).ok).toBe(false);
  });

  it("needs a person's approval, per attempt, and agents can't approve their own work", () => {
    const s = service();
    const t = ok(s.create({ title: "Deploy", agentId: "github-merge-flow", categories: ["production_deploy"] }, agentActor));
    expect(t.requiresApproval).toBe(true);
    expect(startProblem(t, byId(s.repo.list()), null)).toMatch(/approval/);
    const waiting = ok(s.apply(t.id, (x, _a, at) => requestApproval(x, agentActor, at)));
    expect(waiting.status).toBe("awaiting_approval");
    expect(approvalRefusal(waiting, agentActor)).toMatch(/only a person/);
    expect(decideApproval(waiting, "granted", ATLAS, now()).ok).toBe(false);
    expect(decideApproval(waiting, "granted", { kind: "person", id: "github-merge-flow", name: "spoof" }, now()).ok).toBe(false);
    const approved = ok(s.apply(t.id, (x, _a, at) => decideApproval(x, "granted", KHANEIL, at)));
    expect(approved.status).toBe("queued");
    const run = ok(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)));
    ok(s.apply(t.id, (x, _a, at) => updateAttempt(x, run.attempts[0].id, { state: "failed", error: "boom" }, KHANEIL, at)));
    ok(s.apply(t.id, (x, _a, at) => retry(x, KHANEIL, at)));
    // The approval covered attempt 1 only.
    expect(startProblem(s.repo.get(t.id)!, byId(s.repo.list()), null)).toMatch(/approval/);
  });

  it("rejecting approval cancels the task", () => {
    const s = service();
    const t = ok(s.create({ title: "Email customers", categories: ["customer_message"] }, KHANEIL));
    ok(s.apply(t.id, (x, _a, at) => requestApproval(x, KHANEIL, at)));
    expect(ok(s.apply(t.id, (x, _a, at) => decideApproval(x, "rejected", KHANEIL, at, "Not now"))).status).toBe("cancelled");
  });

  it("limits retries", () => {
    const s = service();
    const t = ok(s.create({ title: "Flaky", maxAttempts: 2 }, KHANEIL));
    for (let i = 0; i < 2; i++) {
      const r = ok(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)));
      ok(s.apply(t.id, (x, _a, at) => updateAttempt(x, r.attempts[i].id, { state: "failed", error: "no" }, KHANEIL, at)));
      if (i === 0) ok(s.apply(t.id, (x, _a, at) => retry(x, KHANEIL, at)));
    }
    expect(s.apply(t.id, (x, _a, at) => retry(x, KHANEIL, at)).ok).toBe(false);
  });

  it("only marks external work cancelled once the system confirms it", () => {
    const s = service();
    const t = ok(s.create({ title: "Remote" }, KHANEIL));
    const r = ok(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "github", KHANEIL, at, null)));
    const asked = ok(s.apply(t.id, (x, _a, at) => cancel(x, KHANEIL, at)));
    expect(asked.status).toBe("running");
    expect(asked.cancelRequestedAt).toBeTruthy();
    const confirmed = ok(s.apply(t.id, (x, _a, at) => updateAttempt(x, r.attempts[0].id, { state: "cancelled", externalId: "9" }, KHANEIL, at)));
    expect(confirmed.status).toBe("cancelled");
    expect(confirmed.events.some((e) => e.type === "external_confirmed")).toBe(true);
  });

  it("refuses a stale write (compare-and-set)", () => {
    const backend = memoryBackend();
    const a = new LocalTaskRepository(backend);
    const s = new TaskService(a, now);
    const t = ok(s.create({ title: "Shared" }, KHANEIL));
    const other = new LocalTaskRepository(backend);
    ok(other.put({ ...t, title: "Changed elsewhere" }, t.rev));
    expect(a.put({ ...t, title: "Mine" }, t.rev).ok).toBe(false);
  });

  it("keeps history bounded and append-only, with the created event kept", () => {
    let t = ok(service().create({ title: "Chatty" }, KHANEIL));
    const first = t.events[0];
    for (let i = 0; i < MAX_EVENTS_PER_TASK + 20; i++) t = withEvent(t, "edited", KHANEIL, now());
    expect(t.events.length).toBe(MAX_EVENTS_PER_TASK);
    expect(t.events[0]).toEqual(first);
    expect(t.eventsTrimmed).toBe(21);
  });

  it("keeps an agent's name on old tasks after it retires, and refuses new work for it", () => {
    const s = service();
    const t = ok(s.create({ title: "Old", agentId: "gone", agentName: "Retired Agent" }, KHANEIL));
    expect(t.agentName).toBe("Retired Agent");
    expect(agentProblem(agent({ status: "retired", name: "Retired Agent" }))).toMatch(/retired/);
    expect(agentProblem(undefined)).toMatch(/isn't in the Atlas catalog/);
    expect(s.apply(t.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, agentProblem(undefined))).ok).toBe(false);
    expect(s.apply(t.id, (x, all, at) => editTask(x, { agentId: "gone2" }, all, KHANEIL, at, "retired")).ok).toBe(false);
  });

  it("saves only https artifacts", () => {
    const t = ok(service().create({ title: "Art" }, KHANEIL));
    expect(addArtifact(t, "", "javascript:alert(1)", KHANEIL, now()).ok).toBe(false);
    expect(ok(addArtifact(t, "Run", "https://github.com/me/x/actions/runs/1", KHANEIL, now())).artifacts[0].kind).toBe("github_run");
  });
});

describe("filters and summaries", () => {
  it("counts, filters, sorts and pages", () => {
    const s = service();
    const a = ok(s.create({ title: "Alpha report", priority: "low", buildingId: "hq" }, KHANEIL));
    const b = ok(s.create({ title: "Beta", priority: "critical", source: "n8n" }, KHANEIL));
    ok(s.apply(b.id, (x, all, at) => beginAttempt(x, all, "manual", KHANEIL, at, null)));
    const tasks = s.repo.list();
    expect(summarize(tasks)).toMatchObject({ total: 2, running: 1, queued: 1 });
    expect(tasks.filter((t) => matches(t, { ...EMPTY_FILTER, query: "alpha" })).map((t) => t.id)).toEqual([a.id]);
    expect(tasks.filter((t) => matches(t, { ...EMPTY_FILTER, source: "n8n" })).length).toBe(1);
    expect(tasks.filter((t) => matches(t, { ...EMPTY_FILTER, building: "hq" })).length).toBe(1);
    expect(tasks.filter((t) => matches(t, { ...EMPTY_FILTER, from: "2030-01-01" })).length).toBe(0);
    expect(sortTasks(tasks)[0].id).toBe(b.id);
    expect(page(Array.from({ length: 30 }), 1)).toMatchObject({ page: 1, pages: 2 });
    expect(buildingSummary(tasks, "hq")).toMatchObject({ assigned: 1, running: 0 });
  });
});

describe("registry, routing and adapters", () => {
  it("reads capabilities, environment and workflows from the catalog", () => {
    const a = agent({ capabilities: ["Triage failed runs"], runtime: "n8n Cloud", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/AbC123" }] });
    const p = agentProfile(a, projects);
    expect(p).toMatchObject({ buildingName: "Atlas HQ", environment: "n8n Cloud", unavailable: null });
    expect(agentWorkflows(a)[0]).toMatchObject({ kind: "n8n", id: "AbC123" });
  });

  it("routes deterministically by capability and skips retired agents", () => {
    const profiles = [
      agentProfile(agent({ id: "b", capabilities: ["Write release notes"] }), projects),
      agentProfile(agent({ id: "a", capabilities: ["Triage failed runs"] }), projects),
      agentProfile(agent({ id: "c", capabilities: ["Triage failed runs"], status: "retired" }), projects),
    ];
    expect(ruleRouter.route({ title: "Triage the failed runs", source: "system" }, profiles)?.agentId).toBe("a");
    expect(ruleRouter.route({ title: "x", source: "n8n", agentId: "c" }, profiles)).toBeNull();
    expect(ruleRouter.route({ title: "x", source: "n8n", agentId: "b" }, profiles)?.agentId).toBe("b");
  });

  it("only executes allow-listed GitHub workflows in the Mac app with a token; n8n stays read-only", () => {
    const gh = { agentId: "github-merge-flow", workflow: { kind: "github" as const, id: "merge-flow.yml", label: "" } };
    expect(availability(gh, { desktop: true, agentsToken: true }).mode).toBe("execute");
    expect(availability(gh, { desktop: false, agentsToken: true }).mode).toBe("read-only");
    expect(availability(gh, { desktop: true, agentsToken: false }).mode).toBe("read-only");
    expect(availability({ agentId: "github-merge-flow", workflow: { kind: "github", id: "deploy.yml", label: "" } }, { desktop: true, agentsToken: true }).mode).toBe("read-only");
    expect(availability({ workflow: { kind: "n8n", id: "x", label: "" } }, { desktop: true, agentsToken: true }).mode).toBe("read-only");
    expect(availability({}, { desktop: true, agentsToken: true }).mode).toBe("manual");
  });

  it("maps the Mac app's answers and GitHub runs to attempt updates, without guessing", () => {
    expect(outcomeToUpdate({ stage: "started", reason: null, message: "", audit_id: "a1" })).toEqual({ state: "running", auditId: "a1" });
    expect(outcomeToUpdate({ stage: "cancelled", reason: null, message: "Declined", audit_id: "a2" }).state).toBe("failed");
    expect(outcomeToUpdate({ stage: "unknown", reason: null, message: "timeout", audit_id: "a3" }).state).toBe("unknown");
    const attempt = { id: "r", number: 1, idempotencyKey: "t:1", state: "running" as const, executor: "github" as const, requestedAt: "2026-11-15T12:00:00Z", requestedBy: KHANEIL };
    const run = (over: Partial<WorkflowRun>): WorkflowRun => ({ id: 5, name: "Merge flow", status: "completed", conclusion: "success", branch: "main", event: "workflow_dispatch", createdAt: "2026-11-15T12:00:20Z", url: "https://github.com/x/actions/runs/5", ...over });
    expect(matchGithubRun(attempt, [run({ event: "schedule" })], new Set())).toBeNull();
    expect(matchGithubRun(attempt, [run({ createdAt: "2026-11-15T10:00:00Z" })], new Set())).toBeNull();
    expect(matchGithubRun(attempt, [run({})], new Set(["5"]))).toBeNull();
    expect(matchGithubRun(attempt, [run({})], new Set())?.id).toBe(5);
    expect(githubRunUpdate(attempt, run({}))?.state).toBe("succeeded");
    expect(githubRunUpdate(attempt, run({ conclusion: "failure" }))?.state).toBe("failed");
    expect(githubRunUpdate(attempt, run({ status: "in_progress", conclusion: null }))?.state).toBe("running");
  });
});

describe("automated intake", () => {
  it("makes one task per failure, never twice, and handles missing integrations", () => {
    const a = agent({ id: "flow", links: [{ label: "n8n workflow", url: "https://khancam15.app.n8n.cloud/workflow/W1" }] });
    const t0 = Date.parse("2026-11-15T12:00:00Z");
    const snap = { state: "ok" as const, instance: "https://khancam15.app.n8n.cloud", fetchedAt: "", window: 250, workflows: [{ id: "W1", name: "Flow", active: true, failures24h: 1, runs: [{ id: "77", status: "error" as const, mode: "trigger", startedAt: "2026-11-15T11:00:00Z", stoppedAt: null }] }] };
    const events = n8nFailureEvents(snap, [a], t0);
    expect(events).toHaveLength(1);
    expect(n8nFailureEvents({ state: "not-configured", need: "key" }, [a], t0)).toEqual([]);
    expect(n8nFailureEvents(null, [a], t0)).toEqual([]);
    const s = service();
    const profiles = [agentProfile(a, projects)];
    expect(intake(s, events, profiles, ruleRouter, ATLAS)).toBe(1);
    expect(intake(s, events, profiles, ruleRouter, ATLAS)).toBe(0);
    const task = s.repo.list()[0];
    expect(task).toMatchObject({ source: "n8n", agentId: "flow", buildingId: "hq", status: "queued" });

    const gh = agent({ id: "ci", observe: { githubWorkflow: "ci.yml" } });
    const repos = { "me/hq": { kind: "ok", data: { defaultBranch: "main", workflowRuns: { "ci.yml": [{ id: 3, name: "CI", status: "completed", conclusion: "failure", branch: "main", event: "push", createdAt: "2026-11-15T11:30:00Z", url: "u" }] } } } as unknown as RepoState };
    expect(githubFailureEvents([gh], repos, t0)).toHaveLength(1);
    expect(githubFailureEvents([{ ...gh, status: "retired" }], repos, t0)).toHaveLength(0);
  });
});
