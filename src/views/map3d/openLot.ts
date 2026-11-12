/**
 * The open lot: the "room for the next project" corner of the map. It held the Skyline residences,
 * shops and observation wheel until Khaneil removed them to make space (2026-11-08); the land stays as
 * level lawn, and the Marketplace, the airport road and the railway still take their places from it.
 */
export const OPEN_LOT_LABEL = "Open lot";
/** Lawn left where a removed project tower stood (2026-11-09). */
export const VACANT_LOT_LABEL = "Vacant lot";

export function openLot<T extends { label: string }>(parks: readonly T[]): T | undefined {
  return parks.find((p) => p.label === OPEN_LOT_LABEL);
}
