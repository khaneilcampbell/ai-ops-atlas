import { describe, expect, it } from "vitest";
import { catalog } from "../catalog";
import { agentJobs } from "../catalog/agentJobs";
import { isAiAgent } from "../catalog/roles";
import { projectOfficeAgents } from "../catalog/workplaces";
import { identities } from "../registry/identity";
import { FIGURE_SCALE, RIG } from "../views/map3d/agentFigures";
import { FLOOR_BASE, towerTop } from "../views/map3d/models";
import { buildScene } from "../views/map3d/scene";
import { layoutMap } from "../views/mapLayout";
import { DESK_CELL, DESK_FLOORS, INTERIOR_K, OFFICE_SEATED_TOP, busiestOffice, defaultFloor, seatedNow, defineBuildings, journeyTo, locateAgent, occupiedFloors, type FloorPlate } from "./buildingDefinition";
import { SHELL } from "./shellPlates";

const scene = buildScene(layoutMap(catalog));
const defs = defineBuildings(scene.towers, catalog.projects, catalog.agents);
const within = (p: FloorPlate, x: number, z: number, pad = 1e-6) => x >= p.x0 - pad && x <= p.x1 + pad && z >= p.z0 - pad && z <= p.z1 + pad;

describe("one definition per building", () => {
  it("defines every headquarters with an office, keyed by its stable map id", () => {
    for (const t of scene.towers) {
      if (!projectOfficeAgents(catalog.agents, t.projectId).length) continue;
      const d = defs.get(t.key)!;
      expect(d, t.key).toBeDefined();
      expect(d.id).toBe(`project:${t.projectId}`);
      expect(d.name).toBe(t.name);
      expect(d.exterior).toMatchObject({ x: t.x, z: t.z, size: t.size, storeys: t.floors });
    }
  });

  it("has a measured shell for every building that holds a desk", () => {
    for (const d of defs.values()) if (d.desks.length) expect(SHELL[d.projectId], d.id).toBeDefined();
  });
});

describe("the interior fits the exterior", () => {
  it("stacks its floors on the exterior's storeys, under its roof", () => {
    for (const d of defs.values()) {
      expect(d.exterior.storeyH * d.exterior.storeys).toBeCloseTo(d.exterior.top - FLOOR_BASE, 6);
      for (const f of d.floors) {
        expect(f.y, `${d.id} ${f.label}`).toBeCloseTo(FLOOR_BASE + f.index * d.exterior.storeyH, 6);
        expect(f.surface + 0.4, `${d.id} ${f.label}`).toBeLessThan(towerTop(scene.towers.find((t) => t.key === d.id)!));
      }
    }
  });

  it("keeps every floor plate inside the footprint and every desk on its plate", () => {
    for (const d of defs.values()) {
      const half = d.exterior.size / 2;
      for (const f of d.floors) {
        expect(f.plate.x1 - f.plate.x0, `${d.id} ${f.label}`).toBeGreaterThan(0);
        expect(f.plate.z1 - f.plate.z0, `${d.id} ${f.label}`).toBeGreaterThan(0);
        expect(f.plate.x0).toBeGreaterThanOrEqual(d.exterior.x - half);
        expect(f.plate.x1).toBeLessThanOrEqual(d.exterior.x + half);
        expect(f.plate.z0).toBeGreaterThanOrEqual(d.exterior.z - half);
        expect(f.plate.z1).toBeLessThanOrEqual(d.exterior.z + half);
      }
      for (const desk of d.desks) {
        const f = d.floors.find((x) => x.index === desk.floor)!;
        const w = (DESK_CELL.w * d.k) / 2;
        // The desk, its chair and the aisle behind it all stand on the plate.
        expect(within(f.plate, desk.x - w, desk.z - 0.3 * d.k), desk.id).toBe(true);
        expect(within(f.plate, desk.x + w, desk.seat.z + 0.3 * d.k), desk.id).toBe(true);
        expect(desk.seat.y).toBeCloseTo(f.surface, 6);
      }
    }
  });

  it("puts the door on the lobby's front face, toward the street, outside reached from the sidewalk", () => {
    for (const d of defs.values()) {
      const [dx, , dz] = d.entrance.door, [ox, oy, oz] = d.entrance.outside;
      const lobby = d.floors[0].plate;
      expect(dx).toBeGreaterThanOrEqual(lobby.x0);
      expect(dx).toBeLessThanOrEqual(lobby.x1);
      expect(dz, d.id).toBeGreaterThan(d.exterior.z);
      expect(oz).toBeGreaterThan(dz);
      expect(ox).toBeCloseTo(dx, 6);
      expect(oy).toBeLessThan(d.floors[0].surface);
    }
  });

  it("draws people at the same size inside as in the street", () => {
    expect(OFFICE_SEATED_TOP * INTERIOR_K).toBeCloseTo(RIG.top * FIGURE_SCALE, 6);
    for (const d of defs.values()) expect(d.k).toBe(INTERIOR_K);
  });

  it("leaves a storey tall enough for a standing person", () => {
    for (const d of defs.values()) expect(d.exterior.storeyH, d.id).toBeGreaterThan(RIG.top * FIGURE_SCALE * 1.3);
  });
});

describe("desks", () => {
  const people = identities(catalog.agents);
  it("gives every working AI agent exactly one desk, in exactly one building", () => {
    const desks = [...defs.values()].flatMap((d) => d.desks);
    const ids = desks.map((d) => d.agentId);
    expect(new Set(ids).size).toBe(ids.length);
    const jobs = agentJobs(catalog).filter((j) => j.work.kind === "headquarters" && !j.offDuty);
    for (const j of jobs) {
      const a = catalog.agents.find((x) => x.id === j.agentId)!;
      if (a.status === "retired") continue;
      expect(ids, j.agentId).toContain(j.agentId);
    }
    // Every named persona with a headquarters workplace sits at its own desk.
    for (const p of people) {
      const job = agentJobs(catalog).find((j) => j.agentId === p.personaId);
      if (job?.work.kind === "headquarters") expect(ids, p.personaId).toContain(p.personaId);
    }
  });

  it("never gives an automation a seat: it is listed at its owner's desk, owner first", () => {
    const desks = [...defs.values()].flatMap((d) => d.desks);
    for (const a of catalog.agents.filter((x) => !isAiAgent(x))) {
      expect(desks.some((d) => d.agentId === a.id), a.id).toBe(false);
      if (a.ownedBy && a.status !== "retired") expect(desks.find((d) => d.agentId === a.ownedBy)?.workflows, a.id).toContain(a.id);
    }
    // One workflow run by an agent in another building still points at that agent's desk.
    const flow = [...defs.values()].flatMap((d) => d.workflows).find((w) => w.agentId === "github-merge-flow")!;
    expect(flow).toMatchObject({ ownerId: "atlas-production-coordinator", ownerBuilding: "project:ai-ops-atlas" });
    expect(locateAgent(defs, "github-merge-flow")?.building.id).toBe("project:ai-ops-atlas");
  });

  it("never stacks two desks or two chairs in one place", () => {
    for (const d of defs.values())
      for (const a of d.desks)
        for (const b of d.desks) {
          if (a === b || a.floor !== b.floor) continue;
          const apart = Math.abs(a.x - b.x) >= DESK_CELL.w * d.k - 1e-6 || Math.abs(a.z - b.z) >= DESK_CELL.d * d.k - 1e-6;
          expect(apart, `${a.id} ${b.id}`).toBe(true);
        }
  });

  it("keeps declared floors, fills from floor 4 down, never the lobby", () => {
    for (const d of defs.values())
      for (const desk of d.desks) {
        expect(DESK_FLOORS as readonly number[]).toContain(desk.floor);
        const a = catalog.agents.find((x) => x.id === desk.agentId)!;
        if (a.officeFloor) expect(desk.floor, a.id).toBe(a.officeFloor);
      }
    const cc = defs.get("project:ai-ops-atlas")!;
    expect(cc.desks.find((x) => x.agentId === "atlas-production-coordinator")!.floor).toBe(3);
    expect(occupiedFloors(cc).length).toBeGreaterThan(1);
    expect(defaultFloor(cc)).toBe(4);
  });

  it("is stable: the same layout gives the same desks", () => {
    const again = defineBuildings(scene.towers, catalog.projects, catalog.agents);
    for (const [k, d] of defs) expect(again.get(k)!.desks).toEqual(d.desks);
  });
});

describe("the walk in", () => {
  it("goes sidewalk, door, lobby, lift, floor, desk, and stays inside once through the door", () => {
    for (const d of defs.values())
      for (const desk of d.desks) {
        const j = journeyTo(d, desk.agentId);
        expect(j.map((p) => p.stop)).toEqual(["sidewalk", "door", "lobby", "lift", "floor", "floor", "desk"]);
        expect(j.at(-1)!.p).toEqual([desk.seat.x, desk.seat.y, desk.seat.z]);
        for (const p of j.slice(2)) {
          const f = d.floors.find((x) => x.index === p.floor)!;
          expect(within(f.plate, p.p[0], p.p[2], 1e-3), `${desk.id} ${p.stop}`).toBe(true);
        }
        // Heights only rise: street, lobby floor, then its own floor.
        for (let i = 1; i < j.length; i++) expect(j[i].p[1]).toBeGreaterThanOrEqual(j[i - 1].p[1] - 1e-9);
        // The lift shaft stands inside every floor it passes.
        for (const f of d.floors.filter((x) => x.index <= desk.floor)) expect(within(f.plate, d.core.x, d.core.z, 1e-3), `${d.id} core ${f.label}`).toBe(true);
      }
  });

  it("locates an agent at its building, floor and chair", () => {
    const where = locateAgent(defs, "atlas-health-monitor")!;
    expect(where.building.id).toBe("project:ai-ops-atlas");
    expect(where.desk.agentId).toBe("atlas-health-monitor");
    expect(locateAgent(defs, "no-such-agent")).toBeUndefined();
  });
});

describe("the Inside button", () => {
  it("opens where agents are at their desks now, on the floor with most of them", () => {
    const benjaire = defs.get("project:benjaire-site")!;
    const low = [...benjaire.desks].sort((a, b) => a.floor - b.floor)[0];
    const positions = new Map<string, [number, number, number] | null>([[low.agentId, [low.seat.x, low.seat.y, low.seat.z]]]);
    expect(seatedNow(benjaire, positions).map((d) => d.agentId)).toEqual([low.agentId]);
    expect(busiestOffice(defs, positions)).toMatchObject({ building: { id: "project:benjaire-site" }, floor: low.floor, seated: 1 });
  });

  it("does not count an agent walking past in the street", () => {
    const cc = defs.get("project:ai-ops-atlas")!;
    const d = cc.desks[0];
    expect(seatedNow(cc, new Map([[d.agentId, [d.seat.x, 0, d.seat.z + 3]]]))).toEqual([]);
  });

  it("falls back to the building with the most desks when nobody is seated", () => {
    const most = Math.max(...[...defs.values()].map((d) => d.desks.length));
    const pick = busiestOffice(defs, new Map())!;
    expect(pick.seated).toBe(0);
    expect(pick.building.desks.length).toBe(most);
    expect(pick.floor).toBe(defaultFloor(pick.building));
  });
});

describe("the lift keeps clear of the desks", () => {
  it("leaves its doors and the space in front of them free of every desk and chair", () => {
    for (const d of defs.values())
      for (const desk of d.desks) {
        const apart = Math.abs(desk.x - d.core.x) >= (DESK_CELL.w / 2) * d.k * 0.85;
        const zClear = d.core.z > desk.z + 0.935 * d.k || d.core.z + 0.2 < desk.z - 0.38 * d.k;
        expect(apart || zClear, `${d.id} ${desk.agentId}`).toBe(true);
      }
  });
});
