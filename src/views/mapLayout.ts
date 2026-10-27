import type { Agent, Catalog, Project } from "../catalog/types";

// Isometric projection: one grid unit is TW px across and TH px down per axis.
export const TW = 48;
export const TH = 24;
export const DISTRICT = 10;
const GAP = 4;

export function iso(gx: number, gy: number) {
  return { x: (gx - gy) * TW, y: (gx + gy) * TH };
}

export interface Lot {
  agent: Agent;
  gx: number;
  gy: number;
  size: number;
  height: number;
}

export interface District {
  project: Project;
  ox: number;
  oy: number;
  size: number;
  hq: { gx: number; gy: number; size: number; height: number };
  lots: Lot[];
}

export interface Park {
  ox: number;
  oy: number;
  size: number;
}

export interface Layout {
  districts: District[];
  parks: Park[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Ring of building slots around the central HQ. Slots far to the left and right on screen fill
 * first, then front before back, so a small district keeps its labels clear of the HQ label.
 */
function slots(m: number, size: number): { gx: number; gy: number }[] {
  const step = size / m;
  const ring: { gx: number; gy: number }[] = [];
  const inner = (i: number) => i > 0 && i < m - 1;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (!(inner(i) && inner(j))) ring.push({ gx: (i + 0.5) * step, gy: (j + 0.5) * step });
  const spread = (p: { gx: number; gy: number }) => Math.round(Math.abs(p.gx - p.gy) * 100);
  return ring.sort((a, b) => spread(b) - spread(a) || b.gx + b.gy - (a.gx + a.gy) || a.gx - b.gx);
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

export function layoutMap(catalog: Catalog): Layout {
  const n = Math.max(catalog.projects.length, 1);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const districts: District[] = [];
  const parks: Park[] = [];

  const ringFor = (count: number) => {
    let m = 3;
    while (4 * (m - 1) < count) m++;
    return m;
  };
  const cell = Math.max(DISTRICT, ...catalog.projects.map((p) => ringFor(catalog.agents.filter((a) => a.projectId === p.id).length) * 2.5));

  catalog.projects.forEach((project, i) => {
    const agents = catalog.agents.filter((a) => a.projectId === project.id);
    // Grow the ring until every agent has a lot: m=3 gives 8 lots, m=4 gives 12, m=5 gives 16.
    const m = ringFor(agents.length);
    const size = m * 2.5;
    // Smaller districts sit toward the front of their cell, nearest the viewer.
    const ox = (i % cols) * (cell + GAP) + (cell - size);
    const oy = Math.floor(i / cols) * (cell + GAP) + (cell - size);
    const hqSize = size * 0.26;
    const lotSize = (size / m) * 0.52;
    districts.push({
      project,
      ox,
      oy,
      size,
      hq: { gx: ox + size / 2 - hqSize / 2, gy: oy + size / 2 - hqSize / 2, size: hqSize, height: 78 },
      lots: slots(m, size)
        .slice(0, agents.length)
        .map((s, k) => ({
          agent: agents[k],
          gx: ox + s.gx - lotSize / 2,
          gy: oy + s.gy - lotSize / 2,
          size: lotSize,
          height: 26 + Math.round(hash(agents[k].id) * 22),
        })),
    });
  });

  for (let i = catalog.projects.length; i < cols * rows || i < 2; i++) {
    parks.push({ ox: (i % cols) * (cell + GAP), oy: Math.floor(i / cols) * (cell + GAP), size: cell });
  }

  const corners = [...districts, ...parks].flatMap((d) => [iso(d.ox, d.oy), iso(d.ox + d.size, d.oy), iso(d.ox, d.oy + d.size), iso(d.ox + d.size, d.oy + d.size)]);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    districts,
    parks,
    bounds: { minX: Math.min(...xs), minY: Math.min(...ys) - 120, maxX: Math.max(...xs), maxY: Math.max(...ys) + 20 },
  };
}

/** Deterministic tree spots along a district's edges, away from the building ring. */
export function treeSpots(key: string, ox: number, oy: number, size: number, count: number) {
  const out: { gx: number; gy: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = hash(`${key}:${i}`);
    const u = hash(`${key}:${i}:u`);
    const edge = i % 4;
    const along = 0.4 + t * (size - 0.8);
    const inset = 0.25 + u * 0.15;
    const gx = edge === 0 ? along : edge === 1 ? size - inset : edge === 2 ? along : inset;
    const gy = edge === 0 ? inset : edge === 1 ? along : edge === 2 ? size - inset : along;
    out.push({ gx: ox + gx, gy: oy + gy, r: 7 + hash(`${key}:${i}:r`) * 4 });
  }
  return out;
}

export const FRAMEWORK_COLORS: [RegExp, string, string][] = [
  [/crewai/i, "#b86a4b", "CrewAI"],
  [/claude|anthropic/i, "#d1b06c", "Claude"],
  [/actions/i, "#6e8a62", "GitHub Actions"],
  [/splunk/i, "#5f8f86", "Splunk"],
  [/n8n/i, "#b56a7a", "n8n"],
  [/shell/i, "#8a7a63", "Shell"],
  [/python/i, "#5d7891", "Python"],
];

export function frameworkColor(framework: string) {
  return FRAMEWORK_COLORS.find(([re]) => re.test(framework))?.[1] ?? "#8f9a8c";
}
