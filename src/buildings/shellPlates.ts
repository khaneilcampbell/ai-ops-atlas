/**
 * The clear floor plate of each custom headquarters, storey by storey: the largest level rectangle
 * that stays inside the building's own shell over the lower half of that storey, so an office drawn
 * there sits inside the glass instead of hanging out of it. In fractions of the tower's footprint
 * (`size`) around its centre: [centre x, centre z, half width, half depth]. `front` is how far the
 * lobby's front face stands from the centre, toward the street (+z), in the same units.
 *
 * Measured from the shells the map actually draws (rays from outside toward the centre at each
 * storey), on 2026-11-18, by visual/building-shells.visual.ts, which measures them again and fails when
 * a plate below no longer fits its building. Storeys are the tower's own count (`Tower.floors`) spread
 * evenly from the floor base to its roof.
 */
export type Plate = readonly [cx: number, cz: number, hw: number, hd: number];
export interface ShellMeasure {
  front: number;
  /** Storeys 0 (lobby) to 8; higher storeys hold no desks. */
  plates: readonly Plate[];
}

export const SHELL: Readonly<Record<string, ShellMeasure>> = {
  "ai-ops-atlas": {
    front: 0.418,
    plates: [
      [0, -0.025, 0.405, 0.289],
      [0, -0.025, 0.405, 0.289],
      [-0.15, 0, 0.261, 0.261],
      [-0.175, 0, 0.301, 0.215],
      [-0.175, -0.025, 0.304, 0.217],
      [-0.175, 0, 0.264, 0.264],
      [-0.125, 0, 0.328, 0.234],
      [-0.1, 0, 0.324, 0.231],
      [-0.15, -0.025, 0.324, 0.231],
    ],
  },
  "benjaire-site": {
    front: 0.582,
    plates: [
      [-0.025, 0.025, 0.385, 0.385],
      [-0.075, 0.075, 0.324, 0.324],
      [0, 0, 0.178, 0.178],
      [0, 0, 0.169, 0.169],
      [0, 0, 0.169, 0.169],
      [0, 0, 0.172, 0.172],
      [-0.025, 0.025, 0.172, 0.172],
      [0, 0, 0.181, 0.181],
      [0, 0, 0.207, 0.207],
    ],
  },
  "commerce-pipeline": {
    front: 0.545,
    plates: [
      [-0.175, 0.125, 0.235, 0.235],
      [-0.175, 0.125, 0.235, 0.235],
      [-0.175, 0.125, 0.235, 0.235],
      [-0.05, 0.025, 0.12, 0.12],
      [-0.05, 0.025, 0.121, 0.121],
      [-0.05, 0.025, 0.117, 0.117],
      [-0.05, 0, 0.116, 0.116],
      [-0.05, 0, 0.119, 0.119],
      [-0.025, -0.025, 0.116, 0.116],
    ],
  },
  "intelligence-hub": {
    front: 0.43,
    plates: [
      [-0.05, -0.05, 0.365, 0.365],
      [-0.075, 0, 0.387, 0.387],
      [-0.075, 0, 0.388, 0.388],
      [0, -0.025, 0.406, 0.406],
      [-0.075, 0, 0.387, 0.387],
      [-0.05, 0, 0.4, 0.4],
      [-0.075, 0, 0.387, 0.387],
      [0, -0.05, 0.467, 0.333],
      [-0.025, 0, 0.411, 0.411],
    ],
  },
  "soc-lab": {
    front: 0.46,
    plates: [
      [0.025, 0.05, 0.355, 0.355],
      [-0.05, -0.05, 0.35, 0.35],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
      [0, 0, 0.38, 0.38],
    ],
  },
  "portfolio-site": {
    front: 0.314,
    plates: [
      [-0.05, -0.1, 0.39, 0.279],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
      [-0.025, -0.075, 0.359, 0.359],
    ],
  },
  "github-profile": {
    front: 0.578,
    plates: [
      [0, -0.025, 0.464, 0.331],
      [0, -0.175, 0.162, 0.325],
      [-0.05, -0.15, 0.175, 0.35],
      [0, -0.2, 0.148, 0.297],
      [0, -0.175, 0.16, 0.32],
      [0, -0.15, 0.227, 0.318],
      [0, -0.2, 0.148, 0.297],
      [0, -0.175, 0.158, 0.316],
      [-0.15, 0.125, 0.237, 0.332],
    ],
  },
};
