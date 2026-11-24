import { describe, expect, it } from "vitest";
import { catalog, manifestIssues } from "../catalog";
import { ownership } from "../catalog/ownership";
import { directoryItems } from "../catalog/roles";
import { buildRegistry } from "../registry/registry";
import { buildFlows, flowLayout, stageOf, waitsOnKhaneil } from "./flows";

const autoIds = new Set(directoryItems(catalog.agents, "automations").map((a) => a.id));
const entries = buildRegistry(catalog, {}, null).filter((e) => autoIds.has(e.profile.id));
const owns = ownership(catalog);
const flows = buildFlows(entries, catalog.agents, owns);

describe("Automations flows", () => {
  it("records only handoffs between real automations", () => {
    expect(manifestIssues.filter((i) => i.message.includes(".feeds"))).toEqual([]);
    const withFeeds = catalog.agents.filter((a) => a.feeds?.length);
    expect(withFeeds.length).toBeGreaterThan(0);
    for (const a of withFeeds) for (const to of a.feeds!) expect(autoIds.has(to), `${a.id} -> ${to}`).toBe(true);
  });

  it("draws one flow per owning agent, busiest first, with every handoff in some flow", () => {
    expect(new Set(flows.map((f) => f.ownerId)).size).toBe(flows.length);
    expect(flows[0].edges.length).toBeGreaterThan(0);
    const drawn = new Set(flows.flatMap((f) => f.edges.map((e) => `${e.from}>${e.to}`)));
    for (const a of catalog.agents) for (const to of a.feeds ?? []) if (autoIds.has(a.id)) expect(drawn.has(`${a.id}>${to}`)).toBe(true);
    for (const f of flows) for (const e of f.edges) {
      const ids = f.entries.map((x) => x.profile.id);
      expect(ids).toContain(e.from);
      expect(ids).toContain(e.to);
    }
  });

  it("marks a handoff gold only when the next step waits on Khaneil", () => {
    expect(waitsOnKhaneil({ trigger: "Khaneil approves the email" })).toBe(true);
    expect(waitsOnKhaneil({ trigger: "Every 4 hours" })).toBe(false);
    expect(waitsOnKhaneil(undefined)).toBe(false);
  });

  it("lays every step out once, left to right along handoffs", () => {
    const f = flows[0];
    const lay = flowLayout(f);
    expect(lay.nodes.map((n) => n.node.id).sort()).toEqual(f.entries.map((e) => e.profile.id).sort());
    const x = new Map(lay.nodes.map((n) => [n.node.id, n.x]));
    for (const e of f.edges) expect(x.get(e.to)!).toBeGreaterThan(x.get(e.from)!);
  });

  it("puts each automation in one lifecycle stage", () => {
    const draft = entries.find((e) => e.profile.id === "atlas-task-writer")!;
    expect(stageOf(draft)).toBe("draft");
    for (const e of entries) expect(["draft", "live", "verified"]).toContain(stageOf(e));
  });
});
