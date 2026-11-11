import { describe, expect, it } from "vitest";
import { INTEGRATION_IDS } from "../modules/integrations";
import { signalCounts, signalRows, type SignalInputs } from "./signals";

const NOW = Date.parse("2026-11-11T06:00:00Z");
const ok = (fetchedAt: string) => ({ kind: "ok" as const, stale: false, data: { fetchedAt } as never });
const base: SignalInputs = {
  repos: {}, tracked: ["a/x", "a/y"], staleAfterMs: 60 * 60_000,
  live: { state: "off", message: null, checkedAt: null, last: null, intelRuns: null, production: [] },
  intel: { available: false, error: null, loaded: false, keyPresent: null },
  usage: { firstLoad: true, error: null, records: 0 },
  n8n: { state: "loading", message: null, value: null },
  security: { state: "loading", message: null, value: null },
  now: NOW,
};

describe("connected signals", () => {
  it("lists every integration contract once, loading until each answers", () => {
    const rows = signalRows(base);
    expect(rows.map((r) => r.id)).toEqual([...INTEGRATION_IDS]);
    expect(rows.find((r) => r.id === "github")).toMatchObject({ state: "loading", detail: "No repository fetched yet" });
    expect(rows.find((r) => r.id === "atlas-intel")).toMatchObject({ state: "off", detail: "Runs in the Mac app" });
    expect(signalCounts(rows)).toMatchObject({ loading: 4, off: 3 });
  });

  it("calls GitHub answering, stale or failing from the repositories' own sync state", () => {
    const fresh = signalRows({ ...base, repos: { "a/x": ok("2026-11-11T05:50:00Z"), "a/y": ok("2026-11-11T05:40:00Z") } })[0];
    expect(fresh).toMatchObject({ state: "live", at: "2026-11-11T05:50:00Z", detail: "2 of 2 repositories loaded" });
    const old = signalRows({ ...base, repos: { "a/x": ok("2026-11-11T03:00:00Z") } })[0];
    expect(old).toMatchObject({ state: "stale", detail: "1 of 2 repositories loaded" });
    const partly = signalRows({ ...base, repos: { "a/x": ok("2026-11-11T05:50:00Z"), "a/y": { kind: "error", message: "HTTP 502" } } })[0];
    expect(partly).toMatchObject({ state: "failing", detail: "1 of 2 repositories loaded, 1 failed their last sync" });
    const all = signalRows({ ...base, repos: { "a/x": { kind: "error", message: "HTTP 502" }, "a/y": { kind: "error", message: "HTTP 502" } } })[0];
    expect(all).toMatchObject({ state: "failing", detail: "HTTP 502" });
  });

  it("reads n8n and security alerts as not set up, answering or failing, never as healthy without data", () => {
    const rows = signalRows({
      ...base,
      n8n: { state: "ready", message: null, value: { state: "not-configured", need: "An n8n API key as a Pages secret" } },
      security: { state: "error", message: "HTTP 500", value: null },
      live: { state: "live", message: null, checkedAt: "2026-11-11T05:59:00Z", last: { at: "2026-11-11T05:58:00Z", text: "CI passed on benjaire.com" }, intelRuns: null, production: [] },
      usage: { firstLoad: false, error: null, records: 12 },
      intel: { available: true, error: null, loaded: true, keyPresent: false },
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.n8n).toMatchObject({ state: "not-set-up", detail: "Needs an n8n API key as a Pages secret" });
    expect(by["github-security"]).toMatchObject({ state: "failing", detail: "HTTP 500" });
    expect(by["live-feed"]).toMatchObject({ state: "live", at: "2026-11-11T05:59:00Z", detail: "CI passed on benjaire.com" });
    expect(by["agent-feed"]).toMatchObject({ state: "live", detail: "Arrives with live updates" });
    expect(by["usage-sync"]).toMatchObject({ state: "live", detail: "12 usage records" });
    expect(by["atlas-intel"]).toMatchObject({ state: "not-set-up", detail: "No Anthropic key in the vault" });
  });
});
