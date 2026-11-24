import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap} from '../mapLayout';
import {buildScene} from './scene';
import {airportFootprint} from './airport';
import {CAMPUS,inBar,inBuilding,wingBars} from './creativeCampusPlan';
import {campusGeometry} from './creativeCampusGeometry';
import {TERRACE_H} from './scene';
import {CAMPUS_BARS,CAMPUS_DESK_ROOMS,CAMPUS_INTERIOR,CAMPUS_ROOMS,RING_R,campusBar,campusDesks,campusFlight,flightEnds} from '../office/campusInteriorPlan';

const scene=buildScene(layoutMap(catalog));
const campus=scene.campus!;
const overlaps=(a:{x:number;z:number;w:number;d:number},b:{x:number;z:number;w:number;d:number},pad=0)=>a.x<b.x+b.w+pad&&a.x+a.w+pad>b.x&&a.z<b.z+b.d+pad&&a.z+a.d+pad>b.z;

describe('Atlas Creative Campus island', () => {
  it('sits on its own island, kept out of the city land and clear of it by open water', () => {
    expect(campus).toBeDefined();
    for (const r of campus.land) expect(scene.land.includes(r)).toBe(false);
    for (const r of campus.land) for (const l of scene.land) expect(overlaps(r, l, CAMPUS.strait - .5), JSON.stringify([r, l])).toBe(false);
  });

  it('stays west of the airport, out of the runway approaches over the north and south water', () => {
    const a = airportFootprint(scene.airport!);
    for (const r of campus.land) expect(r.x + r.w).toBeLessThan(a.x);
  });

  it('crosses the strait on one bridge that lands on an existing city street', () => {
    const streets = scene.transportConnections.map((c) => c.road);
    const near = streets.some((road) => road.some((p) => Math.hypot(p[0] - campus.cityJoin[0], p[1] - campus.cityJoin[1]) < .05));
    expect(near).toBe(true);
    expect(campus.bridge.x1).toBeGreaterThan(campus.island.x + campus.island.w);
    // The deck clears the perimeter trains running along the shore below it.
    expect(campus.bridge.deck).toBeGreaterThan(.9);
  });

  it('keeps the building, fields and car park on the island and apart from each other', () => {
    const inIsland = (x: number, z: number) => campus.land.some((r) => x >= r.x && x <= r.x + r.w && z >= r.z && z <= r.z + r.d);
    for (const b of campus.bars) for (const p of [b.a, b.b]) expect(inIsland(p[0], p[1])).toBe(true);
    for (const c of campus.courts) {
      expect(inIsland(c.rect.x, c.rect.z) && inIsland(c.rect.x + c.rect.w, c.rect.z + c.rect.d)).toBe(true);
      expect(overlaps(c.rect, campus.footprint)).toBe(false);
      expect(overlaps(c.rect, campus.parking)).toBe(false);
    }
    for (const t of campus.trees) expect(inBuilding(campus, t, .3)).toBe(false);
  });

  it('draws the whole site in a few merged meshes inside its triangle budget', () => {
    const g = campusGeometry(campus, TERRACE_H);
    expect(g.triangles).toBeLessThan(25_000);
    for (const k of ['white', 'inner', 'red', 'ribbon', 'atrium', 'ground', 'trim', 'ribbonOutside'] as const) expect(g[k].getAttribute('position').count).toBeGreaterThan(0);
  });
});

describe('Atlas Creative Campus interior', () => {
  const S = CAMPUS_INTERIOR.scale;
  it('uses the exterior wings at the cutaway scale', () => {
    const outside = wingBars([0, 0]);
    expect(CAMPUS_BARS.length).toBe(outside.length);
    CAMPUS_BARS.forEach((b, i) => { expect(b.length).toBeCloseTo(outside[i].length * S); expect(b.a[0]).toBeCloseTo(outside[i].a[0] * S); });
  });

  it('lays every room out inside a wing, on every storey of the building', () => {
    expect(new Set(CAMPUS_ROOMS.map((r) => r.level))).toEqual(new Set(Array.from({ length: CAMPUS.storeys }, (_, i) => i)));
    for (const r of CAMPUS_ROOMS) {
      const b = campusBar(r);
      if (!b) { expect(Math.hypot(r.x, r.z)).toBeLessThan(CAMPUS_INTERIOR.atrium.r); continue; }
      for (const [s, v] of [[r.s0, r.v0], [r.s1, r.v0], [r.s1, r.v1], [r.s0, r.v1]]) {
        const p: [number, number] = [b.a[0] + b.dir[0] * s - b.dir[1] * v, b.a[1] + b.dir[1] * s + b.dir[0] * v];
        expect(inBar(b, p, 1e-6), r.id).toBe(true);
      }
    }
    expect(new Set(CAMPUS_ROOMS.map((r) => r.id)).size).toBe(CAMPUS_ROOMS.length);
  });

  it('puts every desk inside its room, and no agent has a desk yet', () => {
    expect(CAMPUS_DESK_ROOMS.length).toBeGreaterThan(20);
    for (const r of CAMPUS_DESK_ROOMS) {
      const b = campusBar(r)!, desks = campusDesks(r);
      expect(desks.length).toBe(r.desks);
      for (const d of desks) {
        const v = [d.x - b.a[0], d.z - b.a[1]], s = v[0] * b.dir[0] + v[1] * b.dir[1], t = -v[0] * b.dir[1] + v[1] * b.dir[0];
        expect(s > r.s0 && s < r.s1 && t > r.v0 && t < r.v1, r.id).toBe(true);
      }
    }
    expect(catalog.agents.some((a) => a.workplace?.building === 'Atlas Creative Campus')).toBe(false);
  });

  it('runs a stair flight across the atrium void between every pair of floors', () => {
    for (let level = 0; level < CAMPUS.storeys - 1; level++) {
      const f = campusFlight(level), ends = flightEnds(level);
      expect(f[f.length - 1].y).toBeCloseTo((level + 1) * CAMPUS_INTERIOR.storey);
      for (const st of f) expect(Math.hypot(st.x, st.z)).toBeLessThan(CAMPUS_INTERIOR.atrium.r + .7);
      for (const p of [ends.from, ends.to]) expect(Math.hypot(...p)).toBeLessThan(RING_R);
    }
  });
});
