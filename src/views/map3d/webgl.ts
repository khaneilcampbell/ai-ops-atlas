let supported: boolean | undefined;

/** The 3D map needs WebGL 2; without it the app keeps the flat map. Checked once, since every probe holds a GPU context. */
export function webglAvailable() {
  if (supported === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      supported = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      supported = false;
    }
  }
  return supported;
}
