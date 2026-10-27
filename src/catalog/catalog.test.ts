import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalog, parseManifest } from "./parse";
import type { ManifestIssue } from "./types";

const dir = join(__dirname, "../../catalog");
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
);

describe("bundled catalog", () => {
  const { catalog, issues } = buildCatalog(files);

  it("has no manifest problems", () => {
    expect(issues).toEqual([]);
  });

  it("registers the three portfolio projects", () => {
    expect(catalog.projects.map((p) => p.repository).sort()).toEqual([
      "khaneilcampbell/khaneilcampbell.com",
      "khaneilcampbell/multi-agent-commerce-pipeline",
      "khaneilcampbell/splunk-bruteforce-detection-lab",
    ]);
  });

  it("links every agent to a known project", () => {
    const ids = new Set(catalog.projects.map((p) => p.id));
    for (const a of catalog.agents) expect(ids.has(a.projectId)).toBe(true);
  });
});

describe("parseManifest", () => {
  const run = (yaml: string) => {
    const issues: ManifestIssue[] = [];
    return { ...parseManifest("t.yaml", yaml, issues), issues };
  };

  it("reports missing fields and bad values without throwing", () => {
    const r = run(`
schema: atlas/v1
project: { id: Demo, repository: not-a-repo }
`);
    expect(r.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("project.id"), expect.stringContaining("project.repository")]),
    );
  });

  it("parses dates, defaults the agent repository and rejects unknown statuses", () => {
    const r = run(`
schema: atlas/v1
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - { id: a1, name: A, purpose: p, framework: CrewAI, status: busy, last_run: 2026-10-01 }
`);
    expect(r.agents[0].repository).toBe("me/demo");
    expect(r.agents[0].lastRun).toBe("2026-10-01T00:00:00.000Z");
    expect(r.agents[0].status).toBe("idle");
    expect(r.issues[0].message).toContain("status");
  });

  it("flags invalid YAML", () => {
    expect(run("project: [").issues[0].message).toContain("invalid YAML");
  });

  it("rejects duplicate agent ids across manifests", () => {
    const m = (pid: string) => `
schema: atlas/v1
project: { id: ${pid}, name: X, summary: s, status: active, repository: me/${pid} }
agents: [{ id: same, name: A, purpose: p, framework: F, status: idle }]
`;
    const { issues } = buildCatalog({ "a.yaml": m("p1"), "b.yaml": m("p2") });
    expect(issues[0].message).toContain('"same"');
  });
});
