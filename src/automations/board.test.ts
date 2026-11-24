import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { ownership } from "../catalog/ownership";
import { directoryItems } from "../catalog/roles";
import { buildRegistry, type RegistryEntry } from "../registry/registry";
import { boardKpis, buildLanes, chipMatches, isDraft, n8nUrl, runtimeFamily, shortTitle } from "./board";

const autoIds = new Set(directoryItems(catalog.agents, "automations").map((a) => a.id));
const entries = buildRegistry(catalog, {}, null).filter((e) => autoIds.has(e.profile.id));
const owns = ownership(catalog);
const byId = (id: string) => entries.find((e) => e.profile.id === id)!;
const run = (at: number, result: "success" | "failure") => ({ at: new Date(at).toISOString(), result, label: "run", source: "n8n" as const });
const withRuns = (e: RegistryEntry, runs: ReturnType<typeof run>[], operational = e.operational): RegistryEntry => ({ ...e, operational, telemetry: { ...e.telemetry, source: "n8n", loaded: true, executions: runs } });

describe("Automations board", () => {
  it("puts every automation in exactly one lane", () => {
    const lanes = buildLanes(entries, owns);
    const ids = lanes.flatMap((l) => l.automations.map((e) => e.profile.id));
    expect(ids.length).toBe(entries.length);
    expect(new Set(ids).size).toBe(entries.length);
    expect(lanes.find((l) => l.ownerId === "benjaire-inquiry-manager")?.automations).toHaveLength(6);
  });

  it("reads drafts from the catalog: paused with draft in the trigger", () => {
    expect(isDraft(byId("atlas-task-writer"))).toBe(true);
    expect(isDraft(byId("atlas-agent-factory"))).toBe(false);
    expect(chipMatches("attention", byId("atlas-task-writer"))).toBe(true);
  });

  it("puts a lane with a failing automation first", () => {
    const failing = entries.map((e) => (e.profile.id === "dataset-census" ? { ...e, operational: "failing" as const } : e));
    expect(buildLanes(failing, owns)[0].ownerId).toBe("atlas-health-monitor");
  });

  it("shows no run counts until live runs are loaded", () => {
    const k = boardKpis(entries);
    expect(k.total).toBe(entries.length);
    expect(k.failed24h).toBeNull();
    expect(k.runs24h).toBeNull();
  });

  it("counts runs and failures from the last 24 hours only", () => {
    const now = Date.parse("2026-11-24T12:00:00Z");
    const h = 60 * 60 * 1000;
    const loaded = entries.map((e) => (e.profile.id === "agent-registry-sync" ? withRuns(e, [run(now - h, "failure"), run(now - 5 * h, "success"), run(now - 30 * h, "success")]) : e));
    expect(boardKpis(loaded, now)).toMatchObject({ failed24h: 1, runs24h: 2 });
  });

  it("shortens titles and finds the n8n link", () => {
    expect(shortTitle("Agent Ops · Registry Sheet Sync")).toBe("Registry Sheet Sync");
    expect(shortTitle("Release Coordinator")).toBe("Release Coordinator");
    expect(n8nUrl(catalog.agents.find((a) => a.id === "agent-registry-sync"))).toMatch(/\/workflow\//);
    expect(n8nUrl(catalog.agents.find((a) => a.id === "atlas-ci"))).toBeNull();
  });
});

describe("runtime families", () => {
  it("groups the catalog's runtime text into a few chips", () => {
    const fam = (id: string) => runtimeFamily(byId(id));
    expect(fam("agent-registry-sync")).toBe("n8n");
    expect(fam("atlas-ci")).toBe("GitHub Actions");
    expect(fam("benjaire-contact-worker")).toBe("Cloudflare");
    expect(fam("atlas-merge-pr")).toBe("Desktop app");
    expect(chipMatches("runtime:n8n", byId("agent-registry-sync"))).toBe(true);
  });
});
