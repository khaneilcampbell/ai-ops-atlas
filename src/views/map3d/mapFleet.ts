// Counts for the map's moving things that a component draws by hand rather than from a plan, so the
// Atlas data inventory (src/inventory/mapInventory.ts) counts exactly what the map draws.
export const MAP_FLEET = {
  /** Boats circling the bay: living.tsx draws this many. */
  boats: 8,
  /** The one executive jet on the airport loop (LogisticsAirport.tsx ExecutiveJet draws a single jet). */
  executiveJets: 1,
  /** The gold private jet: it takes one of the loop's airliner slots (goldJetPlan GOLD_JET_SLOT). */
  goldJets: 1,
  /** The one Atlas airship (SkyBalloons.tsx draws a single airship). */
  airships: 1,
} as const;
