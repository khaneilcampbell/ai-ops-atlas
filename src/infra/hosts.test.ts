import { describe, expect, it } from "vitest";
import { fromCheckRuns, type Deploy } from "../properties/deploys";
import { PROPERTIES } from "../properties/registry";
import { HOSTS, hostStatus, recentDeploys } from "./hosts";

const d = (id: string, state: Deploy["state"], at: string): Deploy => ({ id, state, at, finishedAt: at, sha: `${id}0000000`, url: "", label: "x" });

describe("hosting inventory", () => {
  it("lists every website plus Atlas web and the Mac app, without adding Atlas to the site allowlist", () => {
    expect(HOSTS.map((h) => h.id)).toEqual([...PROPERTIES.map((p) => p.id), "atlas-web", "atlas-mac"]);
    expect(PROPERTIES.some((p) => p.repository.endsWith("/ai-ops-atlas"))).toBe(false);
  });

  it("is unknown, never live, when no deploy was seen", () => {
    expect(hostStatus(null).health).toBe("unknown");
    expect(hostStatus([]).health).toBe("unknown");
    expect(hostStatus([d("a", "cancelled", "2026-11-10T10:00:00Z")]).health).toBe("unknown");
  });

  it("reads the newest deploy, and still names the last good one after a failure", () => {
    const s = hostStatus([d("old", "success", "2026-11-10T09:00:00Z"), d("new", "failure", "2026-11-10T10:00:00Z")]);
    expect(s.health).toBe("failing");
    expect(s.live?.id).toBe("old");
    expect(hostStatus([d("a", "success", "2026-11-10T09:00:00Z"), d("b", "in_progress", "2026-11-10T10:00:00Z")]).health).toBe("deploying");
    expect(hostStatus([d("a", "success", "2026-11-10T09:00:00Z"), d("b", "cancelled", "2026-11-10T10:00:00Z")]).health).toBe("live");
  });

  it("merges every host's deploys newest first", () => {
    const list = recentDeploys(new Map([["atlas-web", [d("w", "success", "2026-11-10T09:00:00Z")]], ["atlas-mac", [d("m", "failure", "2026-11-10T10:00:00Z")]]]));
    expect(list.map((x) => [x.hostName, x.id])).toEqual([["Atlas Mac app", "m"], ["Atlas web", "w"]]);
  });

  it("skips a skipped publish job when the host asks", () => {
    const j = { check_runs: [{ id: 1, name: "Publish signed main build", status: "completed", conclusion: "skipped" }, { id: 2, name: "Publish signed main build", status: "completed", conclusion: "success", started_at: "2026-11-10T10:00:00Z" }] };
    expect(fromCheckRuns(j, "abc", "Publish signed main build", true).map((x) => x.id)).toEqual(["check:2"]);
    expect(fromCheckRuns(j, "abc", "Publish signed main build")).toHaveLength(2);
  });
});
