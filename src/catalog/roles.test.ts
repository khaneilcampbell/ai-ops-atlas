import { describe, expect, it } from "vitest";
import { catalog } from "./index";
import { directoryItems, isAiAgent } from "./roles";
import { organize } from "./organization";
import { buildRegistry } from "../registry/registry";
import type { Classification } from "../registry/types";

describe("agent and automation directories", () => {
  it.each<[Classification, boolean]>([["A", true], ["F", true], ["B", false], ["C", false], ["D", false], ["E", false], ["unclassified", false]])("classifies %s without guessing from its title or runtime", (type, expected) => {
    expect(isAiAgent({ registry: { classification: { type, confidence: "verified" } } })).toBe(expected);
  });
  it("keeps fixed AI-assisted workflows out of the agent directory", () => {
    for (const id of ["benjaire-flow-intake", "github-merge-flow", "atlas-production-coordinator", "canva-mockups"]) {
      expect(isAiAgent(catalog.agents.find(a => a.id === id)!)).toBe(false);
    }
    for (const id of ["repo-intelligence", "niche-scout", "benjaire-product-lab", "skyline-inquiry-assistant"]) {
      expect(isAiAgent(catalog.agents.find(a => a.id === id)!)).toBe(true);
    }
  });
  it("lists only current items: retired ones and their old server runtime stay out of both directories", () => {
    const agents = directoryItems(catalog.agents, "agents"), automations = directoryItems(catalog.agents, "automations");
    for (const list of [agents, automations]) expect(list.some(a => a.status === "retired")).toBe(false);
    expect(agents.map(a => a.id)).not.toContain("niche-scout");
    expect(agents.map(a => a.id)).toContain("benjaire-product-lab");
    expect(automations.map(a => a.id)).toContain("commerce-loop");
    expect(JSON.stringify(catalog.agents)).not.toMatch(/\bVPS\b/i);
  });
  it("partitions every declared item once while preserving registry identity and evidence", () => {
    const org = organize(catalog);
    const entries = buildRegistry(catalog, {}, null);
    expect(catalog.agents.every(a => a.registry?.classification?.type && a.registry.classification.type !== "unclassified")).toBe(true);
    const agents = catalog.agents.filter(isAiAgent), automations = catalog.agents.filter(a => !isAiAgent(a));
    expect(new Set([...agents, ...automations].map(a => a.id)).size).toBe(catalog.agents.length);
    for (const a of catalog.agents) {
      expect(org.records.get(a.id)?.kind).toBe(isAiAgent(a) ? "ai-agent" : "automation");
      expect(entries.find(e => e.profile.id === a.id)?.profile).toMatchObject({ repository: a.repository, classification: a.registry!.classification!.type, project: { id: a.projectId } });
    }
  });
});
