import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Instanced, type Inst, type PickHandlerSet, type useGeometries, type useMaterials } from "./models";
import { CAFE, CAFE_GROUND, CAFE_KEY, CAFE_NAME, type CafePlan } from "./cafePlan";

/**
 * Community Pavilion & Café (cafePlan.ts): a low cream-stone pavilion with a forest-green hipped roof and
 * a restrained gold fascia, glass on its west and south fronts so the counter and tables read from the
 * plaza and the map's camera, a pergola terrace with tables, chairs and cream umbrellas, benches,
 * flowering planters and warm lamps.
 *
 * Draw cost is kept to a handful of calls: every solid part is one instanced box mesh in the map's shared
 * plain material (per-instance colours), with the round parts (table tops, planting and, by day, the lamp
 * globes) as one ball mesh, the umbrella canopies as one more (neither casts shadows), the hipped roof, one
 * merged glass mesh and one merged sign: six draws by day. No lights are added: lamps and the
 * interior glow use the map's shared lamp material, which lights up at night. In the Inside view the
 * roof and ceiling lift away (like the headquarters cutaways) so the room shows from above.
 */
const C = {
  stone: "#efe6d2",
  cream: "#f3ead6",
  plinth: "#ddd1b6",
  floor: "#d9c6a2",
  deck: "#e4d8bf",
  green: "#2f5a43",
  roof: "#335f47",
  gold: "#c9a35a",
  wood: "#b68c60",
  timber: "#b99467",
  iron: "#294237",
  marble: "#f4efe4",
  soil: "#4e5b3a",
  leaf: "#5f8f45",
  canvas: "#f4ecd8",
  dark: "#3b3a36",
} as const;

const SIGN_TEXT = "COMMUNITY PAVILION & CAFÉ";

/** The fascia sign: forest green with a gold rule and letter-spaced gold capitals. */
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#1f3a2c";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "#d9b45f";
  g.lineWidth = 5;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = "#e8c877";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '500 60px ui-serif, "New York", "Iowan Old Style", Georgia, serif';
  g.fillText(SIGN_TEXT.split("").join(String.fromCharCode(8202)), c.width / 2, c.height / 2 + 3, c.width - 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A box between y0 and y1 over an axis-aligned rect (the shared box geometry stands on its base). */
const block = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, c: string): Inst => ({ p: [(x0 + x1) / 2, y0, (z0 + z1) / 2], s: [Math.abs(x1 - x0), y1 - y0, Math.abs(z1 - z0)], c });

export interface CafeParts {
  solid: Inst[];
  roof: Inst[];
  hip: Inst[];
  tops: Inst[];
  canopies: Inst[];
  leaves: Inst[];
  lamps: Inst[];
  glow: Inst[];
  /** Glass panes as thin boxes: [x0, z0, x1, z1, y0, y1]. */
  glass: [number, number, number, number, number, number][];
  /** Sign faces: centre, width, height and the way it faces (yaw). */
  signs: { x: number; y: number; z: number; w: number; h: number; yaw: number }[];
}

/** Every part of the café, from its plan. Pure, so the tests can check heights and clearances. */
export function cafeParts(p: CafePlan): CafeParts {
  const out: CafeParts = { solid: [], roof: [], hip: [], tops: [], canopies: [], leaves: [], lamps: [], glow: [], glass: [], signs: [] };
  const { solid, roof } = out;
  const G = CAFE_GROUND, F = CAFE.floor, b = p.building, W = CAFE.wall;
  const x0 = b.x, z0 = b.z, x1 = b.x + b.w, z1 = b.z + b.d;
  const top = F + CAFE.ceiling;
  // Plinth and floors.
  solid.push(block(x0 - 0.04, z0 - 0.04, x1 + 0.04, z1 + 0.04, G, F - 0.004, C.plinth));
  solid.push(block(x0 + W, z0 + W, x1 - W, z1 - W, F - 0.004, F, C.floor));
  solid.push(block(p.pergola.x, p.pergola.z, p.pergola.x + p.pergola.w, p.lot.z + p.lot.d - 0.06, G, G + 0.01, C.deck));
  // A step at the door.
  solid.push(block(x0 - 0.1, p.door.z0, x0, p.door.z1, G, G + 0.015, C.plinth));
  // Solid north and east walls.
  solid.push(block(x0, z0, x1, z0 + W, F, top, C.cream));
  solid.push(block(x1 - W, z0, x1, z1, F, top, C.cream));
  // West front: corner piers, the door's piers and a header over it; low sills under the glass.
  const sill = 0.07, pier = 0.08;
  solid.push(block(x0, z1 - pier, x0 + W, z1, F, top, C.stone), block(x0, z0, x0 + W, z0 + pier, F, top, C.stone));
  solid.push(block(x0, p.door.z0 - 0.04, x0 + W, p.door.z0, F, top, C.stone), block(x0, p.door.z1, x0 + W, p.door.z1 + 0.04, F, top, C.stone));
  solid.push(block(x0, p.door.z0, x0 + W, p.door.z1, F + CAFE.door.height, top, C.stone));
  solid.push(block(x0, z0 + pier, x0 + W, p.door.z0 - 0.04, F, F + sill, C.stone), block(x0, p.door.z1 + 0.04, x0 + W, z1 - pier, F, F + sill, C.stone));
  // Gold door frame.
  for (const z of [p.door.z0, p.door.z1]) solid.push(block(x0 - 0.008, z - 0.008, x0 + 0.004, z + 0.008, F, F + CAFE.door.height, C.gold));
  solid.push(block(x0 - 0.008, p.door.z0, x0 + 0.004, p.door.z1, F + CAFE.door.height - 0.012, F + CAFE.door.height, C.gold));
  out.glass.push([x0 + 0.02, z0 + pier, x0 + 0.032, p.door.z0 - 0.04, F + sill, top], [x0 + 0.02, p.door.z1 + 0.04, x0 + 0.032, z1 - pier, F + sill, top]);
  // South front: corner piers, a middle pier, a sill, glass between.
  const mid = (x0 + x1) / 2;
  solid.push(block(x1 - pier, z1 - W, x1, z1, F, top, C.stone), block(mid - 0.035, z1 - W, mid + 0.035, z1, F, top, C.stone));
  solid.push(block(x0 + pier, z1 - W, x1 - pier, z1, F, F + sill, C.stone));
  out.glass.push([x0 + pier, z1 - 0.032, mid - 0.035, z1 - 0.02, F + sill, top], [mid + 0.035, z1 - 0.032, x1 - pier, z1 - 0.02, F + sill, top]);
  // Slim gold mullions on the glass.
  for (const z of [(z0 + p.door.z0) / 2, (p.door.z1 + z1) / 2]) solid.push(block(x0 - 0.004, z - 0.006, x0 + 0.01, z + 0.006, F + sill, top, C.gold));
  for (const x of [(x0 + mid) / 2, (mid + x1) / 2]) solid.push(block(x - 0.006, z1 - 0.01, x + 0.006, z1 + 0.004, F + sill, top, C.gold));

  // The roof and the signs on its fascia (they lift away in the Inside view): ceiling slab, gold fascia band, green hipped roof, gold ridge.
  roof.push(block(x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02, top, top + CAFE.slab, C.stone));
  roof.push(block(x0 - CAFE.overhang, z0 - CAFE.overhang, x1 + CAFE.overhang, z1 + CAFE.overhang, top + CAFE.slab, top + CAFE.slab + CAFE.fascia, C.gold));
  const roofY = top + CAFE.slab + CAFE.fascia;
  out.hip.push({ p: [mid, roofY, (z0 + z1) / 2], s: [b.w + 2 * CAFE.overhang, CAFE.roofRise, b.d + 2 * CAFE.overhang], c: C.roof });
  roof.push({ p: [mid, roofY + CAFE.roofRise - 0.012, (z0 + z1) / 2], s: [(b.w + 2 * CAFE.overhang) * 0.44, 0.024, 0.03], c: C.gold });
  // The sign over the door and along the south front, on the fascia's face below the band.
  const signH = 0.11;
  roof.push(block(x0 - 0.035, p.door.z0 - 0.18, x0, p.door.z1 + 0.18, top - signH - 0.02, top, C.green));
  out.signs.push({ x: x0 - 0.037, y: top - signH / 2 - 0.01, z: (p.door.z0 + p.door.z1) / 2, w: p.door.z1 - p.door.z0 + 0.32, h: signH * 0.86, yaw: -Math.PI / 2 });
  roof.push(block(mid - 0.62, z1, mid + 0.62, z1 + 0.035, top - signH - 0.02, top, C.green));
  out.signs.push({ x: mid, y: top - signH / 2 - 0.01, z: z1 + 0.037, w: 1.2, h: signH * 0.86, yaw: 0 });

  // Counter: stone body, marble top with a gold edge, an espresso machine and a pastry case; a back bar on the wall.
  const k = p.counter;
  solid.push(block(k.x, k.z, k.x + k.w, k.z + k.d, F, F + CAFE.counterTop - 0.015, C.stone));
  solid.push(block(k.x - 0.01, k.z, k.x + k.w + 0.01, k.z + k.d + 0.012, F + CAFE.counterTop - 0.015, F + CAFE.counterTop, C.marble));
  solid.push(block(k.x, k.z + k.d, k.x + k.w, k.z + k.d + 0.006, F + CAFE.counterTop - 0.03, F + CAFE.counterTop - 0.02, C.gold));
  solid.push(block(k.x + 0.12, k.z + 0.03, k.x + 0.3, k.z + 0.13, F + CAFE.counterTop, F + CAFE.counterTop + 0.09, C.dark));
  solid.push(block(k.x + 0.12, k.z + 0.03, k.x + 0.3, k.z + 0.13, F + CAFE.counterTop + 0.09, F + CAFE.counterTop + 0.1, C.gold));
  solid.push(block(k.x + 0.55, k.z + 0.03, k.x + 0.95, k.z + 0.17, F + CAFE.counterTop, F + CAFE.counterTop + 0.06, "#e9dcc0"));
  solid.push(block(k.x, z0 + W, k.x + k.w, z0 + W + 0.05, F + 0.3, F + 0.315, C.wood), block(k.x, z0 + W, k.x + k.w, z0 + W + 0.05, F + 0.42, F + 0.435, C.wood));
  for (let i = 0; i < 9; i++) solid.push(block(k.x + 0.08 + i * 0.12, z0 + W + 0.01, k.x + 0.11 + i * 0.12, z0 + W + 0.04, F + 0.315, F + 0.35, i % 3 ? C.cream : C.green));
  // Pendant lights over the counter and indoor tables, and a warm ceiling panel.
  for (const s of p.counterSpots) out.lamps.push({ p: [s.x, top - 0.14, k.z + k.d / 2], s: [0.025, 0.025, 0.025] }, { p: [s.x, top - 0.12, k.z + k.d / 2], s: [0.004, 0.12, 0.004], c: C.dark });
  out.glow.push(block(x0 + 0.2, z0 + 0.25, x1 - 0.2, z1 - 0.25, top - 0.008, top, C.cream));

  // Tables and chairs.
  for (const t of p.tables) {
    const g = t.area === "indoor" ? F : G + 0.01;
    solid.push({ p: [t.x, g, t.z], s: [0.03, CAFE.tableTop - 0.012, 0.03], c: C.iron }, { p: [t.x, g, t.z], s: [0.1, 0.008, 0.1], c: C.iron });
    // A flattened ball reads as a round marble disc, and shares the planting's mesh (one draw fewer).
    out.tops.push({ p: [t.x, g + CAFE.tableTop - 0.006, t.z], s: [CAFE.tableRadius, 0.006, CAFE.tableRadius], c: C.marble });
    if (t.area === "indoor") out.lamps.push({ p: [t.x, top - 0.16, t.z], s: [0.028, 0.028, 0.028] }, { p: [t.x, top - 0.14, t.z], s: [0.004, 0.14, 0.004], c: C.dark });
    if (t.umbrella) {
      const U = CAFE.umbrella;
      solid.push({ p: [t.x, g + CAFE.tableTop, t.z], s: [0.014, U.low + U.rise - CAFE.tableTop, 0.014], c: C.cream });
      out.canopies.push({ p: [t.x, g + U.low, t.z], s: [U.radius * 2, U.rise, U.radius * 2], c: C.canvas });
      solid.push({ p: [t.x, g + U.low + U.rise - 0.005, t.z], s: [0.03, 0.025, 0.03], c: C.gold });
    }
  }
  for (const s of p.seats) {
    if (s.area === "bench") continue;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), q = CAFE.seatSize;
    const c = s.area === "indoor" ? C.wood : C.green;
    solid.push({ p: [s.x, s.y - 0.02, s.z], s: [q, 0.02, q], r: s.yaw, c });
    solid.push({ p: [s.x - fx * (q / 2 - 0.01), s.y, s.z - fz * (q / 2 - 0.01)], s: [q, 0.13, 0.018], r: s.yaw, c });
    const g = s.area === "indoor" ? F : G + 0.01;
    for (const [a, d] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = (a * q) / 2.6, lz = (d * q) / 2.6;
      solid.push({ p: [s.x + lx * Math.cos(s.yaw) + lz * fx, g, s.z - lx * Math.sin(s.yaw) + lz * fz], s: [0.012, s.y - 0.02 - g, 0.012], r: s.yaw, c: C.iron });
    }
  }

  // Pergola: four cream posts, timber beams along the terrace, slats across it.
  const pg = p.pergola, ph = G + CAFE.pergolaHeight;
  for (const [x, z] of [[pg.x, pg.z], [pg.x + pg.w, pg.z], [pg.x, pg.z + pg.d], [pg.x + pg.w, pg.z + pg.d]]) solid.push({ p: [x, G, z], s: [0.045, CAFE.pergolaHeight, 0.045], c: C.cream });
  for (const x of [pg.x, pg.x + pg.w]) solid.push(block(x - 0.025, pg.z - 0.06, x + 0.025, pg.z + pg.d + 0.06, ph, ph + 0.05, C.timber));
  for (let z = pg.z; z <= pg.z + pg.d + 1e-6; z += pg.d / 11) solid.push(block(pg.x - 0.08, z - 0.012, pg.x + pg.w + 0.08, z + 0.012, ph + 0.05, ph + 0.075, C.timber));
  // Climbing greenery along the pergola's beams.
  for (const x of [pg.x, pg.x + pg.w]) for (let i = 0; i < 6; i++) out.leaves.push({ p: [x, ph + 0.06, pg.z + (pg.d * (i + 0.5)) / 6], s: [0.06, 0.035, 0.12], c: i % 2 ? C.leaf : "#6e9b4e" });

  // Benches (the plaza's bench, a little longer).
  for (const bn of p.benches) {
    const part = (dx: number, y: number, dz: number, w: number, h: number, d: number, c: string): Inst => ({ p: [bn.x + dx * Math.cos(bn.yaw) + dz * Math.sin(bn.yaw), G + y, bn.z - dx * Math.sin(bn.yaw) + dz * Math.cos(bn.yaw)], s: [w, h, d], r: bn.yaw, c });
    const seatTop = 0.01 + CAFE.seat;
    solid.push(part(0, seatTop - 0.025, 0, bn.length, 0.025, 0.13, C.wood), part(0, seatTop, -0.07, bn.length, 0.13, 0.025, C.wood));
    for (const side of [-1, 1]) solid.push(part((side * bn.length) / 2.3, 0, 0, 0.03, seatTop - 0.025, 0.12, C.iron));
  }
  // Planters: stone boxes with soil, shrubs and flowers.
  p.planters.forEach((r, i) => {
    solid.push(block(r.x, r.z, r.x + r.w, r.z + r.d, G, G + 0.1, C.stone), block(r.x + 0.01, r.z + 0.01, r.x + r.w - 0.01, r.z + r.d - 0.01, G + 0.1, G + 0.105, C.soil));
    const along = r.w > r.d, n = Math.max(1, Math.round((along ? r.w : r.d) / 0.14));
    for (let j = 0; j < n; j++) {
      const f = (j + 0.5) / n, x = along ? r.x + r.w * f : r.x + r.w / 2, z = along ? r.z + r.d / 2 : r.z + r.d * f;
      out.leaves.push({ p: [x, G + 0.14, z], s: [0.05, 0.045, 0.05], c: (i + j) % 3 ? C.leaf : "#527f3c" });
      if (j % 2 === 0) out.leaves.push({ p: [x + 0.02, G + 0.18, z + 0.01], s: [0.022, 0.022, 0.022], c: ["#e58fb0", "#f4e6a1", "#f7f2ea", "#d9748f"][(i + j) % 4] });
    }
  });
  // Lamp posts: dark green iron, a globe that lights at night.
  for (const [x, z] of p.lamps) {
    solid.push({ p: [x, G, z], s: [0.03, 0.46, 0.03], c: C.iron }, { p: [x, G + 0.46, z], s: [0.05, 0.012, 0.05], c: C.gold });
    out.lamps.push({ p: [x, G + 0.5, z], s: [0.045, 0.045, 0.045] });
  }
  return out;
}

export default function CommunityCafe({ plan, g, m, pick, night, inside }: { plan?: CafePlan; g: ReturnType<typeof useGeometries>; m: ReturnType<typeof useMaterials>; pick: PickHandlerSet; night: boolean; inside: boolean }) {
  const parts = useMemo(() => (plan ? cafeParts(plan) : null), [plan]);
  const kit = useMemo(() => {
    if (!parts) return null;
    const pane = (q: CafeParts["glass"][number]) => new THREE.BoxGeometry(Math.max(q[2] - q[0], 0.004), q[5] - q[4], Math.max(q[3] - q[1], 0.004)).translate((q[0] + q[2]) / 2, (q[4] + q[5]) / 2, (q[1] + q[3]) / 2);
    const glassGeo = mergeGeometries(parts.glass.map(pane))!;
    const sign = mergeGeometries(parts.signs.map((s) => new THREE.PlaneGeometry(s.w, s.h).rotateY(s.yaw).translate(s.x, s.y, s.z)))!;
    // Same settings as the plaza's glass, so the map compiles no new shader for it.
    const glass = new THREE.MeshStandardMaterial({ color: "#d9ecf2", transparent: true, opacity: 0.3, roughness: 0.08, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide });
    const signTex = signTexture();
    const signFace = new THREE.MeshBasicMaterial({ map: signTex });
    return { glassGeo, sign, glass, signTex, signFace };
  }, [parts]);
  useEffect(
    () => () => {
      if (!kit) return;
      kit.glassGeo.dispose();
      kit.sign.dispose();
      kit.glass.dispose();
      kit.signTex.dispose();
      kit.signFace.dispose();
    },
    [kit],
  );
  useEffect(() => {
    if (!kit) return;
    kit.glass.emissive.set("#ffd98a");
    kit.glass.emissiveIntensity = night ? 0.42 : 0;
  }, [kit, night]);
  // One draw for every plain box: the walls and furniture, the roof slab and fascia (lifted away in the
  // Inside view, so the room shows from the map's camera) and, by day, the ceiling's light panel.
  const boxes = useMemo(() => (parts ? [...parts.solid, ...(inside ? [] : parts.roof), ...(inside || night ? [] : parts.glow)] : null), [parts, inside, night]);
  // Table tops, planting and (by day, when they are unlit) the lamp globes share one ball mesh.
  const rounds = useMemo(() => (parts ? [...parts.tops, ...parts.leaves, ...(night ? [] : parts.lamps)] : null), [parts, night]);
  const picks = useMemo(() => (parts && boxes ? { boxes: pick.of(boxes.map(() => CAFE_KEY)), hip: pick.of(parts.hip.map(() => CAFE_KEY)) } : null), [parts, boxes, pick]);
  if (!plan || !parts || !kit || !picks || !boxes || !rounds) return null;
  return (
    <group name="community-cafe" userData={{ label: CAFE_NAME }}>
      <Instanced items={boxes} geometry={g.box} material={m.plain} pick={picks.boxes} />
      <Instanced items={rounds} geometry={g.ball} material={m.plain} shadow={false} />
      <Instanced items={parts.canopies} geometry={g.cone} material={m.plain} shadow={false} />
      {night && <Instanced items={parts.lamps} geometry={g.bead} material={m.lamp} shadow={false} />}
      {!inside && <Instanced items={parts.hip} geometry={g.hip} material={m.roof} pick={picks.hip} />}
      {!inside && night && <Instanced items={parts.glow} geometry={g.box} material={m.lamp} shadow={false} />}
      <mesh geometry={kit.glassGeo} material={kit.glass} renderOrder={2} raycast={() => null} />
      {!inside && <mesh geometry={kit.sign} material={kit.signFace} raycast={() => null} />}
    </group>
  );
}
