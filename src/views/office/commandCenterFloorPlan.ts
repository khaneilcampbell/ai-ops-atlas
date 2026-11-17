/**
 * Atlas Command Center, Floor 4: the agent office floor built in Blender (Khaneil, 2026-11-17).
 * Plain numbers, no three.js. The model and its source live in assets/command-center-office;
 * CommandCenterFloor.tsx draws it.
 *
 * The model holds the room only (service core, glass meeting room, lounge, storage, planting,
 * carpet) and one workstation kit (desk, chair, monitor housing). Atlas still plans every desk
 * (planOffice) and draws everything live at it: the agent, the screen, the nameplate, the status
 * lamp and the selection ring. A furnished desk says nothing about whether its agent is running.
 */
export const FLOOR4_MODEL = "models/office/command-center-floor4.glb";

/** The one furnished floor so far: Floor 4, where the Command Center's agents sit by default. */
export const FURNISHED_LEVEL = 4;

export const isFurnishedFloor = (projectId: string, level: number) => projectId === "ai-ops-atlas" && level === FURNISHED_LEVEL;

/**
 * Where a desk's live parts go, in the desk's own frame (centre on the floor, facing -z, chair
 * toward +z). The model carries the same anchors (anchor_* under its kit); the tests check they
 * agree, so the monitor housing frames the screen Atlas draws.
 */
export const KIT_ANCHORS = {
  anchor_screen: [0, 1.18, -0.198],
  anchor_label: [0, 1.6, -0.22],
  anchor_lamp: [0.6, 0.79, -0.24],
  anchor_seat: [0, 0.46, 0.66],
  anchor_select: [0, 0.02, 0.3],
} as const satisfies Record<string, readonly [number, number, number]>;

export interface Box2 { x0: number; x1: number; z0: number; z1: number }

/** A planned desk's footprint with its chair and the agent in it (desk faces -z, chair at +z). */
export function deskFootprint(x: number, z: number): Box2 {
  return { x0: x - 0.78, x1: x + 0.78, z0: z - 0.42, z1: z + 1.0 };
}

export const overlaps = (a: Box2, b: Box2) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
export const inside = (a: Box2, b: Box2) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;
