import { describe, expect, it } from "vitest";
import type { ExecutionRecord } from "../../registry/types";
import type { Runtime, Workstation } from "./model";
import { byTier, hologramData, orgBands, RUN_SLOTS } from "./officeOrg";

const ws = (tier: Workstation["tier"], x: number, z: number, zone: Workstation["zone"] = "production") => ({ tier, x, z, zone }) as Workstation;
const rt = (state: Runtime["state"], source: string | null = "GitHub Actions"): Runtime => ({ state, reason: "Because.", basis: null, source });
const run = (at: string, result: ExecutionRecord["result"]): ExecutionRecord => ({ at, result, label: `CI ${at}`, source: "github" });
const profile = (tasks: string[] = [], objective: string | null = null) => ({
  responsibilities: { tasks, tools: [], inputs: [], outputs: [], dependencies: [], limitations: [] },
  goals: { objective, reviewFrequency: null, kpis: [] },
  mission: { purpose: "Keeps CI green.", problem: null, outcomes: [], beneficiaries: [] },
  governance: { autonomy: 1 } as never,
});

describe("office organization", () => {
  it("makes one band per tier in plan order, spanning its desks", () => {
    const bands = orgBands([
      { ws: ws("specialized", -2, 3), runtime: rt("idle") },
      { ws: ws("central", -2, -2), runtime: rt("working") },
      { ws: ws("central", 2, -2), runtime: rt("failed") },
      { ws: ws("specialized", 2, 3), runtime: rt("idle") },
    ]);
    expect(bands.map((b) => [b.tier, b.count])).toEqual([["central", 2], ["specialized", 2]]);
    expect(bands[0]).toMatchObject({ minX: -2, maxX: 2, minZ: -2, maxZ: -2 });
    expect(bands[0].activity).toContain("1 ");
    expect(bands[0].activity!.split(" · ")).toHaveLength(2);
    // Calm states are not called out on the sign.
    expect(bands[1].activity).toBeNull();
  });

  it("names AI agents and automations apart on the sign, never counting an automation as an agent", () => {
    const [band] = orgBands([
      { ws: ws("specialized", 0, 0), runtime: rt("idle") },
      { ws: ws("specialized", 1, 0), runtime: rt("idle"), automation: true },
      { ws: ws("specialized", 2, 0), runtime: rt("idle"), automation: true },
    ]);
    expect(band.residents).toBe("1 AI agent · 2 automations");
    const [autos] = orgBands([{ ws: ws("central", 0, 0), runtime: rt("idle"), automation: true }]);
    expect(autos.residents).toBe("1 automation");
  });

  it("groups the roster by tier and drops empty tiers", () => {
    expect(byTier(["a", "b", "c"], (x) => (x === "b" ? "coordinator" : "specialized")).map((g) => [g.tier, g.items])).toEqual([["coordinator", ["b"]], ["specialized", ["a", "c"]]]);
  });
});

describe("hologram data", () => {
  it("shows observed runs oldest first and a rate only from completed runs", () => {
    const history = [run("2026-11-17T10:00:00Z", "running"), run("2026-11-17T09:00:00Z", "failure"), run("2026-11-17T08:00:00Z", "success"), run("2026-11-17T07:00:00Z", "success")];
    const h = hologramData({ name: "CI", ws: ws("central", 0, 0, "quality"), runtime: rt("working"), history, profile: profile(["Run tests", "Report", "Gate", "Extra"], "Keep main green") });
    expect(h.runs).toEqual(["success", "success", "failure", "running"]);
    expect(h.successPct).toBe(67);
    expect(h.runsCaption).toBe("2 of 3 recent runs succeeded");
    expect(h.latest?.result).toBe("running");
    expect(h.team).toBe("Quality review team · Central operations");
    expect(h.tasks).toEqual(["Run tests", "Report", "Gate"]);
    expect(h.goal).toBe("Keep main green");
  });

  it("never invents runs or a rate when nothing was observed", () => {
    const none = hologramData({ name: "X", ws: ws("specialized", 0, 0), runtime: rt("unknown", null), history: [], profile: profile() });
    expect(none).toMatchObject({ runs: [], successPct: null, latest: null, source: "Not connected", runsCaption: "Not connected: no run data", tasks: [] });
    // With no objective the mission purpose stands in; it is still declared data.
    expect(none.goal).toBe("Keeps CI green.");
    const quiet = hologramData({ name: "X", ws: ws("specialized", 0, 0), runtime: rt("idle"), history: [], profile: profile() });
    expect(quiet.runsCaption).toBe("No runs observed yet");
  });

  it("labels an automation's hologram as an automation, not a team member", () => {
    const h = hologramData({ name: "Atlas · Test and Release Build", automation: true, ws: ws("central", 0, 0, "quality"), runtime: rt("idle"), history: [], profile: profile() });
    expect(h.team).toBe("Automation · Quality review");
  });

  it("keeps at most the slot count of runs", () => {
    const history = Array.from({ length: 30 }, (_, i) => run(`2026-11-${String(30 - (i % 28)).padStart(2, "0")}T00:00:00Z`, "success"));
    expect(hologramData({ name: "X", ws: ws("central", 0, 0), runtime: rt("idle"), history, profile: profile() }).runs).toHaveLength(RUN_SLOTS);
  });
});
