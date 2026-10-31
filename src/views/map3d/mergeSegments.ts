type P = [number, number];
export type Seg = { a: P; b: P };

/**
 * Joins consecutive segments that continue in a straight line into one, so a straight stretch of
 * road marking or rail is one box instead of dozens. Segments merge only when the next one starts
 * where the last ended and keeps the same heading (within `tolerance` radians); bends and gaps
 * (openings at junctions) stay separate, so the drawn shape doesn't change.
 */
export function mergeSegments<T extends Seg>(segs: T[], tolerance = 0.01, gap = 1e-3): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && Math.hypot(s.a[0] - last.b[0], s.a[1] - last.b[1]) < gap) {
      const h1 = Math.atan2(last.b[1] - last.a[1], last.b[0] - last.a[0]);
      const h2 = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
      const d = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
      if (d < tolerance) {
        last.b = s.b;
        continue;
      }
    }
    out.push({ a: s.a, b: s.b });
  }
  return out;
}
