import { afterEach, describe, expect, it, vi } from "vitest";
import { GithubError } from "../github/transport";
import type { Manifest } from "./manifest";

const get = vi.fn();
vi.mock("../github/transport", async (orig) => ({ ...(await orig<typeof import("../github/transport")>()), githubGet: (p: string) => get(p) }));
const { fetchManageData, manageRows } = await import("./data");

const M: Manifest = {
  version: 1,
  repository: "o/r",
  agents: [
    { id: "a", workflow: "a.yml", schedule: "0 */4 * * *", paid: true, cap: { file: "ops/a/policy.json", key: "cap", usd: 1, maxUsd: 5 } },
    { id: "b", workflow: "b.yml", schedule: "*/15 * * * *", paid: false },
  ],
};
const NOW = Date.parse("2026-10-30T10:00:00Z");
const run = (status: string, conclusion: string | null) => ({ id: 1, name: "x", status, conclusion, head_branch: "main", event: "schedule", created_at: "2026-10-30T09:00:00Z", html_url: `u${status}${conclusion}` });

afterEach(() => get.mockReset());

describe("fetchManageData", () => {
  it("asks for the workflow list and each agent's runs on main, nothing else", async () => {
    get.mockImplementation(async (p: string) =>
      p.endsWith("/workflows?per_page=100")
        ? { workflows: [{ path: ".github/workflows/a.yml", state: "active", html_url: "wa" }, { path: ".github/workflows/b.yml", state: "disabled_manually", html_url: "wb" }] }
        : { workflow_runs: [run("completed", "success")] },
    );
    const d = await fetchManageData(M, NOW);
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/repos/o/r/actions/workflows/a.yml/runs?branch=main&per_page=10",
      "/repos/o/r/actions/workflows/b.yml/runs?branch=main&per_page=10",
      "/repos/o/r/actions/workflows?per_page=100",
    ]);
    expect(d.workflows).toEqual({ "a.yml": { state: "active", url: "wa" }, "b.yml": { state: "disabled_manually", url: "wb" } });
    expect(d.problems).toEqual([]);
    const rows = manageRows(M, d, NOW);
    expect(rows.map((r) => r.status)).toEqual(["ok", "disabled"]);
    expect(rows[0].nextRunAt).toBe("2026-10-30T12:00:00.000Z");
    expect(rows[1].nextRunAt).toBeNull();
  });

  it("keeps going when GitHub refuses, and says why", async () => {
    get.mockImplementation(async (p: string) => {
      if (p.includes("/workflows?")) throw new GithubError("The saved GitHub token was rejected", 401);
      if (p.includes("b.yml")) throw new GithubError("down", 0);
      return { workflow_runs: [] };
    });
    const d = await fetchManageData(M, NOW);
    expect(d.workflows).toBeNull();
    expect(d.problems.join(" ")).toMatch(/refused the request \(401\)/);
    expect(d.problems.join(" ")).toMatch(/runs of b.yml. down/);
    const rows = manageRows(M, d, NOW);
    // Without the workflow list, state is not guessed.
    expect(rows.map((r) => r.status)).toEqual(["unknown", "unknown"]);
    expect(rows[1].runs).toBeNull();
  });
});

describe("manageRows", () => {
  const data = (runs: object[], state = "active") => ({ workflows: { "a.yml": { state, url: "" } }, runs: { "a.yml": runs.map((r) => ({ ...(r as object) })) as never }, problems: [], fetchedAt: "" });
  const status = (runs: object[], state?: string) => manageRows({ ...M, agents: [M.agents[0]] }, data(runs, state), NOW)[0].status;
  const r = (status: string, conclusion: string | null) => ({ status, conclusion, createdAt: "", url: "", name: "", branch: "main", event: "schedule" });

  it("derives status from GitHub's own state and the last run", () => {
    expect(status([r("completed", "success")])).toBe("ok");
    expect(status([r("in_progress", null)])).toBe("running");
    expect(status([r("completed", "failure"), r("completed", "success")])).toBe("failing");
    expect(status([r("completed", "timed_out")])).toBe("failing");
    expect(status([])).toBe("never");
    expect(status([r("completed", "success")], "disabled_inactivity")).toBe("disabled");
    expect(manageRows(M, null, NOW).every((x) => x.status === "unknown")).toBe(true);
  });
});
