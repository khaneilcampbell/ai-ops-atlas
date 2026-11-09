/**
 * Where the distance haze starts and where it is solid, in world units from the camera.
 *
 * The haze follows the camera so the map edge fades into the sky at any zoom. Close up, a pure
 * multiple of the camera distance pulls it in so tight that the street under a tall tower counts
 * as "far" and turns sky colour, which at night reads as the whole view going dark. So the haze
 * never comes closer than a share of the map's own size: zoomed out nothing changes, zoomed in
 * the neighbourhood around you stays clear.
 *
 * `dist` is the camera's distance to what it looks at; `ext` is half the map's width.
 */
export function fogRange(dist: number, ext: number): { near: number; far: number } {
  return { near: Math.max(dist * 1.25, ext * FOG_NEAR_EXT), far: Math.max(dist * 3.2, ext * FOG_FAR_EXT) };
}

export const FOG_NEAR_EXT = 0.6;
export const FOG_FAR_EXT = 1.8;
