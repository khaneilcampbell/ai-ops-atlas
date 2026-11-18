import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { FIGURE_SCALE, RIG } from "./agentFigures";
import { alongJourney, buildingModels, deskJourney, floorLayout, FLOOR_DESKS, levelY, PERSON_K, SEAT_TOP } from "./buildingModel";
import { layoutMap } from "../mapLayout";
import { entranceDoor, towerTop } from "./models";
import { buildScene } from "./scene";

const scene = buildScene(layoutMap(catalog));
const models = buildingModels(scene, catalog.projects, catalog.agents);

describe("one building model for the exterior and the interior", () => {
  it("covers every headquarters with an office", () => {
    expect(models.size).toBeGreaterThanOrEqual(6);
    for (const t of scene.towers) {
      const m = models.get(t.key);
      if (m) expect(m.desks.size, t.key).toBe(m.plan.workstations.length);
    }
  });

  it("fits every floor plate, desk and the lift inside the footprint, below the roof", () => {
    for (const [key, m] of models) {
      const t = scene.towers.find((x) => x.key === key)!;
      expect(m.plate, key).toBeLessThan(m.size);
      const inside = (x: number, z: number) => Math.abs(x - m.x) <= m.plate / 2 + 1e-6 && Math.abs(z - m.z) <= m.plate / 2 + 1e-6;
      expect(inside(m.core.x, m.core.z), `${key} lift`).toBe(true);
      for (const d of m.desks.values()) {
        expect(inside(d.seat[0], d.seat[2]), `${key} ${d.agentId}`).toBe(true);
        // Desk: 1.5 office units wide around its centre.
        for (const sx of [-0.75, 0.75]) expect(inside(m.x + (d.ws.x + sx) * m.k, m.z + d.ws.z * m.k), `${key} ${d.agentId} desk edge`).toBe(true);
      }
      for (const f of m.officeFloors) {
        expect(f.level, key).toBeGreaterThanOrEqual(1);
        expect(f.level, key).toBeLessThan(t.floors);
        expect(f.y + m.floorH, key).toBeLessThan(towerTop(t));
      }
    }
  });

  it("enters by the door the map draws, on its façade", () => {
    for (const [key, m] of models) {
      const t = scene.towers.find((x) => x.key === key)!;
      const d = entranceDoor(t);
      expect(m.door.facade[0]).toBeCloseTo(d.p[0]);
      expect(m.door.facade[2]).toBeCloseTo(d.p[2]);
      expect(m.door.outside[2], key).toBeGreaterThan(m.door.facade[2]);
      expect(m.door.lobby[2], key).toBeLessThan(m.door.facade[2]);
      expect(Math.abs(m.door.lobby[2] - m.z), key).toBeLessThan(m.size / 2);
    }
  });

  it("gives every agent its own desk, and two desks never share a chair", () => {
    for (const [key, m] of models) {
      const seats = new Set<string>();
      for (const d of m.desks.values()) {
        const s = `${d.level}:${d.seat[0].toFixed(3)},${d.seat[2].toFixed(3)}`;
        expect(seats.has(s), `${key} ${d.agentId}`).toBe(false);
        seats.add(s);
        expect(d.seat[1]).toBeCloseTo(levelY(d.level));
      }
    }
  });

  it("draws the inside at people's scale: the chair meets a city figure's hips", () => {
    expect(SEAT_TOP * PERSON_K).toBeCloseTo(RIG.leg.h * FIGURE_SCALE);
    for (const m of models.values()) expect(m.k).toBeGreaterThan(PERSON_K * 0.8);
  });

  it("walks door → lobby → lift → floor → aisle → chair, riding only inside the lift core", () => {
    for (const m of models.values())
      for (const d of m.desks.values()) {
        const j = deskJourney(m, d.agentId)!;
        expect(j.points[0]).toEqual(m.door.outside);
        expect(j.points[j.points.length - 1]).toEqual(d.seat);
        expect(j.lift, d.agentId).toBeGreaterThan(0);
        const [a, b] = [j.points[j.lift - 1], j.points[j.lift]];
        expect(Math.hypot(a[0] - m.core.x, a[2] - m.core.z)).toBeLessThan(1e-6);
        expect(b[1]).toBeCloseTo(levelY(d.level));
        // Every step on a floor stays on that floor's height; only the lift changes it.
        j.points.forEach((p, i) => {
          if (i && i !== j.lift && i > 1) expect(Math.abs(p[1] - j.points[i - 1][1]) < 1e-6, `${d.agentId} step ${i}`).toBe(true);
        });
        expect(alongJourney(j.points, 0).p).toEqual(m.door.outside);
        alongJourney(j.points, 1).p.forEach((v, k) => expect(v).toBeCloseTo(d.seat[k]));
      }
  });
});

describe("the map's cutaway and Enter building share one desk layout", () => {
  it("puts every desk on the same floor and in the same place as floorLayout", () => {
    for (const m of models.values()) {
      const agents = catalog.agents;
      const layout = floorLayout(m.plan, (id) => agents.find((a) => a.id === id)?.officeFloor);
      for (const [level, list] of layout)
        for (const ws of list) {
          const d = m.desks.get(ws.agentId)!;
          expect(d.level, ws.agentId).toBe(level);
          expect([d.ws.x, d.ws.z]).toEqual([ws.x, ws.z]);
        }
      for (const f of m.officeFloors) expect(f.workstations.length, m.key).toBeLessThanOrEqual(FLOOR_DESKS);
    }
  });

  it("honours a floor named in the catalog", () => {
    for (const a of catalog.agents.filter((x) => x.officeFloor && x.projectId)) {
      const m = models.get(`project:${a.projectId}`);
      const d = m?.desks.get(a.id);
      if (d) expect(d.level, a.id).toBe(a.officeFloor);
    }
  });
});
