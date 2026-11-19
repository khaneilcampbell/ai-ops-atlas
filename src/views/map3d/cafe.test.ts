import { describe, expect, it } from "vitest";
import { catalog } from "../../catalog";
import { layoutMap } from "../mapLayout";
import { buildScene } from "./scene";
import { distanceToRoad } from "./highway";
import { ROAD_W, type Pt3 } from "./roads";
import { avenuePlanting } from "./models";
import { AGENT_BODY, passWidth, SEAT_HEIGHT, seatedClearHeight, standingClearHeight } from "./agentBody";
import { CAFE, CAFE_GROUND, type CafePlan } from "./cafePlan";
import { cafeMoment, cafeNow, cafeVisits, counterPoint, seatPath } from "./cafeVisits";
import type { LeisureOption, Routine } from "../../routine/routine";

const scene = buildScene(layoutMap(catalog, [], "district"));
const plan = scene.cafe as CafePlan;
type P = [number, number];

/** Points every `step` along a walking route (x, z). */
const samples = (route: readonly Pt3[], step = 0.02): P[] => {
  const out: P[] = [];
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1], route[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / step));
    for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }
  return out;
};
const inRect = (p: P, r: { x: number; z: number; w: number; d: number }, pad = 0) => p[0] > r.x - pad && p[0] < r.x + r.w + pad && p[1] > r.z - pad && p[1] < r.z + r.d + pad;
const routes = () => [...plan.seats.map((s) => ({ id: s.id, route: s.route, end: [s.x, s.z] as P })), { id: "entry", route: plan.entry, end: [plan.lobby[0], plan.lobby[2]] as P }];

describe("Community Pavilion & Café: placement", () => {
  it("sits on the empty square below the Atlas Automation Plaza", () => {
    expect(plan).toBeDefined();
    const lot = scene.clearedLots!.find((c) => c.projectId === "street-reserve:intelligence-hub")!;
    expect(Math.abs(plan.lot.x + plan.lot.w / 2 - lot.x)).toBeLessThan(0.5);
    // East of the plaza, on the same street block.
    expect(plan.lot.x).toBeGreaterThan(scene.plaza!.cx);
    expect(Math.abs(plan.lot.z + plan.lot.d / 2 - scene.plaza!.cz)).toBeLessThan(1.5);
    // Everything it builds stays on the square.
    for (const r of [plan.building, plan.pergola, ...plan.planters]) {
      expect(r.x).toBeGreaterThanOrEqual(plan.lot.x - 1e-6);
      expect(r.z).toBeGreaterThanOrEqual(plan.lot.z - 1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(plan.lot.x + plan.lot.w + 1e-6);
      expect(r.z + r.d).toBeLessThanOrEqual(plan.lot.z + plan.lot.d + 1e-6);
    }
  });

  it("keeps clear of streets, crossings, paths, towers and the plaza", () => {
    const b = plan.building;
    const corners: P[] = [[b.x, b.z], [b.x + b.w, b.z], [b.x, b.z + b.d], [b.x + b.w, b.z + b.d]];
    const things: P[] = [...corners, ...plan.seats.map((s) => [s.x, s.z] as P), ...plan.tables.map((t) => [t.x, t.z] as P), ...plan.lamps];
    for (const c of scene.transportConnections) for (const p of things) expect(distanceToRoad(p, c.road)).toBeGreaterThan(ROAD_W / 2 + 0.2);
    // No street walk or crossing runs through the pavilion, the pergola or a table.
    for (const w of scene.walks) {
      const pts = (w.route ? w.route.map((q) => [q.gx, q.gy]) : [[w.x0, w.z0], [w.x1, w.z1]]) as P[];
      const path = samples(pts.map(([x, z]) => [x, 0, z] as Pt3));
      expect(path.some((p) => inRect(p, b, 0.05) || inRect(p, plan.pergola))).toBe(false);
      for (const t of plan.tables) expect(path.every((p) => Math.hypot(p[0] - t.x, p[1] - t.z) > 0.3)).toBe(true);
    }
    for (const t of [...scene.towers, ...scene.kiosks]) expect(inRect([t.x, t.z], plan.lot, t.size / 2)).toBe(false);
    expect(inRect([scene.plaza!.cx, scene.plaza!.cz], plan.lot, 2)).toBe(false);
  });

  it("leaves the avenue palm standing and every seat and route clear of it", () => {
    const palms = avenuePlanting(scene).filter((p) => inRect([p.x, p.z], plan.lot));
    for (const palm of palms) {
      for (const s of plan.seats) expect(Math.hypot(s.x - palm.x, s.z - palm.z)).toBeGreaterThan(0.2);
      for (const r of routes()) expect(samples(r.route).every((p) => Math.hypot(p[0] - palm.x, p[1] - palm.z) > 0.12)).toBe(true);
    }
  });
});

describe("Community Pavilion & Café: sized for the agents", () => {
  it("fits a standing agent through the door, under the ceiling, the pergola and the umbrellas", () => {
    expect(CAFE.door.width).toBeGreaterThanOrEqual(2 * passWidth); // two abreast, one in and one out
    expect(CAFE.door.height).toBeGreaterThanOrEqual(standingClearHeight);
    expect(CAFE.ceiling).toBeGreaterThanOrEqual(standingClearHeight + 0.15);
    expect(CAFE.pergolaHeight).toBeGreaterThanOrEqual(standingClearHeight + 0.15);
    expect(CAFE.umbrella.low).toBeGreaterThanOrEqual(standingClearHeight + 0.05);
    expect(plan.door.z1 - plan.door.z0).toBeCloseTo(CAFE.door.width, 6);
  });

  it("puts seats at hip height, tables just above them and the counter at waist height", () => {
    expect(CAFE.seat).toBe(SEAT_HEIGHT);
    expect(CAFE.tableTop).toBeGreaterThan(CAFE.seat);
    expect(CAFE.tableTop).toBeLessThan(CAFE.seat + seatedClearHeight / 2);
    expect(CAFE.counterTop).toBeGreaterThan(AGENT_BODY.standingHeight * 0.45);
    expect(CAFE.counterTop).toBeLessThan(AGENT_BODY.standingHeight * 0.7);
    for (const s of plan.seats) expect(s.y).toBeCloseTo((s.area === "indoor" ? CAFE.floor : CAFE_GROUND + 0.01) + SEAT_HEIGHT, 6);
  });

  it("spaces seats a seated agent's shoulders apart, and counter places wide enough to pass", () => {
    for (let i = 0; i < plan.seats.length; i++)
      for (let j = i + 1; j < plan.seats.length; j++) expect(Math.hypot(plan.seats[i].x - plan.seats[j].x, plan.seats[i].z - plan.seats[j].z)).toBeGreaterThanOrEqual(AGENT_BODY.shoulderWidth);
    const c = plan.counterSpots;
    for (let i = 1; i < c.length; i++) expect(c[i].x - c[i - 1].x).toBeGreaterThanOrEqual(passWidth);
    // Standing at the counter: in front of it, inside the room.
    for (const s of c) expect(s.z).toBeGreaterThan(plan.counter.z + plan.counter.d);
  });

  it("holds the 17 agents with seats to spare", () => {
    expect(plan.seats.length).toBeGreaterThanOrEqual(20);
    const by = (a: string) => plan.seats.filter((s) => s.area === a).length;
    expect([by("indoor"), by("terrace"), by("bench")]).toEqual([4, 12, 4]);
  });
});

describe("Community Pavilion & Café: walking routes", () => {
  const b = plan.building;
  const inner = { x: b.x + CAFE.wall, z: b.z + CAFE.wall, w: b.w - 2 * CAFE.wall, d: b.d - 2 * CAFE.wall };

  it("starts every seat route at the lobby and ends on its seat", () => {
    for (const s of plan.seats) {
      expect(s.route[0]).toEqual(plan.lobby);
      const end = s.route[s.route.length - 1];
      expect([end[0], end[2]]).toEqual([s.x, s.z]);
    }
    expect(plan.entry[plan.entry.length - 1]).toEqual(plan.lobby);
  });

  it("crosses the pavilion's walls only through the door", () => {
    for (const r of routes())
      for (const p of samples(r.route)) {
        if (!inRect(p, b) || inRect(p, inner)) continue;
        // In a wall band: must be the west wall's door opening.
        expect(p[0], `${r.id} at ${p}`).toBeLessThanOrEqual(b.x + CAFE.wall + 1e-6);
        expect(p[1], `${r.id} at ${p}`).toBeGreaterThan(plan.door.z0 + AGENT_BODY.shoulderWidth / 2 - 0.02);
        expect(p[1], `${r.id} at ${p}`).toBeLessThan(plan.door.z1 - AGENT_BODY.shoulderWidth / 2 + 0.02);
      }
  });

  it("never walks through another seat, a table, the counter, a planter, a lamp or a pergola post", () => {
    const P = plan.pergola;
    const posts: P[] = [[P.x, P.z], [P.x + P.w, P.z], [P.x, P.z + P.d], [P.x + P.w, P.z + P.d]];
    for (const r of routes()) {
      const pts = samples(r.route);
      for (const s of plan.seats) if (s.x !== r.end[0] || s.z !== r.end[1]) expect(pts.every((p) => Math.hypot(p[0] - s.x, p[1] - s.z) > 0.1), `${r.id} past ${s.id}`).toBe(true);
      for (const t of plan.tables) expect(pts.every((p) => Math.hypot(p[0] - t.x, p[1] - t.z) > CAFE.tableRadius + 0.05), `${r.id} past a table`).toBe(true);
      for (const q of [...posts, ...plan.lamps]) expect(pts.every((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.06), `${r.id} past a post or lamp`).toBe(true);
      expect(pts.some((p) => inRect(p, plan.counter)), `${r.id} through the counter`).toBe(false);
      for (const pl of plan.planters) expect(pts.some((p) => inRect(p, pl)), `${r.id} through a planter`).toBe(false);
    }
  });

  it("keeps the doorway free: no seat, counter or queue place stands in the walk in", () => {
    const walkIn = samples(plan.entry);
    const places: P[] = [...plan.seats.map((s) => [s.x, s.z] as P), ...[0, 1, 2, 3, 4, 5].map((i) => counterPoint(plan, i)).map((p) => [p[0], p[2]] as P)];
    for (const q of places) expect(walkIn.every((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) > passWidth / 2)).toBe(true);
  });

  it("gives a visit cut short by work enough time to walk out from the farthest seat", () => {
    const pace = 0.45;
    const longest = Math.max(...plan.seats.map((s) => samples(s.route).length * 0.02));
    expect(plan.leaveSecs * pace).toBeGreaterThanOrEqual(longest * 0.95);
  });
});

// ------------------------------------------------------------------------------------- visits

const CAFE_OPTION: LeisureOption = { id: "cafe", kind: "cafe", label: "At the Community Pavilion & Café", spot: "cafe", exit: "cafe", stay: [480, 1500], leave: plan.leaveSecs };
const routine = (personaId: string, stays: [number, number][]): Routine => ({
  personaId,
  validUntil: Infinity,
  episodes: [],
  held: false,
  segments: stays.map(([t0, t1]) => ({ kind: "stay" as const, t0, t1, at: "cafe", activity: "relaxing" as const, phase: null, note: CAFE_OPTION.label, option: CAFE_OPTION })),
});
const T0 = Date.parse("2026-11-19T15:00:00Z");
const MIN = 60_000;

describe("café visits: seats and counter places", () => {
  it("never gives two agents the same seat or counter place at the same time", () => {
    // 30 agents arriving over 20 minutes, staying 8 to 25 minutes: more than the seats.
    const rs = new Map<string, Routine>();
    for (let i = 0; i < 30; i++) {
      const t0 = T0 + ((i * 7) % 20) * MIN;
      rs.set(`agent-${i}`, routine(`agent-${i}`, [[t0, t0 + (8 + ((i * 5) % 17)) * MIN]]));
    }
    const visits = [...cafeVisits(rs, plan).values()].flat();
    for (let i = 0; i < visits.length; i++)
      for (let j = i + 1; j < visits.length; j++) {
        const [a, b] = [visits[i], visits[j]];
        const overlap = a.t0 < b.t1 && b.t0 < a.t1;
        if (!overlap) continue;
        if (a.seat !== null) expect(a.seat).not.toBe(b.seat);
      }
    // With more visitors than seats, the extra ones stand at the counter instead.
    expect(visits.some((v) => v.seat === null)).toBe(true);
    // The same routines give the same seats.
    expect([...cafeVisits(rs, plan).values()].flat()).toEqual(visits);
  });

  it("seats every one of 17 agents arriving together", () => {
    const rs = new Map<string, Routine>();
    for (let i = 0; i < 17; i++) rs.set(`agent-${i}`, routine(`agent-${i}`, [[T0, T0 + 20 * MIN]]));
    const visits = [...cafeVisits(rs, plan).values()].flat();
    expect(visits.every((v) => v.seat !== null)).toBe(true);
    expect(new Set(visits.map((v) => v.seat)).size).toBe(17);
    const now = cafeNow(rs, plan, T0 + 10 * MIN);
    expect(now.visitors.length).toBe(17);
    const free = now.free.indoor + now.free.terrace + now.free.bench;
    expect(free).toBe(plan.seats.length - 17);
  });

  it("frees a seat when its visit ends", () => {
    const rs = new Map<string, Routine>([["a", routine("a", [[T0, T0 + 10 * MIN]])]]);
    expect(cafeNow(rs, plan, T0 + 5 * MIN).visitors.length).toBe(1);
    const after = cafeNow(rs, plan, T0 + 11 * MIN);
    expect(after.visitors.length).toBe(0);
    expect(after.free.indoor + after.free.terrace + after.free.bench).toBe(plan.seats.length);
  });
});

describe("café visits: arrive, counter, seat, leave", () => {
  const rs = new Map<string, Routine>([["a", routine("a", [[T0, T0 + 15 * MIN]])]]);
  const v = cafeVisits(rs, plan).get("a")![0];

  it("walks in from the lobby, stops at the counter, sits, and walks back out to the lobby", () => {
    const at = (ms: number) => cafeMoment(plan, v, T0 + ms);
    const start = at(0);
    expect(start.phase).toBe("arriving");
    expect([start.x, start.z]).toEqual([plan.lobby[0], plan.lobby[2]]);
    const phases = Array.from({ length: 901 }, (_, i) => at(i * 1000).phase).filter((p, i, a) => p !== a[i - 1]);
    expect(phases).toEqual(["arriving", "counter", "to_seat", "seated", "leaving"]);
    const seated = at(8 * MIN);
    const seat = plan.seats[v.seat!];
    expect([seated.x, seated.z, seated.seatY]).toEqual([seat.x, seat.z, seat.y]);
    const end = at(15 * MIN - 1);
    expect(end.phase).toBe("leaving");
    expect(Math.hypot(end.x - plan.lobby[0], end.z - plan.lobby[2])).toBeLessThan(0.05);
  });

  it("only ever stands where the route or a seat puts it", () => {
    const seat = plan.seats[v.seat!];
    const path = samples([plan.lobby, counterPoint(plan, v.counter), ...seatPath(plan, seat, counterPoint(plan, v.counter)).slice(1)]);
    for (let ms = 0; ms < 15 * MIN; ms += 3000) {
      const m = cafeMoment(plan, v, T0 + ms);
      expect(Math.min(...path.map((p) => Math.hypot(p[0] - m.x, p[1] - m.z)))).toBeLessThan(0.03);
    }
  });

  it("a visit cut short by work skips the seat and still ends back at the lobby", () => {
    const short = { ...v, t1: v.t0 + 40_000 };
    const m = cafeMoment(plan, short, short.t1 - 1);
    expect(["leaving", "counter"]).toContain(m.phase);
    expect(Array.from({ length: 40 }, (_, i) => cafeMoment(plan, short, short.t0 + i * 1000).phase)).not.toContain("seated");
    expect(Math.hypot(m.x - plan.lobby[0], m.z - plan.lobby[2])).toBeLessThan(0.05);
  });
});
