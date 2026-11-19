import type { Rect, Scene3D } from "./scene";
import type { Pt, Pt3 } from "./roads";
import { AGENT_BODY, SEAT_HEIGHT, passWidth, seatedClearHeight, standingClearHeight } from "./agentBody";

/**
 * Community Pavilion & Café (Khaneil, 2026-11-19): a low cream-stone pavilion with a forest-green roof on
 * the empty paved square the Intelligence Hub left beside the Atlas Automation Plaza, between the
 * operations street to the north and the boulevard to the south. Nothing around it moves: the square's
 * paving, both streets, their sidewalks and the crossing that lands on its north edge stay as they are.
 *
 * Everything is in world units and sized from the agents' real bodies (agentBody.ts): doors pass one agent
 * each way, seats sit at hip height, aisles are at least one agent wide, and the ceiling clears a standing
 * agent. The floating portrait badge plays no part in any of it.
 *
 * The entrance faces west, toward the plaza; the terrace under the pergola is on the west side too, so
 * the view from the plaza's steps across the square stays open and low. The square's south-east corner,
 * where an existing path crosses it, and a walkway from the crossing to the door stay clear.
 */
export const CAFE_KEY = "service:community-cafe";
export const CAFE_NAME = "Community Pavilion & Café";
/** The cleared lot whose paved square the café takes. */
export const CAFE_LOT = "street-reserve:intelligence-hub";

/** Ground and floor heights. The square's paving is 0.03 thick on the terrace (TERRACE_H). */
export const CAFE_GROUND = 0.63;
export const CAFE = {
  /** Interior floor: one shallow step above the paving. */
  floor: CAFE_GROUND + 0.03,
  /** Ground floor to ceiling: a standing agent and its clearance, with room for pendant lights above. */
  ceiling: 0.7,
  /** Two floors (Khaneil, 2026-11-19): a stone floor band, then an upper storey of windows under the roof. */
  floorBand: 0.08,
  upper: 0.62,
  wall: 0.05,
  /** The double entrance door: two agents abreast (one in, one out), and a standing agent's clear height. */
  door: { width: 2 * passWidth, height: standingClearHeight + 0.12 },
  /** The roof: a slab, a gold fascia band, then the green hipped roof with a small overhang. */
  slab: 0.06,
  fascia: 0.08,
  roofRise: 0.48,
  overhang: 0.12,
  /** Counter top at about an agent's waist (1.05 m on a 1.8 m agent); table tops a little lower. */
  counterTop: AGENT_BODY.standingHeight * 0.58,
  counterDepth: 0.2,
  tableTop: SEAT_HEIGHT + 0.035,
  tableRadius: 0.085,
  /** Chair seat surface (hip height, so seated legs rest level) and seat size. */
  seat: SEAT_HEIGHT,
  seatSize: 0.12,
  /** Seat centre to its table's centre. */
  chairGap: 0.2,
  /** The pergola's beams clear a standing agent with room to spare. */
  pergolaHeight: 0.62,
  /** Cream umbrellas: canopy edge above a standing agent's head. */
  umbrella: { radius: 0.3, low: 0.5, rise: 0.12 },
  /** Seconds standing at the counter (the shortest and longest visit), before taking a seat. */
  counterHold: [12, 32] as [number, number],
} as const;

export type SeatArea = "indoor" | "terrace" | "bench";
export interface CafeSeat {
  id: string;
  area: SeatArea;
  /** "Terrace table 2", "Indoor table 1", "Bench". */
  label: string;
  /** The hip point: centre of the seat surface, world. */
  x: number;
  z: number;
  /** Seat surface height. */
  y: number;
  /** Facing (0 faces +z, as the figures do). */
  yaw: number;
  /** From the lobby just inside the door to the seat (last point), walking. */
  route: Pt3[];
}
export interface CounterSpot {
  x: number;
  z: number;
  yaw: number;
  /** A place in line behind the counter spot, when all three are taken. */
  queue: Pt;
}
export interface CafeTable {
  x: number;
  z: number;
  area: Exclude<SeatArea, "bench">;
  umbrella: boolean;
}

export interface CafePlan {
  /** The paved square the café uses (clipped to the street kerbs). */
  lot: Rect;
  /** The pavilion's walls, outer faces. */
  building: Rect;
  /** Street sidewalk, crossing landing, outside the door, inside the door (lobby): the walk in. */
  entry: Pt3[];
  /** Just inside the door: every visit starts and ends here. */
  lobby: Pt3;
  /** Outside the door, on the walkway. */
  doorOutside: Pt3;
  /** The door opening on the west wall: its z range. */
  door: { x: number; z0: number; z1: number };
  counter: Rect;
  counterSpots: CounterSpot[];
  seats: CafeSeat[];
  tables: CafeTable[];
  /** Pergola footprint (posts at its corners). */
  pergola: Rect;
  benches: { x: number; z: number; yaw: number; length: number }[];
  planters: Rect[];
  lamps: Pt[];
  /** Longest walk from any seat back out to the lobby, seconds at PACE: a visit cut short by work needs this to get out. */
  leaveSecs: number;
}

/** Walking pace (routinePlaces.ts PACE), repeated so the plan needs no renderer imports. */
const PACE = 0.45;

const len = (p: readonly Pt3[]) => p.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - p[i][0], q[2] - p[i][2]), 0);

/**
 * The café on the square the Intelligence Hub left, or undefined when that square isn't on the map (another
 * grouping, a different catalog) or is too small to hold it with its terrace and clear walkways.
 */
export function planCafe(s: Pick<Scene3D, "clearedLots" | "paving" | "transportConnections" | "plaza">): CafePlan | undefined {
  const lot = s.clearedLots?.find((c) => c.projectId === CAFE_LOT);
  if (!lot) return undefined;
  // Its paved square: the slab that holds the lot's centre and is at least as big as the lot.
  const square = s.paving.find((p) => p.w >= lot.size && p.d >= lot.size && Math.abs(p.x + p.w / 2 - lot.x) < 0.3 && Math.abs(p.z + p.d / 2 - lot.z) < 0.3);
  if (!square) return undefined;
  // Clip to the kerbs of any street running along or into the square.
  const x0 = square.x, x1 = square.x + square.w;
  let z0 = square.z, z1 = square.z + square.d;
  const kerb = 0.36;
  for (const c of s.transportConnections)
    for (let i = 1; i < c.road.length; i++) {
      const [a, b] = [c.road[i - 1], c.road[i]];
      if (Math.abs(a[1] - b[1]) < 1e-6 && Math.min(a[0], b[0]) < x1 && Math.max(a[0], b[0]) > x0) {
        const z = a[1];
        if (z > z0 && z < z1 + kerb) z1 = Math.min(z1, z - kerb);
        if (z < z1 && z > z0 - kerb) z0 = Math.max(z0, z + kerb);
      }
    }
  const W = x1 - x0, D = z1 - z0;
  if (W < 4 || D < 3.3) return undefined;
  // The plaza is to the west; the plan below faces its entrance and terrace that way.
  if (s.plaza && s.plaza.cx > x0) return undefined;

  const X = (dx: number) => x0 + dx, Z = (dz: number) => z0 + dz;
  const G = CAFE_GROUND, F = CAFE.floor;
  // Pavilion in the square's north-east, clear of the path across its south-east corner.
  const building: Rect = { x: X(2.14), z: Z(0.14), w: Math.min(1.9, W - 2.29), d: 1.6 };
  const bx1 = building.x + building.w, bz1 = building.z + building.d;
  const inner = { x0: building.x + CAFE.wall, x1: bx1 - CAFE.wall, z0: building.z + CAFE.wall, z1: bz1 - CAFE.wall };
  const doorZ = building.z + 0.82;
  const door = { x: building.x, z0: doorZ - CAFE.door.width / 2, z1: doorZ + CAFE.door.width / 2 };
  // The walkway from the crossing on the north edge down past the door, between the pergola and the pavilion.
  const walkX = building.x - 0.35;
  const doorOutside: Pt3 = [walkX, G, doorZ];
  const lobby: Pt3 = [inner.x0 + 0.15, F, doorZ];
  const entry: Pt3[] = [[walkX, G + 0.075, z0 - 0.72], [walkX, G, z0 + 0.07], doorOutside, [building.x + 0.07, F, doorZ], lobby];

  // Counter along the north wall, three places to stand at it, and a line behind them.
  const counter: Rect = { x: inner.x1 - 1.2, z: inner.z0, w: 1.15, d: CAFE.counterDepth };
  const standZ = counter.z + counter.d + AGENT_BODY.depth / 2 + AGENT_BODY.clearance + 0.02;
  const counterSpots: CounterSpot[] = [0.3, 0.6, 0.9].map((f) => ({ x: counter.x + counter.w * f - 0.05, z: standZ, yaw: Math.PI, queue: [counter.x + counter.w * f - 0.05, standZ + 0.3] as Pt }));

  const seats: CafeSeat[] = [];
  const tables: CafeTable[] = [];
  const seatY = (area: SeatArea) => (area === "indoor" ? F : G + 0.01) + CAFE.seat;
  // Indoor: two tables along the south glass, a chair either side; reached from the aisle in front of the counter.
  const aisleZ = standZ + 0.5;
  const indoorZ = inner.z1 - 0.33;
  [inner.x0 + 0.45, inner.x0 + 1.25].forEach((tx, t) => {
    tables.push({ x: tx, z: indoorZ, area: "indoor", umbrella: false });
    for (const side of [-1, 1]) {
      const x = tx + side * (CAFE.chairGap - 0.01);
      seats.push({ id: `indoor-${t + 1}-${side < 0 ? "w" : "e"}`, area: "indoor", label: `Indoor table ${t + 1}`, x, z: indoorZ, y: seatY("indoor"), yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, route: [lobby, [x, F, aisleZ], [x, F, indoorZ]] });
    }
  });

  // Terrace: three tables of four down the west side, the north two under the pergola, the south one under an umbrella.
  const tx = X(0.89);
  const eastAisle = tx + 0.44;
  const pitch = 0.95;
  const terraceZ = [Z(0.69), Z(0.69 + pitch), Z(0.69 + 2 * pitch)];
  terraceZ.forEach((tz, t) => {
    tables.push({ x: tx, z: tz, area: "terrace", umbrella: t === 2 });
    const south = tz + pitch / 2;
    const out: Pt3[] = [lobby, [building.x + 0.07, F, doorZ], doorOutside, [walkX, G, south], [eastAisle, G, south]];
    const g = CAFE.chairGap, y = seatY("terrace");
    const label = `Terrace table ${t + 1}`;
    seats.push(
      { id: `terrace-${t + 1}-n`, area: "terrace", label, x: tx, z: tz - g, y, yaw: 0, route: [...out, [eastAisle, G, tz - g], [tx + g, G, tz - g], [tx, G, tz - g]] },
      { id: `terrace-${t + 1}-e`, area: "terrace", label, x: tx + g, z: tz, y, yaw: -Math.PI / 2, route: [...out, [eastAisle, G, tz + g], [tx + g, G, tz + g], [tx + g, G, tz]] },
      { id: `terrace-${t + 1}-s`, area: "terrace", label, x: tx, z: tz + g, y, yaw: Math.PI, route: [...out, [tx + g, G, south], [tx + g, G, tz + g], [tx, G, tz + g]] },
      { id: `terrace-${t + 1}-w`, area: "terrace", label, x: tx - g, z: tz, y, yaw: Math.PI / 2, route: [...out, [tx - g, G, south], [tx - g, G, tz + g], [tx - g, G, tz]] },
    );
  });
  const pergola: Rect = { x: tx - 0.78, z: Z(0.11), w: 1.46, d: Z(0.69 + pitch + pitch / 2 + 0.17) - Z(0.11) };

  // Two benches on the open paving south of the pavilion, facing it; sat from the front.
  const benchZ = z1 - 0.32;
  const benches = [walkX + 0.88, walkX + 1.38].map((x) => ({ x, z: benchZ, yaw: Math.PI, length: 0.48 }));
  benches.forEach((b, i) => {
    for (const side of [-1, 1]) {
      const x = b.x + side * 0.12;
      seats.push({ id: `bench-${i + 1}-${side < 0 ? "w" : "e"}`, area: "bench", label: "Bench", x, z: b.z, y: G + 0.01 + CAFE.seat, yaw: Math.PI, route: [lobby, [building.x + 0.07, F, doorZ], doorOutside, [walkX, G, bz1 + 0.6], [x, G, bz1 + 0.6], [x, G, b.z - 0.25], [x, G, b.z]] });
    }
  });

  // Flowering planters: along the street edge of the terrace, either side of the door, and along the east wall.
  const planters: Rect[] = [
    { x: X(0.1), z: z0 + 0.02, w: walkX - 0.3 - X(0.1), d: 0.08 },
    { x: building.x - 0.12, z: building.z + 0.08, w: 0.1, d: door.z0 - 0.06 - (building.z + 0.08) },
    { x: building.x - 0.12, z: door.z1 + 0.06, w: 0.1, d: bz1 - 0.08 - (door.z1 + 0.06) },
    { x: bx1 + 0.03, z: building.z + 0.1, w: 0.1, d: building.d - 0.2 },
    { x: X(0.1), z: z1 - 0.16, w: 0.5, d: 0.1 },
  ];
  const lamps: Pt[] = [
    [pergola.x - 0.06, z1 - 0.12],
    [walkX + 0.22, bz1 + 0.35],
    [bx1 + 0.08, bz1 + 0.12],
    [walkX + 0.22, z0 + 0.09],
  ];
  const leaveSecs = Math.ceil(Math.max(...seats.map((q) => len(q.route)), ...counterSpots.map((c) => Math.hypot(c.x - lobby[0], c.z - lobby[2]))) / PACE) + 2;
  return { lot: { x: x0, z: z0, w: W, d: D }, building, entry, lobby, doorOutside, door, counter, counterSpots, seats, tables, pergola, benches, planters, lamps, leaveSecs };
}

/** Clearances the tests and the renderer agree on. */
export const CAFE_FIT = {
  passWidth,
  standingClearHeight,
  seatedClearHeight,
} as const;
