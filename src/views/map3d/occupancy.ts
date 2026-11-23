import { activityText, segmentAt, type Routine, type Segment } from "../../routine/routine";
import { PLAQUE } from "./plaques";

/**
 * "Agents inside": which buildings have named agents inside them right now, for the small marker
 * that floats above each occupied roof on the exterior map (OccupancyMarker.tsx).
 *
 * Source of truth: each agent's city routine (routine/routine.ts), the same one that draws the
 * characters (NamedAgents.tsx) and fills the City agents panel. An agent counts as inside only while
 * its routine is in an `inside` segment: from stepping through the door of its own workplace,
 * through its desk time, to walking back out. Those segments are planned from real run events
 * (n8n executions, GitHub runs, Task Center tasks) and the wall clock, never from where an agent is
 * assigned: an agent whose building is Atlas HQ but who is in the park, on a ride or at home is not
 * counted. With no run data the routines are empty and no building shows a marker.
 *
 * Not counted: home (agents at home are hidden on purpose), and the arena or airport terminal on an
 * outing (they are landmarks, not workplaces, and keep their own badge by the door).
 */
export interface InsideAgent {
  personaId: string;
  /** What it is doing inside, in the routine's own words ("Working", "At desk", "Entering building"). */
  status: string;
}

/** True while the routine has the agent inside its workplace. */
export function isInside(seg: Segment | null | undefined): seg is Extract<Segment, { kind: "inside" }> {
  return seg?.kind === "inside";
}

/**
 * Buildings with agents inside at `now`, by building key, each with its agents in team order.
 * `officeOf` names the building an agent's workplace is (null: not a building on this map).
 * `override` is the review shots' stand-in routines (useRoutineOps routineOverride), as NamedAgents uses.
 */
export function insideNow(
  routines: ReadonlyMap<string, Routine>,
  now: number,
  officeOf: (personaId: string) => string | null,
  order: readonly string[] = [...routines.keys()],
  override?: ReadonlyMap<string, Routine>,
): Map<string, InsideAgent[]> {
  const out = new Map<string, InsideAgent[]>();
  const ids = [...order, ...[...routines.keys(), ...(override?.keys() ?? [])].filter((id) => !order.includes(id))];
  for (const id of new Set(ids)) {
    const r = override?.get(id) ?? routines.get(id);
    if (!r) continue;
    const seg = segmentAt(r, now);
    // segmentAt falls back to the last segment before now; only one that covers now counts.
    if (!isInside(seg) || now < seg.t0 || now >= seg.t1) continue;
    const key = officeOf(id);
    if (!key) continue;
    out.set(key, [...(out.get(key) ?? []), { personaId: id, status: activityText(seg) }]);
  }
  return out;
}

/** A stable text for a set of occupied buildings, so the labels rebuild only when it changes. */
export function occupancySignature(o: ReadonlyMap<string, InsideAgent[]>): string {
  return [...o.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v.map((a) => `${a.personaId}:${a.status}`).join(",")}`)
    .join("|");
}

/** At most this many portraits in the stack; the rest is a "+N". */
export const STACK_MAX = 3;
/** Marker sizes in CSS pixels (match .m3-occupancy in app.css). */
export const MARKER = { avatar: 20, overlap: 7, height: 28, pad: 16, gap: 6, more: 22, font: 11.5 } as const;
/** Gap in CSS pixels between the marker and the top of the building's nameplate below it. */
export const MARKER_GAP = 6;

/** The portraits shown and how many are left over for the "+N" chip. */
export function stackOf<T>(agents: readonly T[]): { shown: T[]; more: number } {
  const shown = agents.slice(0, agents.length > STACK_MAX ? STACK_MAX - 1 : STACK_MAX);
  return { shown, more: agents.length - shown.length };
}

/** "1 inside", "4 inside". */
export const countText = (n: number) => `${n} inside`;

/** The marker's width in CSS pixels for this many agents, given the count text's measured width. */
export function markerWidth(n: number, textW: number): number {
  const { shown, more } = stackOf(Array.from({ length: n }));
  const faces = shown.length + (more ? 1 : 0);
  const stack = faces ? MARKER.avatar + (faces - 1) * (MARKER.avatar - MARKER.overlap) : 0;
  return Math.ceil(stack + MARKER.gap + textW + MARKER.pad);
}

/**
 * Where the marker sits: on the same roof point as the building's nameplate (the middle of the
 * roof, at its highest point, PLAQUE.roofGap above it), lifted on screen by the nameplate's height
 * plus a small gap, so it floats just above the nameplate and never covers it. Anchored in world
 * space, so it stays on its building while the camera pans, turns or zooms.
 */
export function markerAnchor(b: { x: number; roof: number; z: number }, plaqueH: number = PLAQUE.height): { pos: [number, number, number]; lift: number } {
  return { pos: [b.x, b.roof + PLAQUE.roofGap, b.z], lift: plaqueH + MARKER_GAP };
}

/** The accessible name and tooltip lines: building, how many, and each agent's name and status. */
export function occupancyText(building: string, agents: readonly { name: string; status: string }[]): { label: string; count: string; lines: string[] } {
  const n = agents.length;
  const count = `${n} agent${n === 1 ? "" : "s"} inside`;
  const lines = agents.map((a) => `${a.name} · ${a.status}`);
  return { label: `${building}: ${count}. ${lines.join(". ")}.`, count, lines };
}

/**
 * The map building an agent's workplace is: its project's headquarters tower, or the Marketing
 * Agency for agents whose declared workplace is that building. Any other workplace (a suite in a
 * building the map doesn't draw) has no roof to mark, so it returns null.
 */
export function officeBuildingOf(
  work: { kind: "headquarters" | "workplace"; projectId: string; building: string },
  towers: readonly { key: string; projectId: string }[],
  agency: { key: string; name: string } | null,
): string | null {
  if (work.kind === "headquarters") return towers.find((t) => t.projectId === work.projectId)?.key ?? null;
  return agency && work.building === agency.name ? agency.key : null;
}

/** The floor most of these agents sit on (lowest wins a tie), to open in the Inside view; undefined with none known. */
export function busiestFloor(floors: readonly (number | null | undefined)[]): number | undefined {
  const n = new Map<number, number>();
  for (const f of floors) if (f !== null && f !== undefined) n.set(f, (n.get(f) ?? 0) + 1);
  let best: number | undefined;
  for (const [f, c] of n) if (best === undefined || c > n.get(best)! || (c === n.get(best)! && f < best)) best = f;
  return best;
}
