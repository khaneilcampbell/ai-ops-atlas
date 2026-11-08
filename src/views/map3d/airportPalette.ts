/** Atlas HQ's colours, used by the airport so the two landmarks read as one family (KC, 2026-10-31).
 * Values match the HQ tower: blue glass, a gold wing, cool white metal and grey roofs. */
export const ATLAS_HQ_COLORS = {
  /** Blue glass, from light to deep. */
  glassLight: "#c6deee",
  glass: "#5f93bd",
  glassDeep: "#40627f",
  /** Podium rib glass. */
  rib: "#86a9c2",
  /** Gold wing and trim. */
  gold: "#dcb978",
  goldDeep: "#c29c62",
  /** Cool white metal for shells, canopies and fins. */
  white: "#eef1f2",
  whiteBright: "#f4f6f6",
  fin: "#e9eef0",
  /** Plinths and paving slabs. */
  slab: "#d7dde0",
  roof: "#9aa3a6",
} as const;
