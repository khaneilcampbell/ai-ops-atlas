import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { projectOfficeAgents } from "../../catalog/workplaces";
import { HQ_INTERIOR, shellAxes } from "./atlasHqInteriorPlan";
import { FLOOR4_MODEL, FURNISHED_LEVEL, KIT_ANCHORS, deskFootprint, inside, isFurnishedFloor, overlaps, type Box2 } from "./commandCenterFloorPlan";
import { planOffice } from "./model";

// The Blender floor (assets/command-center-office) against the app: same floor plate, every
// planned desk on the carpet and clear of the rooms, the kit's anchors where the live parts go,
// the model small, and the source, .blend and GLB rebuilt together.

const root = join(import.meta.dirname, "..", "..", "..");
const glbPath = join(root, "public", FLOOR4_MODEL);
const glb = readFileSync(glbPath);

interface Node { name?: string; children?: number[]; mesh?: number; translation?: number[]; extras?: Record<string, number> }
interface Gltf { nodes: Node[]; meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[]; accessors: { count: number }[]; materials: { name: string; alphaMode?: string }[]; images?: unknown[] }
const json: Gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
const byName = (name: string) => {
  const n = json.nodes.find((x) => x.name === name);
  if (!n) throw new Error(`no node ${name}`);
  return n;
};
const children = (name: string) => (byName(name).children ?? []).map((i) => json.nodes[i]);

const project = catalog.projects.find((p) => p.id === "ai-ops-atlas")!;
const agents = projectOfficeAgents(catalog.agents, project.id);
const plan = planOffice(project, agents);
const floor4 = plan.workstations.filter((w) => (agents.find((a) => a.id === w.agentId)?.officeFloor ?? 4) === FURNISHED_LEVEL);

describe("Command Center Floor 4 model", () => {
  it("is the floor plate Atlas draws: same office plan, curtain wall and storey", () => {
    const e = byName("command_center_floor4").extras!;
    const { a, b } = shellAxes(plan.w, plan.d);
    expect(e.floor).toBe(FURNISHED_LEVEL);
    expect(e.planW).toBeCloseTo(plan.w, 3);
    expect(e.planD).toBeCloseTo(plan.d, 3);
    expect(e.shellA).toBeCloseTo(a, 3);
    expect(e.shellB).toBeCloseTo(b, 3);
    expect(e.shellN).toBe(HQ_INTERIOR.roundness);
    expect(e.storey).toBe(HQ_INTERIOR.height);
  });

  it("only furnishes the Command Center's Floor 4", () => {
    expect(isFurnishedFloor("ai-ops-atlas", 4)).toBe(true);
    expect([0, 1, 2, 3].some((l) => isFurnishedFloor("ai-ops-atlas", l))).toBe(false);
    expect(isFurnishedFloor("benjaire-com", 4)).toBe(false);
  });

  it("keeps every planned Floor 4 desk on the carpet and out of the rooms and planting", () => {
    expect(floor4.length).toBeGreaterThan(0);
    const zones = children("zones");
    const zone = zones.find((n) => n.name === "zone_desks")!.extras as unknown as Box2;
    const keepouts = zones.filter((n) => n.name?.startsWith("keepout_"));
    expect(keepouts.length).toBeGreaterThanOrEqual(6);
    for (const w of floor4) {
      const f = deskFootprint(w.x, w.z);
      expect(inside(f, zone), `${w.agentId} off the carpet`).toBe(true);
      for (const k of keepouts) expect(overlaps(f, k.extras as unknown as Box2), `${w.agentId} in ${k.name}`).toBe(false);
    }
  });

  it("carries the kit's anchors where the workstation draws its live parts", () => {
    const anchors = Object.fromEntries(children("kit").filter((n) => n.name?.startsWith("anchor_")).map((n) => [n.name, n.translation ?? [0, 0, 0]]));
    expect(Object.keys(anchors).sort()).toEqual(Object.keys(KIT_ANCHORS).sort());
    for (const [name, p] of Object.entries(KIT_ANCHORS)) p.forEach((v, i) => expect(anchors[name][i]).toBeCloseTo(v, 3));
  });

  it("holds no live parts: no agents, labels, screens' content or textures", () => {
    const names = json.nodes.map((n) => n.name ?? "");
    expect(names.filter((n) => /agent|label_|status|telemetry|preview/i.test(n))).toEqual([]);
    expect(json.images ?? []).toEqual([]);
  });

  it("stays light: one mesh per material in each part, under 15k triangles and 600 KB", () => {
    const tris = json.nodes.filter((n) => n.mesh !== undefined).reduce((t, n) => t + json.meshes[n.mesh!].primitives.reduce((s, p) => s + json.accessors[p.indices].count / 3, 0), 0);
    expect(tris).toBeLessThan(15_000);
    expect(glb.length).toBeLessThan(600_000);
    for (const part of ["static", "cutaway_back", "kit"]) {
      const meshes = children(part).filter((n) => n.mesh !== undefined);
      expect(meshes.length).toBeLessThanOrEqual(12);
      expect(new Set(meshes.map((n) => n.name)).size).toBe(meshes.length);
    }
  });

  it("was rebuilt from its source: script, .blend and GLB match build.json", () => {
    const dir = join(root, "assets", "command-center-office");
    const stamp = JSON.parse(readFileSync(join(dir, "build.json"), "utf8"));
    const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
    const hint = "run `npm run model:command-center-floor` (assets/command-center-office/README.md)";
    expect(sha(join(dir, "build_office_floor.py")), hint).toBe(stamp.script);
    expect(sha(join(dir, "command-center-floor4.blend")), hint).toBe(stamp.blend);
    expect(sha(glbPath), hint).toBe(stamp.glb);
  });
});
