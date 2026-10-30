/**
 * Keeps the 3D map steady close up. Two things lose precision as the camera comes in:
 *
 * - The sun's shadow map is one square texture stretched over the whole island, so zoomed in
 *   each shadow texel covers a visible patch and shadow edges turn into stair steps and stripes.
 *   `shadowBox` shrinks the shadow box to what the camera can see, in a few fixed sizes, and snaps
 *   it to whole texels so shadows hold still while the camera pans.
 * - Depth precision depends on the near plane. `depthRange` moves it out with the camera distance,
 *   so thin layers (planks on a deck, markings on a road) stay apart when zoomed out too.
 *
 * Both are cheap: a few multiplies per frame, and the shadow map only redraws when the box changes.
 */

/** Smallest shadow box half-size, in world units: about one city block either side. */
export const MIN_SHADOW_HALF = 6;
/** Shadow box sizes step by this factor, so zooming changes texel size in a few even jumps. */
const STEP = Math.SQRT2;

export interface ShadowBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** World size of one shadow texel. */
  texel: number;
}

/**
 * The shadow camera bounds, in the sun's view space, that cover what the camera can see.
 * `full` is the half-size that covers the whole island (used as is when zoomed out, so the
 * overview looks exactly as before). `focus` is the point on the ground to cover, already moved
 * into the sun's view space: x and y across the sun's view.
 */
export function shadowBox(dist: number, focus: { x: number; y: number }, full: number, mapSize: number): ShadowBox {
  // The view reaches about two camera distances past the target before the fog covers it.
  const want = Math.max(MIN_SHADOW_HALF, dist * 1.9);
  if (want >= full) return { left: -full, right: full, top: full, bottom: -full, texel: (2 * full) / mapSize };
  // The largest step down from the full size that still covers the view.
  const half = full / Math.pow(STEP, Math.floor(Math.log(full / want) / Math.log(STEP)));
  const texel = (2 * half) / mapSize;
  // Move the box in quarter steps, which are whole texels: shadow edges stay on the same texels
  // instead of crawling while the camera pans, and the box (and the shadow map) only moves now
  // and then. The size step above leaves room for the eighth of a box this can lag behind.
  const grid = half / 4;
  const x = Math.round(focus.x / grid) * grid;
  const y = Math.round(focus.y / grid) * grid;
  return { left: x - half, right: x + half, top: y + half, bottom: y - half, texel };
}

/** Near and far planes for a camera this far from its target. */
export function depthRange(dist: number): { near: number; far: number } {
  // Nothing sits closer to the camera than a small share of its distance: the camera stays at
  // least 12° off the ground and well above the roofs. The fog hides everything past 3.2×.
  return { near: Math.max(0.5, dist * 0.04), far: Math.max(60, dist * 4 + 20) };
}
