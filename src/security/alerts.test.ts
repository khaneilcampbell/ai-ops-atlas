import { describe, expect, it } from "vitest";
import { feedNote, repoSecurity, repoTotals, securityRepos, severityText } from "./alerts";
import type { AlertFeed, RepoAlerts, Severity } from "./types";

const ok = (open: number, severity: Partial<Record<Severity, number>> = {}): AlertFeed => ({ state: "ok", open, more: false, severity });
const repo = (feeds: Partial<RepoAlerts["feeds"]>): RepoAlerts => ({ repo: "o/r", feeds: { dependabot: ok(0), "code-scanning": ok(0), "secret-scanning": ok(0), ...feeds } });

describe("security alerts in the page", () => {
  it("asks about each catalog repository once", () => {
    expect(securityRepos(["o/b", "o/a", "o/b", undefined, "", "not a repo"])).toEqual(["o/a", "o/b"]);
  });

  it("calls a repository clear only when every feed was read and none has alerts", () => {
    expect(repoSecurity(repo({}))).toBe("clear");
    expect(repoSecurity(repo({ "secret-scanning": { state: "off", reason: "x" } }))).toBe("unknown");
    expect(repoSecurity(repo({ "code-scanning": { state: "no-access", reason: "x" }, dependabot: ok(2, { high: 2 }) }))).toBe("attention");
  });

  it("adds up readable feeds and names severities most severe first", () => {
    const r = repo({ dependabot: ok(3, { medium: 2, high: 1 }), "code-scanning": ok(1, { critical: 1 }), "secret-scanning": { state: "error", reason: "x" } });
    expect(repoTotals(r)).toMatchObject({ open: 4, read: 2, severity: { critical: 1, high: 1, medium: 2 } });
    expect(severityText(repoTotals(r).severity)).toBe("1 critical, 1 high, 2 medium");
    expect([feedNote(ok(0)), feedNote({ state: "ok", open: 100, more: true, severity: {} }), feedNote({ state: "off", reason: "" }), feedNote({ state: "no-access", reason: "" })]).toEqual(["0 open", "100+ open", "off", "no access"]);
  });
});
