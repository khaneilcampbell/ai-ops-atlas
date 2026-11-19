import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { LedgerStore } from "../execution/ledger";
import { runStatus } from "../execution/report";
import { beginAttempt, decideApproval, requestApproval, transition, updateAttempt } from "../tasks/lifecycle";
import { addArtifact, byId, LocalTaskRepository, memoryBackend, TaskService } from "../tasks/store";
import { KHANEIL, type Actor, type StoredTask } from "../tasks/types";
import { BENJAIRE_LAUNCH, BENJAIRE_LAUNCH_GOAL } from "../workflows/benjaireLaunch";
import { RunStore, startLiveRun } from "../workflows/runs";
import { CATEGORY_INFO, categoryOf, commandBrief, portfolio, toolUse, type BriefInput } from "./commandCenter";
import { checkImport, exportWorkspace } from "./readiness";
import { existingWorkspace, OFFERED_PURPOSES, parseProduct, parseWorkspace, ProductStore, PURPOSE_LABEL } from "./workspace";

// Phase 7.6: Atlas as a single-owner command center. These tests use the real Task Center, run
// store and ledger on in-memory backends with no adapters, so nothing outside Atlas is called.

const AT = "2026-11-17T12:00:00.000Z";
const NOW = Date.parse(AT);
const N8N: Actor = { kind: "n8n", id: "n8n", name: "n8n" };
const GITHUB: Actor = { kind: "github", id: "github", name: "GitHub" };
const ws = () => existingWorkspace({ projects: catalog.projects.map((p) => p.id), agents: catalog.agents.map((a) => a.id), integrations: [], templates: [], timeZone: "America/New_York" }, KHANEIL, AT);
const project = (id: string) => catalog.projects.find((p) => p.id === id)!;
const agentOf = (projectId: string) => catalog.agents.find((a) => a.projectId === projectId && a.status !== "retired")!;

function app() {
  const svc = new TaskService(new LocalTaskRepository(memoryBackend()), () => AT);
  return { svc, runs: new RunStore(memoryBackend()), ledger: new LedgerStore(memoryBackend()) };
}
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error((r as unknown as { error: string }).error);
  return r as Extract<T, { ok: true }>;
};
function brief(tasks: readonly StoredTask[], over: Partial<BriefInput> = {}) {
  const lines = commandBrief({ tasks, runStatuses: [], attention: 0, problems: 0, aiCostUsd: null, costEstimated: false, goals: { atRisk: 0, missed: 0, metUnconfirmed: 0, total: 0 }, now: NOW, ...over });
  return Object.fromEntries(lines.map((l) => [l.key, l]));
}

describe("personal workspace data stays compatible", () => {
  it("still loads a workspace saved with the retired client-work purpose, and no longer offers it", () => {
    const old = { ...ws(), purpose: "agency" };
    delete (old as Partial<typeof old>).categoryOverrides;
    const f = parseProduct(JSON.stringify({ version: 1, activeId: old.id, workspaces: [old], onboarding: { status: "migrated", step: 0, updatedAt: AT } }));
    expect(f.workspaces).toHaveLength(1);
    expect(f.workspaces[0].purpose).toBe("agency");
    expect(f.workspaces[0].categoryOverrides).toEqual({});
    expect(f.onboarding.status).toBe("migrated");
    expect(OFFERED_PURPOSES).not.toContain("agency");
    expect(Object.values(PURPOSE_LABEL).join(" ")).not.toMatch(/client/i);
  });

  it("saves category moves through the compare-and-set store, and drops unknown categories and buildings", () => {
    const backend = memoryBackend(JSON.stringify({ version: 1, activeId: "benjaire", workspaces: [ws()], onboarding: { status: "migrated", step: 0, updatedAt: AT } }));
    const s = new ProductStore(backend);
    const w = s.active()!;
    expect(ok(s.update(w.id, w.rev, { categoryOverrides: { "github-profile": "ai-engineering", "bad id!": "infrastructure", "soc-lab": "billing" as never } }, KHANEIL, AT)));
    expect(s.active()!.categoryOverrides).toEqual({ "github-profile": "ai-engineering" });
    expect(s.update(w.id, w.rev, { categoryOverrides: {} }, KHANEIL, AT).ok).toBe(false); // stale rev refused
    expect(s.update(w.id, w.rev + 1, { categoryOverrides: {} }, { kind: "agent", id: "x", name: "x" }, AT).ok).toBe(false); // only a person
    const exported = exportWorkspace(s.active()!, AT);
    const back = checkImport(exported.ok ? exported.json : "", catalog);
    expect(back.ok && back.workspace.categoryOverrides).toEqual({ "github-profile": "ai-engineering" });
    expect(parseWorkspace({ ...ws(), categoryOverrides: { ghost: "infrastructure" } })!.categoryOverrides).toEqual({ ghost: "infrastructure" });
    const imported = checkImport(JSON.stringify({ format: "atlas-workspace", version: 1, workspace: { ...ws(), categoryOverrides: { ghost: "infrastructure" } } }), catalog);
    if (imported.ok) expect(imported.workspace.categoryOverrides).toEqual({});
  });
});

describe("portfolio: category, business, building", () => {
  it("places every building once, by district, without moving anything on the map", () => {
    const p = portfolio(catalog, ws(), []);
    const all = p.categories.flatMap((c) => c.businesses.flatMap((b) => b.projects.map((x) => x.id)));
    expect(all.sort()).toEqual(catalog.projects.map((x) => x.id).sort());
    expect(categoryOf(project("benjaire-site"), catalog).category).toBe("business-operations");
    expect(categoryOf(project("ai-ops-atlas"), catalog).category).toBe("ai-engineering");
    expect(categoryOf(project("soc-lab"), catalog).category).toBe("infrastructure");
    expect(categoryOf(project("portfolio-site"), catalog).category).toBe("personal-operations");
    expect(p.categories.map((c) => c.label)).toEqual(Object.values(CATEGORY_INFO).map((c) => c.label));
    expect(p.problems).toEqual([]);
  });

  it("keeps Benjaire separate from unrelated projects and never guesses a business", () => {
    const p = portfolio(catalog, ws(), []);
    const biz = p.categories.find((c) => c.id === "business-operations")!.businesses;
    const benjaire = biz.find((b) => b.name === "Benjaire")!;
    expect(benjaire.projects.map((x) => x.id)).toContain("benjaire-site");
    for (const c of p.categories) for (const b of c.businesses) if (b.name === "Benjaire") expect(c.id).toBe("business-operations");
    const personal = p.categories.find((c) => c.id === "personal-operations")!.businesses.flatMap((b) => b.projects);
    expect(personal.every((x) => !x.agents.some((a) => agentOf("benjaire-site")?.id === a.id))).toBe(true);
    // Buildings whose manifest names no organization are listed as unassigned, never as Benjaire.
    for (const c of p.categories) for (const b of c.businesses) for (const x of b.projects) if (!project(x.id).organization) expect(b.name).toBe("Unassigned");
  });

  it("follows the owner's category move and reports references that point nowhere", () => {
    const w = { ...ws(), categoryOverrides: { "github-profile": "ai-engineering" as const, ghost: "infrastructure" as const } };
    const stray = { id: "t", status: "queued", buildingId: "gone", agentId: "nobody", artifacts: [] } as unknown as StoredTask;
    const p = portfolio(catalog, w, [stray]);
    const eng = p.categories.find((c) => c.id === "ai-engineering")!.businesses.flatMap((b) => b.projects);
    expect(eng.find((x) => x.id === "github-profile")?.moved).toBe(true);
    expect(p.problems.join("\n")).toMatch(/ghost/);
    expect(p.problems.join("\n")).toMatch(/1 open task name a building/);
    expect(p.problems.join("\n")).toMatch(/assigned to an agent that isn't in the catalog/);
  });
});

describe("tool library", () => {
  it("lists the buildings, agents and workflows each verified integration serves, from the catalog only", () => {
    const use = toolUse(catalog);
    expect(Object.keys(use)).toEqual(expect.arrayContaining(["github", "n8n", "cloudflare"]));
    expect(use.n8n.workflows.map((w) => w.id)).toContain("product-research-launch");
    const agentIds = new Set(catalog.agents.map((a) => a.id));
    for (const u of Object.values(use)) for (const a of u.agents) expect(agentIds.has(a.id)).toBe(true);
  });
});

describe("end-to-end scenarios on the real Task Center (mock adapters, no side effects)", () => {
  it("A. Benjaire product development: goal to research tasks to approval shows up in the brief and portfolio", () => {
    const { svc, runs, ledger } = app();
    const started = startLiveRun(BENJAIRE_LAUNCH_GOAL, BENJAIRE_LAUNCH, svc, runs, catalog, KHANEIL, AT);
    expect(started.error).toBeNull();
    const run = started.run!;
    const tasks = svc.repo.list();
    expect(tasks.length).toBeGreaterThan(5);
    // Before a person authorises it, the run reports "not started" and nothing is "running".
    const l = ledger.get(run.id);
    expect(runStatus(run, byId(tasks), l)).toBe("not_started");
    const b = brief(tasks, { runStatuses: [runStatus(run, byId(tasks), l)] });
    expect(b.agents.count).toBeGreaterThan(0);
    expect(b.workflows.count).toBe(0);
    const p = portfolio(catalog, ws(), tasks);
    const bizProjects = p.categories.find((c) => c.id === "business-operations")!.businesses.flatMap((x) => x.projects);
    expect(bizProjects.reduce((n, x) => n + x.openTasks, 0)).toBeGreaterThan(0);
    const publish = tasks.find((t) => t.requiresApproval)!;
    expect(publish).toBeDefined();
  });

  it("B. Atlas engineering: a repository event makes a task that needs approval before release", () => {
    const { svc } = app();
    const eng = agentOf("ai-ops-atlas");
    const t = ok(svc.create({ title: "CI failed on main", source: "github", agentId: eng.id, buildingId: "ai-ops-atlas", requiresApproval: true, categories: ["production_deploy"], intakeKey: "gh:run:1" }, GITHUB)).task;
    // Same event twice never makes a second task.
    expect(svc.create({ title: "CI failed on main", source: "github", agentId: eng.id, buildingId: "ai-ops-atlas", intakeKey: "gh:run:1" }, GITHUB).ok).toBe(false);
    ok(svc.apply(t.id, (x) => requestApproval(x, GITHUB, AT)));
    let b = brief(svc.repo.list());
    expect(b.attention.answer).toMatch(/1 approval/);
    // An agent can't approve its own release; the owner can.
    expect(svc.apply(t.id, (x) => decideApproval(x, "granted", { kind: "agent", id: eng.id, name: eng.name }, AT)).ok).toBe(false);
    ok(svc.apply(t.id, (x) => decideApproval(x, "granted", KHANEIL, AT)));
    b = brief(svc.repo.list());
    expect(b.attention.answer).not.toMatch(/approval/);
  });

  it("C. Personal project: goal to tasks to deliverable to done, counted as progress and output", () => {
    const { svc } = app();
    const t = ok(svc.create({ title: "Draft portfolio case study", buildingId: "portfolio-site" }, KHANEIL)).task;
    ok(svc.apply(t.id, (x, all) => beginAttempt(x, all, "manual", KHANEIL, AT, null)));
    const attempt = svc.repo.get(t.id)!.attempts.at(-1)!;
    ok(svc.apply(t.id, (x) => updateAttempt(x, attempt.id, { state: "succeeded" }, KHANEIL, AT)));
    ok(svc.apply(t.id, (x) => addArtifact(x, "Case study draft", "https://docs.google.com/document/d/x", KHANEIL, AT)));
    const done = svc.repo.get(t.id)!;
    if (done.status !== "completed") ok(svc.apply(t.id, (x) => transition(x, "completed", KHANEIL, AT)));
    const b = brief(svc.repo.list());
    expect(b.projects.count).toBe(1);
    expect(b.outputs.count).toBe(1);
    const p = portfolio(catalog, ws(), svc.repo.list());
    const row = p.categories.find((c) => c.id === "personal-operations")!.businesses.flatMap((x) => x.projects).find((x) => x.id === "portfolio-site")!;
    expect(row.completedTasks).toBe(1);
    expect(row.artifacts).toBe(1);
  });

  it("D. Infrastructure monitoring: an n8n incident blocks, waits on authorised recovery, then clears", () => {
    const { svc } = app();
    const t = ok(svc.create({ title: "Health check failing: n8n", source: "n8n", buildingId: "soc-lab", requiresApproval: true, categories: ["infrastructure"] }, N8N)).task;
    ok(svc.apply(t.id, (x) => requestApproval(x, N8N, AT)));
    expect(brief(svc.repo.list(), { problems: 1 }).problems.tone).toBe("warn");
    expect(svc.apply(t.id, (x) => decideApproval(x, "granted", N8N, AT)).ok).toBe(false);
    ok(svc.apply(t.id, (x) => decideApproval(x, "granted", KHANEIL, AT)));
    const b = brief(svc.repo.list(), { problems: 0 });
    expect(b.problems.answer).toBe("No open agent alerts.");
    expect(portfolio(catalog, ws(), svc.repo.list()).categories.find((c) => c.id === "infrastructure")!.businesses.flatMap((x) => x.projects).find((x) => x.id === "soc-lab")!.openTasks).toBe(1);
  });
});

describe("command brief answers only from records", () => {
  it("says nothing is happening when nothing is recorded, and never invents cost or goals", () => {
    const b = brief([]);
    expect(Object.keys(b)).toHaveLength(8);
    expect(b.costs.answer).toMatch(/No AI cost has been recorded/);
    expect(b.goals.answer).toBe("No business goals set yet.");
    expect(Object.values(b).every((l) => l.tone !== "warn" || l.key === "problems")).toBe(true);
  });
  it("counts waiting runs and goals that need the owner", () => {
    const b = brief([], { runStatuses: ["running", "waiting_on_person", "completed"], aiCostUsd: 1.234, costEstimated: true, goals: { atRisk: 1, missed: 0, metUnconfirmed: 1, total: 3 } });
    expect(b.workflows.answer).toBe("1 run in progress, 1 waiting on you or blocked.");
    expect(b.costs.answer).toBe("$1.23 of AI usage recorded on tasks this month (partly estimated).");
    expect(b.goals.answer).toBe("1 at risk, 1 met, waiting for you to confirm.");
  });
});
