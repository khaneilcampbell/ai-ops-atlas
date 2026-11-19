import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { buildCatalog } from "../catalog/parse";
import type { Agent } from "../catalog/types";
import { identities, identityFor, initialsOf, portraitPrompt, PORTRAIT_HOUSE_STYLE } from "./identity";
import { agentStatuses, rollupRuntime, statusFromRuntime, statusFromTask } from "./agentStatus";
import type { Telemetry } from "./types";

const own = catalog.agents.filter((a) => a.registry?.identity);

describe("agent identities in the catalog", () => {
  it("gives the 17 team agents an identity and nobody else", () => {
    expect(own.map((a) => a.id).sort()).toEqual(
      [
        "agent-operations-lead",
        "atlas-engineering-review",
        "atlas-health-monitor",
        "atlas-production-coordinator",
        "atlas-release-coordinator",
        "atlas-release-manager",
        "benjaire-inquiry-manager",
        "benjaire-ops-monitor",
        "benjaire-product-lab",
        "benjaire-shop-manager",
        "commerce-operations-manager",
        "development-hub-lead",
        "documentation-lead",
        "github-profile-manager",
        "repo-intelligence",
        "site-builder",
        "soc-detection-lead",
      ].sort(),
    );
    // A persona is for an AI agent; automations and CI jobs show their owner instead.
    for (const a of own) expect(a.registry?.classification?.type, a.id).toBe("A");
  });

  it("keeps names unique and accents valid and apart from each other", () => {
    const names = own.map((a) => a.registry!.identity!.displayName);
    expect(new Set(names).size).toBe(names.length);
    const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const accents = own.map((a) => a.registry!.identity!.accent!);
    for (const c of accents) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    for (let i = 0; i < accents.length; i++)
      for (let j = i + 1; j < accents.length; j++) {
        const [a, b] = [rgb(accents[i]), rgb(accents[j])];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(d, `${own[i].id} vs ${own[j].id}`).toBeGreaterThan(45);
      }
  });

  it("shows initials, not a picture: no agent carries a portrait (illustrated avatars removed on Khaneil's ask)", () => {
    for (const a of own) {
      expect(a.registry!.identity!.portrait, a.id).toBeUndefined();
      expect(identityFor(a.id, catalog.agents).portrait, a.id).toBeNull();
      expect(a.registry!.identity!.appearance).toBeTruthy();
    }
  });

  it("never claims memory or learning in an introduction", () => {
    for (const a of own) {
      const text = `${a.registry!.identity!.intro} ${a.registry!.identity!.voice}`.toLowerCase();
      expect(text, a.id).not.toMatch(/\b(remember|memory|memories|learn|learns|learning|always on|24\/7)\b/);
    }
  });

  it("builds the illustrated avatar prompt from the fixed appearance, accent and shared house style", () => {
    const p = portraitPrompt("Irish man in his early 30s, short ginger hair.", "#38BDF8");
    expect(p).toBe(`Flat vector illustrated avatar of a fictional character: Irish man in his early 30s, short ginger hair. ${PORTRAIT_HOUSE_STYLE} Solid circular background in #38BDF8 on a plain warm off-white square. Clearly an illustration, not a photo. No text, no logos.`);
    expect(p).not.toMatch(/photoreal/i);
    expect(identities(catalog.agents)).toHaveLength(17);
  });
});

describe("identityFor", () => {
  it("returns the agent's own identity with its role and initials", () => {
    const i = identityFor("atlas-release-manager", catalog.agents, undefined, "/");
    expect(i).toMatchObject({ name: "Daniel Okafor", role: "Atlas Release Manager", kind: "own", portrait: null, initials: "DO", via: null });
  });

  it("shows an automation under its owning agent, via the automation", () => {
    const i = identityFor("atlas-ci", catalog.agents);
    expect(i).toMatchObject({ agentId: "atlas-ci", personaId: "atlas-release-manager", name: "Daniel Okafor", kind: "owner", via: catalog.agents.find((a) => a.id === "atlas-ci")!.name });
  });

  it("shows a Product Lab skill under the lab's lead", () => {
    const i = identityFor("benjaire-product-lab-research", catalog.agents);
    expect(i).toMatchObject({ personaId: "benjaire-product-lab", name: "Leila Haddad", kind: "skill", via: "Market Research Analyst" });
  });

  it("keeps a retired agent on initials, and an id no longer in the catalog on the saved name", () => {
    const retired = identityFor("niche-scout", catalog.agents);
    expect(retired).toMatchObject({ kind: "none", portrait: null, retired: true });
    const gone = identityFor("removed-agent", catalog.agents, "Old Helper");
    expect(gone).toMatchObject({ name: "Old Helper", initials: "OH", portrait: null, kind: "none" });
  });

  it("keeps a retired agent's own identity on its past work", () => {
    const a = catalog.agents.find((x) => x.id === "atlas-release-manager")!;
    const retired: Agent = { ...a, status: "retired" };
    const i = identityFor(a.id, [retired]);
    expect(i).toMatchObject({ name: "Daniel Okafor", kind: "own", retired: true });
  });

  it("makes initials from names", () => {
    expect(initialsOf("Tomás Herrera")).toBe("TH");
    expect(initialsOf("Agent")).toBe("AG");
    expect(initialsOf("")).toBe("?");
  });
});

describe("identity manifest validation", () => {
  const yaml = (identity: string) => `
schema: atlas/v2
project: { id: demo, name: Demo, summary: s, status: active, repository: me/demo }
agents:
  - id: a1
    name: A
    purpose: p
    framework: f
    status: idle
    registry:
      identity: ${identity}
`;
  it("reports a bad accent, a portrait outside public/agents and a missing name", () => {
    const r = buildCatalog({ "demo.yaml": yaml(`{ display_name: Ann Lee, accent: red, portrait: { path: ../x.png } }`) });
    expect(r.issues.map((i) => i.message).join("\n")).toMatch(/accent: must be a #RRGGBB color/);
    expect(r.issues.map((i) => i.message).join("\n")).toMatch(/portrait.path: must be agents/);
    const r2 = buildCatalog({ "demo.yaml": yaml(`{ accent: "#112233" }`) });
    expect(r2.issues.map((i) => i.message).join("\n")).toMatch(/identity.display_name: is required/);
  });
});

describe("identity status from execution data", () => {
  it("maps runtime and task states to the five states, keeping stale and not connected", () => {
    expect(statusFromRuntime("idle")).toBe("ready");
    expect(statusFromRuntime("working")).toBe("working");
    expect(statusFromRuntime("awaiting")).toBe("waiting");
    expect(statusFromRuntime("failed")).toBe("failed");
    expect(statusFromRuntime("stale")).toBe("stale");
    expect(statusFromRuntime("unknown")).toBe("unknown");
    expect(statusFromTask("awaiting_approval")).toBe("waiting");
    expect(statusFromTask("blocked")).toBe("waiting");
    expect(statusFromTask("running")).toBe("working");
    expect(statusFromTask("completed")).toBe("completed");
    expect(statusFromTask("failed")).toBe("failed");
    expect(statusFromTask("queued")).toBe("queued");
  });

  it("rolls owned automations up by urgency and stays Not connected when none reports", () => {
    expect(rollupRuntime(["idle", "failed", "unknown"])).toBe("failed");
    expect(rollupRuntime(["idle", "working"])).toBe("working");
    expect(rollupRuntime(["unknown", "unknown"])).toBe("unknown");
    expect(rollupRuntime(["offline", "offline"])).toBe("offline");
    expect(rollupRuntime([])).toBe("unknown");
  });

  it("gives an owning agent the state of its automations, naming the one it came from", () => {
    const t = (result: "success" | "failure"): Telemetry => ({
      source: "github",
      loaded: true,
      executions: [{ at: new Date().toISOString(), result, label: "run", source: "github" }],
      lastVerifiedRun: null,
      lastAnyRun: null,
      successRate: null,
      failures: 0,
      avgDurationMs: null,
      monthSpendUsd: null,
      monthBudgetUsd: null,
    });
    const owner = catalog.agents.find((a) => a.id === "atlas-release-manager")!;
    const autos = catalog.agents.filter((a) => a.ownedBy === owner.id);
    const tel = new Map<string, Telemetry>([[autos[0].id, t("failure")]]);
    const s = agentStatuses([owner, ...autos], tel);
    expect(s.get(owner.id)).toEqual({ status: "failed", from: autos[0].name });
    expect(agentStatuses([owner], new Map()).get(owner.id)).toEqual({ status: "unknown", from: null });
  });
});
