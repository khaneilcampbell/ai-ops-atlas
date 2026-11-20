import { load, remove, save } from "../../lib/storage";
import { CIRCA_TOWERS, circaUnits } from "./circaFloors";
import type { CircaHome } from "./circaHomes";

/**
 * "Visit apartment" in Team Residence Towers: pick a resident's apartment, the camera frames it, a small workspace
 * offers that agent's existing Atlas pages, and "Back to building" returns to the floor. The visit is a way to look,
 * not a status: it never says whether the agent is running.
 *
 * The open suite and whether the workspace is folded are kept between launches under `atlas:residenceVisit`, the
 * same local, non-secret storage as other view preferences (lib/storage.ts). Anything saved that no longer matches a
 * resident's apartment is dropped, and the building opens on its usual overview.
 */
export const VISIT_KEY = "residenceVisit";

export interface VisitPrefs {
  /** The suite being visited ("304"), or null for the building overview. */
  suite: string | null;
  /** The workspace is folded to its title bar (handy on a phone). */
  folded: boolean;
}

const EMPTY: VisitPrefs = { suite: null, folded: false };

/** Reads a saved value of any shape into prefs; unknown fields, wrong types and stray suites fall back. */
export function parseVisit(raw: unknown, suites: ReadonlySet<string>): VisitPrefs {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  const suite = typeof r.suite === "string" && suites.has(r.suite) ? r.suite : null;
  return { suite, folded: r.folded === true };
}

export const loadVisit = (suites: ReadonlySet<string>): VisitPrefs => parseVisit(load<unknown>(VISIT_KEY, null), suites);

export function saveVisit(prefs: VisitPrefs) {
  if (!prefs.suite && !prefs.folded) remove(VISIT_KEY);
  else save(VISIT_KEY, prefs);
}

export type Vec3 = [number, number, number];

/**
 * Where the camera stands to frame one apartment on its single-floor view (the floor drawn at y = 0): above and in
 * front of the apartment's centre, near enough that its rooms fill the view, far enough that the whole suite fits.
 */
export function apartmentFocus(home: CircaHome, phone = false): { position: Vec3; target: Vec3 } {
  const unit = circaUnits(home.level, home.tower).find((u) => u.id === home.unit);
  const tower = CIRCA_TOWERS.find((t) => t.id === home.tower)!;
  const ux = unit ? (unit.x0 + unit.x1) / 2 : 0, uz = unit ? (unit.z0 + unit.z1) / 2 : 0;
  // The east tower is drawn as the west one mirrored about its own centre (CircaBuilding.tsx Tower).
  const x = tower.x + (tower.mirror ? -ux : ux);
  // On a phone the workspace covers the lower part of the screen, so the view aims a little nearer the viewer and the
  // apartment sits in the upper half.
  const z = uz + (phone ? 4 : 0);
  return { target: [x, 0.8, z], position: [x + 4, phone ? 16 : 13, z + (phone ? 16 : 14)] };
}

/** Linear blend of two camera poses, with an ease-out: t = 0 is `a`, 1 is `b`. */
export function blendPose(a: { position: Vec3; target: Vec3 }, b: { position: Vec3; target: Vec3 }, t: number) {
  const k = 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
  const mix = (p: Vec3, q: Vec3) => p.map((v, i) => v + (q[i] - v) * k) as Vec3;
  return { position: mix(a.position, b.position), target: mix(a.target, b.target) };
}
