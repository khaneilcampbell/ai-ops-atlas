import * as THREE from "three";
import type { CityFigure, HairStyle } from "../../registry/cityFigures";

/**
 * The named agents' city characters (NamedAgents.tsx): one shared rig of six bones (body, head, two
 * legs, two arms) and, per agent, a list of simple parts (boxes and balls) hung on those bones and
 * coloured from its CityFigure. Every agent's parts go into two instanced meshes (all boxes, all
 * balls), so the whole named team costs two draw calls however many parts each figure has.
 *
 * Sizes are in figure units, feet at 0, about 0.25 tall before FIGURE_SCALE; the crowd's figures
 * (walkerFigure.ts) are the same shape at about 0.23, so the named team stands a little taller.
 */
export const BONES = { body: 0, head: 1, legL: 2, legR: 3, armL: 4, armR: 5 } as const;
export type Bone = (typeof BONES)[keyof typeof BONES];

export interface FigurePart {
  bone: Bone;
  shape: "box" | "ball";
  /** Centre in the bone's frame. */
  p: [number, number, number];
  /** Box size, or ball radii. */
  s: [number, number, number];
  c: string;
}

/** How much larger than figure units the named team is drawn on the map. */
export const FIGURE_SCALE = 1.35;
export const RIG = {
  leg: { h: 0.085, w: 0.028, d: 0.032, x: 0.018 },
  torso: { y0: 0.085, h: 0.1, w: 0.074, d: 0.05 },
  arm: { h: 0.085, w: 0.022, d: 0.026, x: 0.047, y: 0.178 },
  head: { y: 0.222, r: [0.031, 0.035, 0.032] as [number, number, number] },
  /** Top of the head in figure units, for the badge and the activity ring. */
  top: 0.26,
  legSwing: 0.5,
  armSwing: 0.42,
} as const;

const mix = (a: string, b: string, t: number) => "#" + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

function hairParts(style: HairStyle, c: string, streak: string | undefined): FigurePart[] {
  const H = BONES.head;
  const ball = (p: FigurePart["p"], s: FigurePart["s"], color = c): FigurePart => ({ bone: H, shape: "ball", p, s, c: color });
  const box = (p: FigurePart["p"], s: FigurePart["s"], color = c): FigurePart => ({ bone: H, shape: "box", p, s, c: color });
  // A cap over the crown and back of the head that leaves the face and eyes clear.
  const cap = (s: FigurePart["s"] = [0.034, 0.031, 0.034], y = 0.012) => ball([0, y, -0.006], s);
  const out: FigurePart[] = [];
  switch (style) {
    case "bald":
      break;
    case "short":
      out.push(cap());
      break;
    case "fade":
      out.push(cap([0.033, 0.028, 0.033], 0.015));
      break;
    case "undercut":
      out.push(cap([0.033, 0.027, 0.033], 0.014), box([0, 0.034, 0.002], [0.04, 0.014, 0.05]));
      break;
    case "pixie":
      out.push(cap([0.035, 0.032, 0.035]), ball([0.008, 0.025, 0.016], [0.022, 0.01, 0.016]));
      break;
    case "curly":
      out.push(cap([0.035, 0.032, 0.035]));
      for (const [x, y, z] of [[-0.018, 0.031, 0.01], [0.016, 0.033, 0.012], [0, 0.038, 0.002], [-0.02, 0.026, -0.018], [0.02, 0.027, -0.018], [0, 0.03, -0.026]] as const) out.push(ball([x, y, z], [0.012, 0.011, 0.012]));
      break;
    case "messy":
      out.push(cap([0.034, 0.03, 0.034]));
      for (const [x, z] of [[-0.012, 0.016], [0.012, 0.014], [0, 0]] as const) out.push(ball([x, 0.034, z], [0.014, 0.011, 0.013]));
      break;
    case "locs":
      out.push(cap([0.033, 0.029, 0.033], 0.012));
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        out.push(box([Math.sin(a) * 0.022, 0.036 - (Math.cos(a) < 0 ? 0.006 : 0), Math.cos(a) * 0.02 - 0.004], [0.009, 0.02, 0.009]));
      }
      break;
    case "bob":
      out.push(cap([0.035, 0.032, 0.035]), box([0, -0.008, -0.006], [0.074, 0.046, 0.058]), ball([0.008, 0.024, 0.019], [0.024, 0.01, 0.014]));
      break;
    case "long":
    case "bangs":
      out.push(cap([0.035, 0.032, 0.035]), box([0, -0.026, -0.012], [0.072, 0.084, 0.05]));
      if (style === "bangs") out.push(box([0, 0.021, 0.026], [0.05, 0.016, 0.012]));
      break;
    case "wavy":
      out.push(cap([0.036, 0.033, 0.036]), box([0, -0.03, -0.012], [0.08, 0.09, 0.054]));
      for (const x of [-0.038, 0.038]) out.push(ball([x, -0.044, -0.004], [0.016, 0.022, 0.016]), ball([x * 0.9, -0.012, 0], [0.012, 0.018, 0.014]));
      break;
    case "shoulder":
      out.push(cap([0.036, 0.033, 0.036]), box([0, -0.016, -0.01], [0.078, 0.062, 0.052]));
      for (const x of [-0.036, 0.036]) out.push(ball([x, -0.03, 0], [0.014, 0.018, 0.014]));
      break;
    case "ponytail":
      out.push(cap(), ball([0, -0.006, -0.04], [0.012, 0.012, 0.012]), box([0, -0.04, -0.044], [0.014, 0.05, 0.012]));
      break;
    case "updo":
      out.push(cap(), ball([0, 0.012, -0.04], [0.018, 0.017, 0.017]), ball([0.03, -0.012, 0.006], [0.006, 0.016, 0.008]));
      break;
  }
  if (streak) {
    // Grey temples (short hair) or a long grey streak at the front (long hair).
    if (style === "short" || style === "fade") for (const x of [-0.031, 0.031]) out.push(ball([x, 0.004, -0.002], [0.006, 0.01, 0.012], streak));
    else out.push(ball([-0.028, -0.004, 0.008], [0.008, 0.032, 0.014], streak));
  }
  return out;
}

/** Every part of one agent's figure, from its appearance. Deterministic: the same figure gives the same parts. */
export function figureParts(f: CityFigure): FigurePart[] {
  const { leg, torso, arm, head } = RIG;
  const B = BONES.body, H = BONES.head;
  const w = torso.w * f.build.shoulders, cy = torso.y0 + torso.h / 2, front = torso.d / 2;
  const parts: FigurePart[] = [];
  const body = (shape: FigurePart["shape"], p: FigurePart["p"], s: FigurePart["s"], c: string) => parts.push({ bone: B, shape, p, s, c });
  const onHead = (shape: FigurePart["shape"], p: FigurePart["p"], s: FigurePart["s"], c: string) => parts.push({ bone: H, shape, p, s, c });

  // Torso: the jacket when there is one, with the top showing down the open front.
  body("box", [0, cy, 0], [w, torso.h, torso.d], f.jacket ?? f.top);
  if (f.jacket) body("box", [0, cy + 0.004, front + 0.0015], [0.024, torso.h - 0.012, 0.004], f.top);
  if (f.stripes && !f.jacket) for (const dy of [-0.03, -0.012, 0.006, 0.024]) body("box", [0, cy + dy, 0], [w + 0.003, 0.007, torso.d + 0.003], f.stripes);
  // Neck, and the neckline: a white collar, a turtleneck, a zip, or a plain tee.
  body("box", [0, torso.y0 + torso.h + 0.006, 0], [0.022, 0.014, 0.022], f.skin);
  const n = f.neck;
  if (n?.kind === "turtleneck") body("box", [0, torso.y0 + torso.h + 0.006, 0], [0.03, 0.018, 0.03], n.color);
  if (n?.kind === "collar") for (const x of [-0.011, 0.011]) body("box", [x, torso.y0 + torso.h - 0.002, front - 0.004], [0.018, 0.009, 0.014], n.color);
  if (n?.kind === "zip") {
    body("box", [0, torso.y0 + torso.h - 0.006, front + 0.001], [0.016, 0.012, 0.006], f.jacket ? f.top : n.color);
    body("box", [0, cy, front + 0.0025], [0.004, torso.h - 0.02, 0.002], n.color === f.top ? "#c9c6bf" : n.color);
  }
  if (f.necklace) body("ball", [0, torso.y0 + torso.h - 0.012, front + 0.002], [0.004, 0.004, 0.003], f.necklace);

  // Arms in the jacket (or top) sleeves, hands; legs in trousers, shoes.
  for (const bone of [BONES.armL, BONES.armR] as const) {
    parts.push({ bone, shape: "box", p: [0, -arm.h / 2, 0], s: [arm.w, arm.h, arm.d], c: f.jacket ?? f.top });
    parts.push({ bone, shape: "ball", p: [0, -arm.h - 0.004, 0], s: [0.011, 0.012, 0.011], c: f.skin });
  }
  for (const bone of [BONES.legL, BONES.legR] as const) {
    parts.push({ bone, shape: "box", p: [0, -leg.h / 2, 0], s: [leg.w, leg.h, leg.d], c: f.trousers });
    parts.push({ bone, shape: "box", p: [0, -leg.h + 0.006, 0.006], s: [leg.w + 0.002, 0.012, leg.d + 0.012], c: f.shoes });
  }

  // Head: face, eyes, then glasses, facial hair, earrings and hair.
  onHead("ball", [0, 0, 0], head.r, f.skin);
  for (const x of [-0.011, 0.011]) onHead("ball", [x, 0.004, 0.0295], [0.0045, 0.0045, 0.003], "#1d1a18");
  if (f.glasses) {
    for (const x of [-0.012, 0.012]) for (const y of [0.0105, -0.0025]) onHead("box", [x, y, 0.031], [0.019, 0.0028, 0.003], f.glasses);
    for (const x of [-0.0215, -0.0025, 0.0025, 0.0215]) onHead("box", [x, 0.004, 0.031], [0.0028, 0.013, 0.003], f.glasses);
  }
  const fh = f.facialHair;
  if (fh) {
    const beard = fh.style === "stubble" ? mix(f.skin, fh.color, 0.55) : fh.color;
    if (fh.style === "goatee") onHead("ball", [0, -0.026, 0.021], [0.012, 0.012, 0.012], fh.color);
    else {
      // Along the jaw and chin, under the eyes and inside the face's outline.
      const [rx, ry, y] = fh.style === "full" ? [0.029, 0.019, -0.019] : fh.style === "short" ? [0.027, 0.016, -0.019] : [0.026, 0.015, -0.018];
      onHead("ball", [0, y, 0.013], [rx, ry, 0.021], beard);
    }
    if (fh.style !== "stubble") onHead("box", [0, -0.011, 0.0305], [0.02, 0.005, 0.004], fh.moustache ?? fh.color);
  }
  if (f.earrings) for (const x of [-0.031, 0.031]) onHead("ball", [x, -0.011, 0.002], [0.0045, 0.0045, 0.0045], f.earrings);
  parts.push(...hairParts(f.hair.style, f.hair.color, f.hair.streak));
  return parts;
}

/** One frame's pose: where the figure stands, which way it faces, and how its limbs and head move. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Stride swing, -1 to 1 (walkerFigure.stepGait), 0 standing. */
  swing: number;
  /** Idle: a slow look around (radians) and arms hanging a touch forward or back. */
  look: number;
  sway: number;
  /** Overall size: FIGURE_SCALE times the figure's height. */
  scale: number;
}

const tmp = { root: new THREE.Matrix4(), bone: new THREE.Matrix4(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, "YXZ"), v: new THREE.Vector3(), s: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) };

/** The six bone matrices (world) of a figure in a pose. `out` is reused across frames. */
export function poseBones(pose: Pose, shoulders: number, out: THREE.Matrix4[]): THREE.Matrix4[] {
  const { leg, arm, head } = RIG;
  tmp.e.set(0, pose.yaw, 0);
  tmp.root.compose(tmp.v.set(pose.x, pose.y, pose.z), tmp.q.setFromEuler(tmp.e), tmp.s.setScalar(pose.scale));
  const at = (i: number, x: number, y: number, rx: number, ry = 0) => {
    tmp.e.set(rx, ry, 0);
    tmp.bone.compose(tmp.v.set(x, y, 0), tmp.q.setFromEuler(tmp.e), tmp.one);
    (out[i] ??= new THREE.Matrix4()).multiplyMatrices(tmp.root, tmp.bone);
  };
  at(BONES.body, 0, 0, 0);
  at(BONES.head, 0, head.y, 0, pose.look);
  at(BONES.legL, -leg.x, leg.h, -pose.swing * RIG.legSwing);
  at(BONES.legR, leg.x, leg.h, pose.swing * RIG.legSwing);
  at(BONES.armL, -arm.x * shoulders, arm.y, pose.swing * RIG.armSwing + pose.sway);
  at(BONES.armR, arm.x * shoulders, arm.y, -pose.swing * RIG.armSwing - pose.sway);
  return out;
}

/** A part's world matrix: its bone's, then the part's own centre and size. */
export function partMatrix(bones: THREE.Matrix4[], part: FigurePart, out: THREE.Matrix4) {
  tmp.m.compose(tmp.v.set(part.p[0], part.p[1], part.p[2]), tmp.q.identity(), tmp.s.set(part.s[0], part.s[1], part.s[2]));
  return out.multiplyMatrices(bones[part.bone], tmp.m);
}
