import { describe, expect, it } from "vitest";
import type { Deploy } from "../properties/deploys";
import type { Incident } from "../properties/incidents";
import { HOSTS } from "./hosts";
import { hostIncidents, infraIncidents } from "./incidents";

const now = Date.parse("2026-11-10T20:00:00Z");
const d = (id: string, state: Deploy["state"], at: string): Deploy => ({ id, state, at, finishedAt: at, sha: `${id}aaaaaaa`, url: `https://github.com/x/${id}`, label: "Publish signed main build" });
const host = (id: string) => HOSTS.find((h) => h.id === id)!;

describe("infrastructure incidents", () => {
  it("raises a failed newest deploy, whatever order the deploys came in", () => {
    const list = hostIncidents(host("atlas-mac"), [d("old", "success", "2026-11-10T18:00:00Z"), d("new", "failure", "2026-11-10T19:00:00Z")], now);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "deploy-failed", severity: "critical", propertyId: "atlas-mac" });
    expect(list[0].detail).toContain("Installed Macs keep the last published build");
  });

  it("treats an old failure followed by a success as history", () => {
    expect(hostIncidents(host("atlas-web"), [d("old", "failure", "2026-11-10T18:00:00Z"), d("new", "success", "2026-11-10T19:00:00Z")], now)).toEqual([]);
  });

  it("flags a deploy stuck for over 30 minutes", () => {
    expect(hostIncidents(host("atlas-web"), [d("run", "in_progress", "2026-11-10T19:00:00Z")], now)[0]).toMatchObject({ kind: "deploy-stuck", severity: "warning" });
  });

  it("merges website incidents and puts critical ones first", () => {
    const site: Incident = { key: "s", propertyId: "benjaire-com", kind: "slow", severity: "warning", title: "Slow", detail: "", since: "2026-11-10T19:30:00Z", actions: [] };
    const list = infraIncidents([site], new Map([["atlas-mac", [d("f", "failure", "2026-11-10T19:00:00Z")]]]), now);
    expect(list.map((i) => [i.hostName, i.severity])).toEqual([["Atlas Mac app", "critical"], ["benjaire.com", "warning"]]);
  });

  it("raises nothing when no deploy was seen", () => {
    expect(infraIncidents([], new Map(), now)).toEqual([]);
  });
});
