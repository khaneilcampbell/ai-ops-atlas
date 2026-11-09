import * as THREE from "three";

/**
 * Far detail for small round shapes (tree canopies, bushes, globes). Seen from the map overview a
 * canopy is a few pixels across, and its 180-triangle sphere draws the same outline as an
 * 80-triangle one. Instanced swaps to the lighter shape only while the largest instance, at the
 * nearest point of the whole set to the camera, would be under FAR_PX pixels in radius, so up
 * close every shape is drawn exactly as before.
 */
const FAR = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/** Below this on-screen radius (device pixels) the far shape's outline is within half a pixel of the full one. */
export const FAR_PX = 6;
/** Back to full detail only above FAR_PX by this factor, so a camera resting at the edge doesn't flicker. */
const HYSTERESIS = 1.25;

export function setFarDetail(full: THREE.BufferGeometry, far: THREE.BufferGeometry) {
  FAR.set(full, far);
}
export const farDetailOf = (g: THREE.BufferGeometry) => FAR.get(g);

/** On-screen radius in pixels of a sphere of radius r at distance d, for a perspective camera. */
export function screenRadius(r: number, d: number, fovDeg: number, heightPx: number) {
  if (d <= 0) return Infinity;
  return (r * heightPx) / (2 * Math.tan((fovDeg * Math.PI) / 360) * d);
}

/** Whether to draw the far shape, given the current choice and the on-screen radius. */
export function chooseFar(wasFar: boolean, px: number) {
  return wasFar ? px < FAR_PX * HYSTERESIS : px < FAR_PX;
}

const box = new THREE.Box3();
const scale = new THREE.Vector3();
const pos = new THREE.Vector3();
const rot = new THREE.Quaternion();
const size = new THREE.Vector2();

/**
 * Picks the geometry an instanced mesh should draw this frame. `radius` is the largest instance's
 * radius in the mesh's own units. Returns the full geometry for anything but a perspective camera.
 */
export function pickDetail(mesh: THREE.InstancedMesh, full: THREE.BufferGeometry, far: THREE.BufferGeometry, radius: number, camera: THREE.Camera, gl: THREE.WebGLRenderer) {
  if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera || !mesh.boundingBox) return full;
  box.copy(mesh.boundingBox).applyMatrix4(mesh.matrixWorld);
  mesh.matrixWorld.decompose(pos, rot, scale);
  const r = radius * Math.max(scale.x, scale.y, scale.z);
  const px = screenRadius(r, box.distanceToPoint(camera.position), (camera as THREE.PerspectiveCamera).fov, gl.getDrawingBufferSize(size).y);
  return chooseFar(mesh.geometry === far, px) ? far : full;
}
