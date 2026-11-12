import { describe, expect, it } from "vitest";
import { catalog, manifestIssues as issues } from "./index";
import { buildCatalog } from "./parse";
import { isAiAgent } from "./roles";
import { ownership, rollupHealth } from "./ownership";

const manifest = (agents: string) => `schema: atlas/v2
project:
  id: demo
  name: Demo
  summary: Demo.
  status: active
  repository: owner/demo
agents:
${agents}`;
const ai = (id: string) => `  - id: ${id}
    name: ${id}
    purpose: x
    framework: x
    status: active
    last_run: null
    registry:
      classification: { type: A }
`;
const auto = (id: string, extra = "", type = "C") => `  - id: ${id}
    name: ${id}
    purpose: x
    framework: x
    status: active
    last_run: null
${extra}    registry:
      classification: { type: ${type} }
`;

describe("automation ownership", () => {
  it("nests owned automations under their agent and lists the rest as orphans", () => {
    const { catalog: c, issues: i } = buildCatalog({ "demo.yaml": manifest(ai("lead") + auto("step", "    owned_by: lead\n") + auto("loose")) });
    expect(i).toEqual([]);
    const o = ownership(c);
    expect(o.owned.get("lead")?.map((a) => a.id)).toEqual(["step"]);
    expect(o.orphans.map((a) => a.id)).toEqual(["loose"]);
  });

  it("rejects an owner that is missing, an automation, or set on an AI agent", () => {
    const { issues: i } = buildCatalog({
      "demo.yaml": manifest(ai("lead") + auto("a", "    owned_by: ghost\n") + auto("b", "    owned_by: a\n") + auto("c", "    owned_by: lead\n", "A")),
    });
    expect(i.map((x) => x.message)).toEqual([
      'a.owned_by: "ghost" is not an agent id',
      'b.owned_by: "a" is an automation, not an AI agent',
      "c.owned_by: only automations have an owning agent",
    ]);
  });

  it("rolls a group up to its worst state, and unverified never counts as verified", () => {
    expect(rollupHealth(["verified", "verified"])).toBe("verified");
    expect(rollupHealth(["verified", "configured"])).toBe("configured");
    expect(rollupHealth(["verified", "unknown", "configured"])).toBe("unknown");
    expect(rollupHealth(["planned", "failing", "verified"])).toBe("failing");
    expect(rollupHealth([])).toBe("unknown");
  });

  // Orphan check: lists every automation in use with no owning agent. It reports, it never fails
  // the build; giving an automation an owner (catalog `owned_by`) takes it off the list.
  it("reports automations with no owning agent", () => {
    expect(issues).toEqual([]);
    const { owned, orphans } = ownership(catalog);
    for (const [agent] of owned) expect(isAiAgent(catalog.agents.find((a) => a.id === agent)!)).toBe(true);
    if (orphans.length)
      console.info(`Orphan check: ${orphans.length} automation(s) have no owning agent (catalog owned_by):\n${orphans.map((a) => `  - ${a.id} (${a.projectId})`).join("\n")}`);
    expect(orphans.every((a) => !a.ownedBy)).toBe(true);
  });
});
