import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import type { HealthLoad, HealthReport } from "../observability/health";
import { memoryBackend } from "../tasks/store";
import { KHANEIL, type Actor } from "../tasks/types";
import { BENJAIRE_LAUNCH } from "../workflows/benjaireLaunch";
import { INTEGRATION_CATALOG, integrationState, integrationStates, statusBadge, type ProbeInput } from "./integrations";
import { catalogEntries, CONFIG_PRESETS, filterEntries } from "./marketplace";
import { checkImport, exportWorkspace, readiness } from "./readiness";
import { compatibility, runProblem, simulateTemplate, stepProblem, taskAgentProblem, templateById, TEMPLATES } from "./templates";
import { agentBlocked, agentSettingsProblem, existingWorkspace, hasExistingData, parseProduct, ProductStore, workspaceProblem, type WorkspaceInput } from "./workspace";

const AT = "2026-11-16T12:00:00.000Z";
const BOT: Actor = { kind: "agent", id: "agent-operations-lead", name: "Agent Operations Lead" };
const INPUT: WorkspaceInput = { name: "Northwind Studio", primaryBusiness: "Northwind", purpose: "agency", environment: "production", timeZone: "America/Chicago", description: "Client automation" };
const LAUNCH_AGENTS = [...new Set(BENJAIRE_LAUNCH.nodes.map((n) => n.agentId).filter((x): x is string => !!x))];

function store(raw: string | null = null) {
  const backend = memoryBackend(raw);
  return { s: new ProductStore(backend), backend };
}

function report(over: Partial<Record<string, "healthy" | "degraded" | "unavailable" | "unknown">> = {}, unset: string[] = []): HealthReport {
  const ids = ["access", "database", "github-api", "github-webhooks", "n8n", "n8n-bridge", "production-agents"];
  return {
    overall: "healthy",
    checkedAt: AT,
    checks: ids.map((id) => ({ id, label: id, state: over[id] ?? "healthy", detail: `${id} detail`, critical: id === "access" || id === "database", checkedAt: AT })),
    credentials: ["access", "allowed-emails", "sync", "github-token", "n8n-key", "n8n-bridge", "cloudflare", "alerts"].map((id) => ({ id, label: id, configured: !unset.includes(id), scope: "" })),
    metrics: { workflowSuccessRate: 1, workflowFailures24h: 0, runningExecutions: 0, lastAgentRunAt: null },
  };
}

function probe(over: Partial<ProbeInput> = {}): ProbeInput {
  return { platform: "web", health: { kind: "ok", report: report() }, githubToken: null, github: { loaded: 10, failing: 0, lastFetched: AT, reasons: [] }, anthropicKey: null, intelLast: null, siteLinked: null, ...over };
}

function readyWorkspace() {
  const { s } = store();
  const r = s.create(INPUT, KHANEIL, AT, { allowedAgents: LAUNCH_AGENTS, enabledIntegrations: ["n8n", "github"], templates: ["product-research-launch"] });
  if (!r.ok) throw new Error(r.error);
  return { s, w: s.active()! };
}

describe("onboarding and setup persistence", () => {
  it("a fresh device starts not started; creating a workspace and finishing setup is saved", () => {
    const { s, backend } = store();
    expect(s.snapshot.onboarding.status).toBe("not_started");
    expect(s.setOnboarding("in_progress", 2, AT).ok).toBe(true);
    const r = s.create(INPUT, KHANEIL, AT);
    expect(r.ok).toBe(true);
    expect(s.setOnboarding("completed", 5, AT).ok).toBe(true);
    const reloaded = new ProductStore(backend);
    expect(reloaded.snapshot.onboarding).toMatchObject({ status: "completed", completedAt: AT });
    expect(reloaded.active()).toMatchObject({ name: "Northwind Studio", primaryBusiness: "Northwind", environment: "production", ownerRef: "khaneil" });
  });

  it("resumes an unfinished setup at the step it stopped on", () => {
    const { s, backend } = store();
    s.setOnboarding("in_progress", 3, AT);
    expect(new ProductStore(backend).snapshot.onboarding).toMatchObject({ status: "in_progress", step: 3 });
  });

  it("corrupt or unknown-version files fall back to a fresh state instead of crashing", () => {
    expect(parseProduct("{not json").workspaces).toEqual([]);
    expect(parseProduct(JSON.stringify({ version: 99, workspaces: [{ id: "x" }] })).workspaces).toEqual([]);
  });
});

describe("workspace configuration", () => {
  it("validates names, business, purpose, environment and time zone", () => {
    expect(workspaceProblem(INPUT)).toBeNull();
    expect(workspaceProblem({ ...INPUT, name: " " })).toMatch(/name/);
    expect(workspaceProblem({ ...INPUT, primaryBusiness: "" })).toMatch(/business/);
    expect(workspaceProblem({ ...INPUT, timeZone: "Mars/Olympus" })).toMatch(/time zone/);
    expect(workspaceProblem({ ...INPUT, environment: "prod" as never })).toMatch(/environment/);
  });

  it("refuses anything that looks like a key in workspace text", () => {
    expect(workspaceProblem({ ...INPUT, description: "token ghp_" + "a".repeat(36) })).toMatch(/key or password/);
  });

  it("edits are compare-and-set, and only a person can make them", () => {
    const { s } = store();
    s.create(INPUT, KHANEIL, AT);
    const w = s.active()!;
    expect(s.update(w.id, w.rev, { name: "Northwind HQ" }, KHANEIL, AT).ok).toBe(true);
    const stale = s.update(w.id, w.rev, { name: "Again" }, KHANEIL, AT);
    expect(stale.ok).toBe(false);
    expect(s.update(w.id, w.rev + 1, { name: "Bot" }, BOT, AT).ok).toBe(false);
    expect(s.create(INPUT, BOT, AT).ok).toBe(false);
    expect(s.active()!.name).toBe("Northwind HQ");
  });

  it("creates distinct ids and switches the active workspace", () => {
    const { s } = store();
    s.create(INPUT, KHANEIL, AT);
    const second = s.create(INPUT, KHANEIL, AT);
    expect(second.ok && second.id).toBe("northwind-studio-2");
    expect(s.select("northwind-studio").ok).toBe(true);
    expect(s.active()!.id).toBe("northwind-studio");
  });
});

describe("existing data migration", () => {
  it("only an install that was used counts as existing", () => {
    expect(hasExistingData([])).toBe(false);
    expect(hasExistingData(["atlas:product"])).toBe(false);
    expect(hasExistingData(["other:tasks"])).toBe(false);
    expect(hasExistingData(["atlas:tasks"])).toBe(true);
    expect(hasExistingData(["atlas:mapMode", "atlas:timeZone"])).toBe(true);
  });

  it("keeps every existing project and agent id in a Benjaire workspace and skips the wizard", () => {
    const { s } = store();
    const projects = catalog.projects.map((p) => p.id);
    const agents = catalog.agents.map((a) => a.id);
    expect(s.migrate({ projects, agents, integrations: ["github"], templates: ["product-research-launch"], timeZone: "America/New_York" }, KHANEIL, AT).ok).toBe(true);
    const w = s.active()!;
    expect(w.id).toBe("benjaire");
    expect(w.projects).toEqual(projects);
    expect(w.allowedAgents).toEqual(agents);
    expect(s.snapshot.onboarding.status).toBe("migrated");
    // Migration never runs twice or replaces a workspace.
    s.update(w.id, w.rev, { name: "Benjaire Ops" }, KHANEIL, AT);
    s.migrate({ projects: [], agents: [], integrations: [], templates: [], timeZone: "UTC" }, KHANEIL, AT);
    expect(s.active()!.name).toBe("Benjaire Ops");
    expect(s.active()!.allowedAgents.length).toBe(agents.length);
  });

  it("the migrated workspace lets every agent run, so existing workflows behave as before", () => {
    const w = existingWorkspace({ projects: [], agents: catalog.agents.map((a) => a.id), integrations: [], templates: [], timeZone: "bogus" }, KHANEIL, AT);
    expect(w.defaults.timeZone).toBe("America/New_York");
    expect(runProblem(BENJAIRE_LAUNCH, w, catalog)).toBeNull();
    expect(runProblem(BENJAIRE_LAUNCH, null, catalog)).toBeNull();
  });
});

describe("integration validation", () => {
  it("only implemented integrations are in the catalog, each with an existing adapter", () => {
    for (const d of INTEGRATION_CATALOG)
      for (const path of d.adapter.split(",").map((p) => p.trim().replace(/ \(.*$/, ""))) {
        expect(() => readFileSync(path), `${d.id}: ${path}`).not.toThrow();
      }
  });

  it("connected without a verifying check never claims verification", () => {
    const s = integrationState(INTEGRATION_CATALOG.find((d) => d.id === "email-alerts")!, probe());
    expect(s.status).toBe("connected");
    expect(s.verifiedAt).toBeNull();
    const n8n = integrationState(INTEGRATION_CATALOG.find((d) => d.id === "n8n")!, probe());
    expect(n8n.verifiedAt).toBe(AT);
    // The card never says "Connected" for a key no check has reached; a checked one does.
    expect(statusBadge(s)).toEqual({ label: "Key set · not verified", dot: "h-unknown" });
    expect(statusBadge(n8n)).toEqual({ label: "Connected", dot: "h-good" });
    expect(statusBadge({ status: "degraded", verifiedAt: null }).label).toBe("Degraded");
  });

  it("maps failing checks and missing keys to the right statuses", () => {
    const by = (p: ProbeInput) => Object.fromEntries(integrationStates(p).map((s) => [s.def.id, s.status]));
    expect(by(probe({ health: { kind: "ok", report: report({ n8n: "unavailable" }) } })).n8n).toBe("disconnected");
    expect(by(probe({ health: { kind: "ok", report: report({ "n8n-bridge": "degraded" }) } })).n8n).toBe("degraded");
    expect(by(probe({ health: { kind: "ok", report: report({}, ["n8n-key", "github-token"]) } }))).toMatchObject({ n8n: "configuration_required", github: "configuration_required" });
    expect(by(probe({ health: { kind: "error", message: "502" } }))).toMatchObject({ n8n: "degraded", cloudflare: "degraded" });
    expect(by(probe()).anthropic).toBe("unsupported");
    expect(by(probe({ platform: "local" })).github).toBe("unsupported");
  });

  it("desktop reads Keychain presence, GitHub sync results and Intel runs", () => {
    const d = (over: Partial<ProbeInput>) => Object.fromEntries(integrationStates(probe({ platform: "desktop", health: { kind: "not-configured", message: "no sync" }, siteLinked: false, githubToken: true, anthropicKey: true, ...over })).map((s) => [s.def.id, s]));
    expect(d({}).github.status).toBe("connected");
    expect(d({ github: { loaded: 3, failing: 2, lastFetched: AT, reasons: ["Bad credentials"] } }).github).toMatchObject({ status: "degraded", diagnostics: ["Bad credentials"] });
    expect(d({ githubToken: false }).github.status).toBe("configuration_required");
    expect(d({ intelLast: { at: AT, ok: false, error: "401" } }).anthropic.status).toBe("degraded");
    expect(d({ intelLast: { at: AT, ok: true } }).anthropic).toMatchObject({ status: "connected", verifiedAt: AT });
    expect(d({}).n8n.status).toBe("configuration_required");
    expect(d({}).n8n.detail).toMatch(/isn't linked/);
  });
});

describe("sensitive credential handling", () => {
  it("integration descriptions carry no secret values", () => {
    expect(JSON.stringify(INTEGRATION_CATALOG)).not.toMatch(/ghp_|sk-ant|github_pat_|Bearer [A-Za-z0-9]/);
  });

  it("the product store never holds credentials: a key in any text field is refused", () => {
    const { s, backend } = store();
    s.create(INPUT, KHANEIL, AT, { allowedAgents: LAUNCH_AGENTS });
    const w = s.active()!;
    const r = s.configureAgent(w.id, w.rev, LAUNCH_AGENTS[0], { enabled: true, maxModelTier: 2, note: "sk-ant-api03-" + "x".repeat(40) }, KHANEIL, AT);
    expect(r.ok).toBe(false);
    expect(backend.read()).not.toMatch(/sk-ant/);
  });

  it("export refuses a workspace holding something shaped like a key", () => {
    const { w } = readyWorkspace();
    expect(exportWorkspace(w, AT).ok).toBe(true);
    expect(exportWorkspace({ ...w, description: "AKIA" + "ABCDEFGHIJKLMNOP" }, AT).ok).toBe(false);
  });
});

describe("agent configuration permissions", () => {
  it("only enabled, model limit and note can change; protected fields are refused", () => {
    expect(agentSettingsProblem({ enabled: true, maxModelTier: 1, note: "" })).toBeNull();
    expect(agentSettingsProblem({ enabled: true, maxModelTier: 1, note: "", tools: ["shop.publish"] })).toMatch(/protected/);
    expect(agentSettingsProblem({ enabled: true, maxModelTier: 3, note: "" })).toMatch(/0, 1 or 2/);
  });

  it("agents and automations can't change settings; people can, and it is recorded", () => {
    const { s } = readyWorkspace();
    const w = s.active()!;
    const id = LAUNCH_AGENTS[1];
    expect(s.configureAgent(w.id, w.rev, id, { enabled: false, maxModelTier: 2, note: "" }, BOT, AT).ok).toBe(false);
    expect(s.configureAgent(w.id, w.rev, id, { enabled: false, maxModelTier: 1, note: "pause" }, KHANEIL, AT).ok).toBe(true);
    const after = s.active()!;
    expect(after.history).toHaveLength(1);
    expect(after.history[0]).toMatchObject({ agentId: id, actor: "Khaneil", summary: "Disabled · Model limit advanced AI → lightweight AI · Note changed" });
    expect(agentBlocked(after, id)).toMatch(/turned off/);
  });

  it("a turned-off agent or a tier above the limit stops a live run from starting", () => {
    const { s } = readyWorkspace();
    let w = s.active()!;
    expect(runProblem(BENJAIRE_LAUNCH, w, catalog)).toBeNull();
    s.configureAgent(w.id, w.rev, "benjaire-product-lab-scoring", { enabled: true, maxModelTier: 0, note: "" }, KHANEIL, AT);
    w = s.active()!;
    expect(runProblem(BENJAIRE_LAUNCH, w, catalog)).toMatch(/limited to Tier 0/);
    s.configureAgent(w.id, w.rev, "benjaire-product-lab-scoring", { enabled: false, maxModelTier: 2, note: "" }, KHANEIL, AT);
    expect(runProblem(BENJAIRE_LAUNCH, s.active()!, catalog)).toMatch(/turned off/);
  });

  it("the same switch holds single steps and Task Center tasks, not only the Start button", () => {
    const { s } = readyWorkspace();
    const w = s.active()!;
    const scoring = BENJAIRE_LAUNCH.nodes.find((n) => n.id === "scoring")!;
    expect(stepProblem(scoring, w, catalog)).toBeNull();
    expect(taskAgentProblem("benjaire-product-lab-scoring", w, catalog)).toBeNull();
    s.configureAgent(w.id, w.rev, "benjaire-product-lab-scoring", { enabled: false, maxModelTier: 2, note: "" }, KHANEIL, AT);
    expect(stepProblem(scoring, s.active()!, catalog)).toMatch(/turned off/);
    expect(taskAgentProblem("benjaire-product-lab-scoring", s.active()!, catalog)).toMatch(/can't take new tasks/);
    // Another agent's step and a task with no agent are untouched; no workspace means no limits.
    expect(stepProblem(BENJAIRE_LAUNCH.nodes.find((n) => n.id === "brief")!, s.active()!, catalog)).toBeNull();
    expect(taskAgentProblem(undefined, s.active()!, catalog)).toBeNull();
    expect(stepProblem(scoring, null, catalog)).toBeNull();
  });

  it("presets are only the allowed settings", () => {
    for (const p of CONFIG_PRESETS) expect(agentSettingsProblem({ ...p.settings, note: "" })).toBeNull();
  });
});

describe("workflow template compatibility and simulation", () => {
  it("only templates backed by a real definition are executable", () => {
    for (const t of TEMPLATES) {
      const c = compatibility(t, null, catalog, []);
      expect(c.executable, t.id).toBe(!!t.definitionId);
    }
  });

  it("the reference template is generic: no business name in its text, filled from the workspace", () => {
    const t = templateById("product-research-launch")!;
    expect(`${t.name} ${t.description} ${t.instructions.join(" ")}`).not.toMatch(/Benjaire/);
    expect(t.inputs.find((i) => i.id === "business")?.fromWorkspace).toBe("primaryBusiness");
  });

  it("is ready only when its agents are in the workspace and on", () => {
    const { s, w } = readyWorkspace();
    const t = templateById("product-research-launch")!;
    expect(compatibility(t, w, catalog, []).ready).toBe(true);
    s.update(w.id, w.rev, { allowedAgents: LAUNCH_AGENTS.slice(1) }, KHANEIL, AT);
    const c = compatibility(t, s.active()!, catalog, []);
    expect(c.ready).toBe(false);
    expect(c.problems.join(" ")).toMatch(/isn't added/);
  });

  it("simulation is computed only: no storage write, no tasks, every event marked simulated", () => {
    const calls: string[] = [];
    const g = globalThis as { localStorage?: unknown; fetch?: unknown };
    const saved = { ls: g.localStorage, f: g.fetch };
    g.localStorage = new Proxy({}, { get: (_t, k) => (calls.push(`localStorage.${String(k)}`), () => null) });
    g.fetch = () => (calls.push("fetch"), Promise.reject(new Error("no network in simulation")));
    try {
      const sim = simulateTemplate(templateById("product-research-launch")!, { viable: true, standIn: true }, (id) => id)!;
      expect(sim.events.length).toBeGreaterThan(5);
      expect(sim.events.every((e) => e.simulated)).toBe(true);
      expect(sim.step).toBe(sim.maxStep);
      expect(calls).toEqual([]);
    } finally {
      g.localStorage = saved.ls;
      g.fetch = saved.f;
    }
    expect(simulateTemplate(templateById("infrastructure-monitoring")!, { viable: true, standIn: true }, (id) => id)).toBeNull();
  });
});

describe("first-run validation and navigation", () => {
  const health: HealthLoad = { kind: "ok", report: report() };
  it("walks the recommended first action from workspace to integrations, agents, templates and simulation", () => {
    expect(readiness(null, catalog, [], health).next.target).toBe("integrations");
    const { s } = store();
    s.create(INPUT, KHANEIL, AT);
    let w = s.active()!;
    expect(readiness(w, catalog, integrationStates(probe()), health).next.label).toBe("Connect one integration");
    s.update(w.id, w.rev, { enabledIntegrations: ["n8n"] }, KHANEIL, AT);
    w = s.active()!;
    expect(readiness(w, catalog, integrationStates(probe()), health).next.target).toBe("agents");
    s.update(w.id, w.rev, { allowedAgents: LAUNCH_AGENTS }, KHANEIL, AT);
    w = s.active()!;
    expect(readiness(w, catalog, integrationStates(probe()), health).next.target).toBe("templates");
    s.update(w.id, w.rev, { templates: ["product-research-launch"] }, KHANEIL, AT);
    const r = readiness(s.active()!, catalog, integrationStates(probe()), health);
    expect(r.workflows.ready.map((t) => t.id)).toEqual(["product-research-launch"]);
    expect(r.next.label).toBe("Simulate Product Research & Launch");
  });

  it("reports security warnings from the site's real credential state", () => {
    const { w } = readyWorkspace();
    const r = readiness(w, catalog, [], { kind: "ok", report: report({}, ["allowed-emails"]) });
    expect(r.warnings.join(" ")).toMatch(/ALLOWED_EMAILS/);
  });
});

describe("configuration import safety", () => {
  const exported = () => {
    const { w } = readyWorkspace();
    const r = exportWorkspace(w, AT);
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(r.json) as { workspace: Record<string, unknown> } & Record<string, unknown>;
  };

  it("round-trips a workspace", () => {
    const r = checkImport(JSON.stringify(exported()), catalog);
    expect(r.ok && r.workspace.allowedAgents).toEqual(LAUNCH_AGENTS);
    expect(r.ok && r.dropped).toEqual([]);
  });

  it("drops unknown agents, integrations and templates, and refuses protected settings", () => {
    const f = exported();
    f.workspace.allowedAgents = [...LAUNCH_AGENTS, "evil-agent"];
    f.workspace.enabledIntegrations = ["n8n", "openai"];
    f.workspace.templates = ["product-research-launch", "run-shell"];
    f.workspace.agentSettings = { [LAUNCH_AGENTS[0]]: { enabled: true, maxModelTier: 2, note: "", tools: ["shop.publish"], permissions: ["publish"] } };
    const r = checkImport(JSON.stringify(f), catalog);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.workspace.allowedAgents).not.toContain("evil-agent");
    expect(r.workspace.enabledIntegrations).toEqual(["n8n"]);
    expect(r.workspace.templates).toEqual(["product-research-launch"]);
    expect(r.workspace.agentSettings).toEqual({});
    expect(r.dropped.join(" ")).toMatch(/protected/);
  });

  it("refuses files with keys, the wrong format, or too much data", () => {
    expect(checkImport(JSON.stringify({ ...exported(), note: "ghp_" + "b".repeat(36) }), catalog).ok).toBe(false);
    expect(checkImport(JSON.stringify({ format: "something-else" }), catalog).ok).toBe(false);
    expect(checkImport("x".repeat(300_000), catalog).ok).toBe(false);
    expect(checkImport("not json", catalog).ok).toBe(false);
  });

  it("an import is a new workspace for the importing person; it never replaces or activates one", () => {
    const { s } = readyWorkspace();
    const before = s.active()!.id;
    const r = checkImport(JSON.stringify(exported()), catalog);
    if (!r.ok) throw new Error(r.error);
    const added = s.addImported(r.workspace, KHANEIL, AT);
    expect(added.ok && added.id).toBe("northwind-studio-2");
    expect(s.active()!.id).toBe(before);
    expect(s.addImported(r.workspace, BOT, AT).ok).toBe(false);
  });
});

describe("agent catalog", () => {
  it("lists registered agents, marks installed ones, and filters", () => {
    const { w } = readyWorkspace();
    const entries = catalogEntries(catalog, w);
    expect(entries.filter((e) => e.installed).map((e) => e.id).sort()).toEqual([...LAUNCH_AGENTS].filter((id) => catalog.agents.some((a) => a.id === id && a.status !== "retired")).sort());
    expect(entries.every((e) => e.version && e.environment)).toBe(true);
    expect(filterEntries(entries, "", "", "available").every((e) => !e.installed)).toBe(true);
    const research = entries.find((e) => e.id === "benjaire-product-lab-research")!;
    expect(research.requiredIntegrations).toContain("n8n");
  });
});

describe("desktop and web build compatibility", () => {
  const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  it("desktop config: metadata, CSP without remote sources, updater key unchanged", () => {
    expect(tauri.productName).toBe("Atlas");
    expect(tauri.identifier).toBe("com.khaneilcampbell.ai-ops-atlas");
    expect(tauri.build.frontendDist).toBe("../dist");
    expect(tauri.app.security.csp).toMatch(/default-src 'self'/);
    expect(tauri.app.security.csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
    expect(tauri.plugins.updater.pubkey.length).toBeGreaterThan(40);
    expect(tauri.plugins.updater.endpoints[0]).toMatch(/^https:\/\/github\.com\/.+\/latest\.json$/);
  });

  it("web headers: strict CSP, no framing, no-store on the API", () => {
    const headers = readFileSync("public/_headers", "utf8");
    expect(headers).toMatch(/Content-Security-Policy: default-src 'self'/);
    expect(headers).toMatch(/frame-ancestors 'none'/);
    expect(headers).toMatch(/\/api\/\*\s+Cache-Control: private, no-store/);
  });

  it("the setup and workspace screens load lazily, so the map's first paint doesn't include them", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/views\/product\/Workspace"\)/);
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/views\/product\/Onboarding"\)/);
  });
});
