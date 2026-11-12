import { describe, expect, it } from "vitest";
import { repoIncidents, securityIncidents } from "./incidents";
import type { AlertFeed, RepoAlerts, Severity } from "./types";

const ok = (open: number, severity: Partial<Record<Severity, number>> = {}, more = false): AlertFeed => ({ state: "ok", open, more, severity });
const repo = (name: string, feeds: Partial<RepoAlerts["feeds"]>): RepoAlerts => ({ repo: `o/${name}`, feeds: { dependabot: ok(0), "code-scanning": ok(0), "secret-scanning": ok(0), ...feeds } });

describe("security incidents", () => {
  it("raises nothing for clear, unreadable, or medium and low alerts", () => {
    expect(repoIncidents(repo("a", {}))).toEqual([]);
    expect(repoIncidents(repo("a", { "secret-scanning": { state: "no-access", reason: "x" }, "code-scanning": { state: "off", reason: "x" } }))).toEqual([]);
    expect(repoIncidents(repo("a", { dependabot: ok(5, { medium: 3, low: 2 }) }))).toEqual([]);
  });

  it("treats any open secret as critical and points at the secret scanning page", () => {
    const [i] = repoIncidents(repo("site", { "secret-scanning": ok(100, {}, true) }));
    expect(i).toMatchObject({ severity: "critical", kind: "secret-scanning", title: "Exposed secret in site", url: "https://github.com/o/site/security/secret-scanning" });
    expect(i.detail).toContain("100+ open secret scanning alerts");
    expect(repoIncidents(repo("site", { "secret-scanning": ok(1) }))[0].detail).toContain("1 open secret scanning alert.");
  });

  it("makes critical alerts critical and high ones warnings, one per feed", () => {
    const list = repoIncidents(repo("app", { dependabot: ok(4, { critical: 1, high: 2, low: 1 }), "code-scanning": ok(1, { high: 1 }) }));
    expect(list.map((i) => [i.kind, i.severity, i.detail])).toEqual([
      ["dependabot", "critical", "1 critical alert, 2 high."],
      ["code-scanning", "warning", "1 high alert."],
    ]);
  });

  it("orders critical first, then secrets, then by repository, and ignores snapshots without data", () => {
    const list = securityIncidents({
      state: "ok", fetchedAt: "2026-11-12T00:00:00Z",
      repos: [repo("b", { dependabot: ok(1, { high: 1 }) }), repo("c", { dependabot: ok(1, { critical: 1 }) }), repo("a", { "secret-scanning": ok(1) })],
    });
    expect(list.map((i) => i.key)).toEqual(["o/a:secret-scanning:critical", "o/c:dependabot:critical", "o/b:dependabot:high"]);
    expect(securityIncidents({ state: "not-configured", need: "x" })).toEqual([]);
    expect(securityIncidents(null)).toEqual([]);
  });
});
