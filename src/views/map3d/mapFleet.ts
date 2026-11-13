// Counts for the map's moving things that a component draws by hand rather than from a plan, so the
// Atlas data inventory (src/inventory/mapInventory.ts) counts exactly what the map draws.
export const MAP_FLEET = {
  /** Boats circling the bay: living.tsx draws this many. */
  boats: 8,
  /** The one jet that flies over the city (living.tsx CityFlyover draws a single jet). */
  flyoverJets: 1,
  /** The one Atlas airship (SkyBalloons.tsx draws a single airship). */
  airships: 1,
} as const;
