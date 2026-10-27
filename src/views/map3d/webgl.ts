/** The 3D map needs WebGL 2; without it the app keeps the flat map. */
export function webglAvailable() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}
