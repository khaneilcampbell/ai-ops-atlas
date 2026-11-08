import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { capProblem, HARD_MAX_CAP_USD, MANIFEST, manifestProblems, scheduleProblem, type Manifest } from "./manifest";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const dig = (o: unknown, key: string) => key.split(".").reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);

describe("the allow-list", () => {
  it("is valid", () => {
    expect(manifestProblems(MANIFEST)).toEqual([]);
  });

  it("names catalog agents that run in the listed repository", () => {
    for (const a of MANIFEST.agents) {
      const agent = catalog.agents.find((x) => x.id === a.id);
      expect(agent, a.id).toBeDefined();
      expect(agent!.repository).toBe(MANIFEST.repository);
      expect(agent!.observe?.githubWorkflow, a.id).toBe(a.workflow);
    }
  });

  it("matches each workflow's schedule on main, which has exactly one cron line", () => {
    for (const a of MANIFEST.agents) {
      const path = `.github/workflows/${a.workflow}`;
      expect(existsSync(join(root, path)), path).toBe(true);
      const wf = yaml.load(read(path)) as { on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown } };
      expect(wf.on.schedule?.map((s) => s.cron), path).toEqual([a.schedule]);
      // Run now needs a manual trigger.
      expect("workflow_dispatch" in wf.on, path).toBe(true);
      expect(read(path).split("\n").filter((l) => /^\s*- cron:/.test(l))).toHaveLength(1);
    }
  });

  it("matches each cap in its policy file", () => {
    for (const a of MANIFEST.agents.filter((x) => x.cap)) {
      const policy = JSON.parse(read(a.cap!.file));
      expect(dig(policy, a.cap!.key), `${a.cap!.file} ${a.cap!.key}`).toBe(a.cap!.usd);
    }
  });

  it("never lists Atlas's own build, release or CI workflows", () => {
    for (const a of MANIFEST.agents) expect(["ci.yml", "release.yml", "codeql.yml", "visual.yml"]).not.toContain(a.workflow);
  });

  it("reports a broken manifest", () => {
    const bad: Manifest = {
      version: 1,
      repository: "khaneilcampbell/ai-ops-atlas",
      agents: [
        { id: "x", workflow: "../ci.yml", schedule: "*/5 * * * *", paid: false, cap: { file: "/etc/passwd", key: "a..b", usd: 9, maxUsd: 50 } },
        { id: "x", workflow: "a.yml", schedule: "0 * * * *", paid: true },
      ],
    };
    const problems = manifestProblems(bad).join("\n");
    expect(problems).toMatch(/bad workflow file name/);
    expect(problems).toMatch(/at least 15 minutes apart/);
    expect(problems).toMatch(/cap file/);
    expect(problems).toMatch(/bad cap key/);
    expect(problems).toMatch(/cap maximum/);
    expect(problems).toMatch(/listed twice/);
    expect(problems).toMatch(/at least 4 hours apart for an agent that calls a paid API/);
  });
});

describe("limits", () => {
  it("keeps schedules at least the minimum interval apart", () => {
    expect(scheduleProblem({ paid: false }, "*/15 * * * *")).toBeNull();
    expect(scheduleProblem({ paid: false }, "*/10 * * * *")).toMatch(/15 minutes/);
    expect(scheduleProblem({ paid: true }, "0 */4 * * *")).toBeNull();
    expect(scheduleProblem({ paid: true }, "0 */2 * * *")).toMatch(/4 hours/);
    expect(scheduleProblem({ paid: true }, "0 0 31 2 *")).toMatch(/never runs/);
    expect(scheduleProblem({ paid: true }, "bad")).toMatch(/five parts/);
  });

  it("keeps caps in whole cents between $0 and the hard maximum", () => {
    const cap = { maxUsd: 5 };
    expect(capProblem(cap, 0)).toBeNull();
    expect(capProblem(cap, 1.5)).toBeNull();
    expect(capProblem(cap, 5)).toBeNull();
    expect(capProblem(cap, 5.01)).toMatch(/at most \$5.00/);
    expect(capProblem(cap, -1)).toMatch(/negative/);
    expect(capProblem(cap, 1.234)).toMatch(/whole cents/);
    expect(capProblem(cap, NaN)).toMatch(/number/);
    expect(capProblem(cap, Infinity)).toMatch(/number/);
    expect(capProblem(cap, "2" as unknown as number)).toMatch(/number/);
    // An entry can't raise its own maximum above the hard one.
    expect(capProblem({ maxUsd: 100 }, HARD_MAX_CAP_USD + 1)).toMatch(/at most \$5.00/);
  });
});
