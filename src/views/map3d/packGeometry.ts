import * as THREE from "three";

/**
 * Stores a geometry's normals as 16-bit fixed point instead of 32-bit floats: half the GPU memory
 * for normals, and 1/32767 of precision, far finer than lighting on a screen pixel can show. The
 * shader reads them back as the same -1..1 floats, so the map looks the same.
 *
 * Accepts a geometry, or an object or array of them (the shape tower builders return), and packs
 * every geometry it finds. Call it where a geometry is built, before it is first drawn: swapping an
 * attribute after the GPU has a copy would leave the old buffer behind until the geometry is
 * disposed.
 */
export function packNormals<T>(value: T): T {
  if (value instanceof THREE.BufferGeometry) packOne(value);
  else if (Array.isArray(value)) value.forEach(packNormals);
  else if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) Object.values(value).forEach(packNormals);
  return value;
}

function packOne(g: THREE.BufferGeometry) {
  const n = g.getAttribute("normal");
  if (!n || !(n instanceof THREE.BufferAttribute) || !(n.array instanceof Float32Array) || n.itemSize !== 3) return;
  const src = n.array;
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, src[i])) * 32767);
  g.setAttribute("normal", new THREE.BufferAttribute(out, 3, true));
}
