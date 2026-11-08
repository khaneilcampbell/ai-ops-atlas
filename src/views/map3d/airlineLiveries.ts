/** Airline paint schemes for the airport's jets. Colours only: every aircraft shares the same
 * instanced boxes and spheres, so a livery costs no extra meshes, textures, lights or draw calls. */
export interface Livery {
  id: string;
  name: string;
  /** Upper fuselage. */
  fuselage: string;
  /** Lower fuselage band. */
  belly: string;
  cockpit: string;
  engine: string;
  intake: string;
  wing: string;
  /** Vertical tail fin. */
  tail: string;
  /** Lower and upper tail bands. */
  tailLow: string;
  tailHigh: string;
  winglet: string;
  windows: string;
}

export const LIVERIES: readonly Livery[] = [
  // White crown, Delta blue belly and engines, red tail with a darker red and blue sweep.
  { id: "delta", name: "Delta Air Lines", fuselage: "#f7f8fa", belly: "#0b2a5b", cockpit: "#14213d", engine: "#0b2a5b", intake: "#14213d", wing: "#dfe4ea", tail: "#c01933", tailLow: "#0b2a5b", tailHigh: "#8c1023", winglet: "#c01933", windows: "#14213d" },
  // White with a pale grey belly and grey engines; red tail carrying green, white and black flag bands.
  { id: "emirates", name: "Emirates", fuselage: "#fbfbf9", belly: "#d9dcde", cockpit: "#1f2328", engine: "#a7adb3", intake: "#2b2f33", wing: "#e3e6e8", tail: "#d71921", tailLow: "#00843d", tailHigh: "#101010", winglet: "#d71921", windows: "#1f2328" },
  // Silver-grey fuselage, darker grey belly; tail in red, blue and slate flag stripes.
  { id: "american", name: "American Airlines", fuselage: "#c9d0d6", belly: "#8f99a3", cockpit: "#1b2a38", engine: "#8f99a3", intake: "#1b2a38", wing: "#b8c0c7", tail: "#0078d2", tailLow: "#c30019", tailHigh: "#36495a", winglet: "#0078d2", windows: "#1b2a38" },
  // Bold blue fuselage and tail with a red belly, warm yellow and red tail bands.
  { id: "southwest", name: "Southwest Airlines", fuselage: "#304cb2", belly: "#c8102e", cockpit: "#111a40", engine: "#304cb2", intake: "#111a40", wing: "#c7ccd4", tail: "#304cb2", tailLow: "#ffbf27", tailHigh: "#c8102e", winglet: "#ffbf27", windows: "#111a40" },
  // White with a light grey belly, burgundy tail and winglets.
  { id: "qatar", name: "Qatar Airways", fuselage: "#fbfbfa", belly: "#d4d6d8", cockpit: "#2a1420", engine: "#c3c6c9", intake: "#2a1420", wing: "#e2e4e6", tail: "#5c0632", tailLow: "#7d1446", tailHigh: "#3f0322", winglet: "#5c0632", windows: "#2a1420" },
];

/** Departures and parked jets cycle through the airlines, so neighbours never share a livery. */
export function liveryFor(index: number): Livery {
  const n = LIVERIES.length;
  return LIVERIES[((index % n) + n) % n];
}
