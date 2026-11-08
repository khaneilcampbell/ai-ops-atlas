/** Shared front-left plaza; leaves Skyline's central entrance and front promenade open. */
export const SKYLINE_WHEEL = { dx: -2.8, dz: 3, width: 4.1, depth: 1.5 } as const;
export function skylineWheelPosition(park: { x: number; z: number; w: number; d: number }) {
  return { x: park.x + park.w / 2 + SKYLINE_WHEEL.dx, z: park.z + park.d / 2 + SKYLINE_WHEEL.dz };
}
