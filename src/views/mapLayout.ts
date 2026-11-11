import { projectRepositories, LANDMARK_REPOSITORIES, RETIRED_REPOSITORIES } from "../catalog/projects";
import { orderToolsForWorkflow, workflowToolSpots } from "./toolWorkflowLayout";
import { districtLabel, districtOf, districtRank } from "../catalog/organization";
import { servicesOf, type ServiceUse } from "../catalog/roles";
import type { Agent, Catalog, Project, Status } from "../catalog/types";

// Isometric projection: one grid unit is TW px across and TH px down per axis.
export const TW = 48;
export const TH = 24;
/** Grid units between neighboring districts, and between neighborhoods. */
export const GAP = 2.25;
const GROUP_GAP = 4.5;
/** Grid units per lot in the area for repositories without a manifest. */
const STRAY_STEP = 3;

export function iso(gx: number, gy: number) {
  return { x: (gx - gy) * TW, y: (gx + gy) * TH };
}

export type GroupBy = "none" | "district" | "status" | "tag";

export interface Lot {
  agent: Agent;
  gx: number;
  gy: number;
  size: number;
  height: number;
}

/** A kiosk for an outside service that the project's manifests name. */
export interface Kiosk {
  service: ServiceUse;
  gx: number;
  gy: number;
  size: number;
}

export interface District {
  project: Project;
  group: string;
  ox: number;
  oy: number;
  size: number;
  hq: { gx: number; gy: number; size: number; height: number };
  /** Reserved outdoor worker lots; all registered workers now live inside. */
  lots: Lot[];
  /** All registered agents and automations work inside this project building. */
  crew: Agent[];
  kiosks: Kiosk[];
}

export interface Stray {
  name: string;
  gx: number;
  gy: number;
  size: number;
  height: number;
}

/** Open ground: either the lot for repositories with no manifest, or an empty park. */
export interface Park {
  /** Walkway id, shared with {@link Walk.from} and {@link Walk.to}. */
  id: string;
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Repositories with no manifest, shown as plain buildings in this lot. */
  strays: Stray[];
  /** Plain lawn where a project building stood before it was taken off the map. */
  vacant?: true;
}

/**
 * Projects that stay registered (agents, Mission Control, search) but have no building on the map.
 * Skyline's district was removed to make space (KC, 2026-11-08). Service Desk, Career Applications
 * and Benjaire Dashboard were removed on 2026-11-09, and each keeps its land, so every other
 * building, road and bridge keeps its place.
 */
export const OFF_MAP_PROJECTS: ReadonlySet<string> = new Set(["skyline", "service-desk", "career-optimizer", "benjaire-ops"]);
/** Removed towers on the city's edge: their land becomes a plain lawn lot. */
const VACANT_LOTS: ReadonlySet<string> = new Set(["service-desk", "career-optimizer"]);
/**
 * Removed towers in the middle of the city: the streets and bridges that link their neighbors run
 * through the lot, so it keeps its streets and paving and only the building goes.
 */
export const CLEARED_LOTS: ReadonlySet<string> = new Set(["benjaire-ops"]);

/**
 * Lots of removed towers whose manifest is gone too. Career Applications' repository
 * (khaneilcampbell/career-application-system) was deleted on GitHub and its catalog file removed
 * (KC, 2026-11-10), but its land stays a vacant lot so no other building moves. Each entry holds only
 * what the layout reads: the lot's size comes from a district with nothing in it (5 across, as
 * before), its groupings from the old manifest, and it goes right after `after` in catalog order.
 */
const RETIRED_LOTS: { after: string; project: Project }[] = [
  {
    after: "benjaire-ops",
    project: {
      id: "career-optimizer",
      name: "Career Applications",
      summary: "Removed: the repository was deleted on GitHub.",
      status: "active",
      repository: "",
      tags: ["claude", "career", "human-in-the-loop"],
      district: "career-portfolio",
      links: [],
      agentIds: [],
    },
  },
];

/**
 * The catalog's projects with any missing {@link RETIRED_LOTS} put back in their old place. A project
 * with the same id or name back in the catalog takes the land instead, so it is never laid out twice.
 */
function withRetiredLots(projects: Project[]): Project[] {
  const out = [...projects];
  for (const { after, project } of RETIRED_LOTS) {
    if (out.some(p => p.id === project.id || p.name === project.name)) continue;
    const at = out.findIndex(p => p.id === after);
    out.splice(at < 0 ? out.length : at + 1, 0, project);
  }
  return out;
}

/**
 * Puts removed-tower lots back when the live catalog dropped them. A repository GitHub reports deleted
 * or archived takes its project out of the live catalog, and with it the lot that holds the city in
 * place, so every district repacked (2026-11-10: career-application-system gone moved Atlas Stadium
 * away from Atlas Airport in the installed app). These lots never draw a building, so their
 * repository's state must not change the map.
 */
export function keepRemovedLots(live: Catalog, full: Catalog): Catalog {
  const have = new Set(live.projects.map(p => p.id));
  const lost = full.projects.filter(p => (VACANT_LOTS.has(p.id) || CLEARED_LOTS.has(p.id)) && !have.has(p.id));
  if (!lost.length) return live;
  const ids = new Set(lost.map(p => p.id));
  const order = new Map(full.projects.map((p, i) => [p.id, i]));
  const projects = [...live.projects, ...lost].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  return { ...live, projects, agents: [...live.agents, ...full.agents.filter(a => ids.has(a.projectId))] };
}

/** A labelled block of districts when the map is grouped. */
export interface Neighborhood {
  key: string;
  label: string;
  count: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** A walkway on the meadow between two neighboring islands, along one grid axis. */
export interface Walk {
  from: string;
  to: string;
  axis: "x" | "y";
  /** Start (on the near island's edge) and end (on the far island's edge) in grid units. */
  a: { gx: number; gy: number };
  b: { gx: number; gy: number };
}

/** A patch of the low meadow that islands sit on. Patches in one neighborhood touch, so they read as one landmass. */
export interface Meadow {
  ox: number;
  oy: number;
  w: number;
  h: number;
}

export interface Layout {
  districts: District[];
  /**
   * Districts whose tower was removed but whose streets stay, because the city's roads run through
   * them (see CLEARED_LOTS). The scene lays their streets and paving and draws no building.
   */
  cleared?: District[];
  parks: Park[];
  neighborhoods: Neighborhood[];
  walks: Walk[];
  meadows: Meadow[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Ring of building slots around the central HQ. Slots far to the left and right on screen fill
 * first, then front before back, so a small district keeps its labels clear of the HQ label.
 */

export function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Ring width for a district: m=3 gives 8 lots, m=4 gives 12, m=5 gives 16. */
function ringFor(count: number) {
  let m = 3;
  while (4 * (m - 1) < count) m++;
  return m;
}

/** A district is sized for the houses and kiosks around its headquarters, so small projects stay compact. */
export function districtSize(lotCount: number, projectId?: string) {
  const fit = lotCount === 0 ? 5 : ringFor(lotCount) * 2.5;
  return Math.max(fit, (projectId && DISTRICT_MIN_SIZE[projectId]) || 0);
}

/**
 * Districts widened past what their houses and kiosks need, to fit a custom-built headquarters
 * and its grounds. The Commerce district holds the teardrop tower and its garden podium
 * (KC, 2026-11-01: "expand district landscape to fit design"). The Intelligence Hub district has
 * about twice its usual land (7.5 across, from 5: 2.25x the area, the nearest step on the grid),
 * and its building widens with it by the usual HQ share (KC, 2026-11-08: "expand intelligence hub
 * district size land mass 2x bigger"). Sizes stay on the 2.5 grid.
 */
export const DISTRICT_MIN_SIZE: Record<string, number> = { "commerce-pipeline": 10, "intelligence-hub": 7.5 };

/**
 * The headquarters' share of a district's width, where a custom-built HQ needs more ground than
 * the usual 0.26: the Commerce tower's podium is the whole teardrop site, half as wide again as
 * the tower (KC, 2026-11-01). Roads, paths and the plaza re-route round the bigger footprint.
 */
export const DISTRICT_HQ_SHARE: Record<string, number> = { "commerce-pipeline": 0.36 };
const MATCH_OPERATIONS_WIDTH = new Set(["ai-ops-atlas", "benjaire-site", "portfolio-site", "github-profile", "soc-lab"]);

/** What stands in a district: AI agents inside the headquarters, a house per automation, a kiosk per outside service. */
function residents(agents: Agent[]) {
  return { crew: agents, houses: [] as Agent[], services: orderToolsForWorkflow(servicesOf(agents)) };
}

interface Box {
  w: number;
  h: number;
}

/**
 * Shelf packing in grid space: boxes go left to right (down-right on screen) in rows of
 * roughly equal width, so any number of districts forms a compact diamond. Within a row,
 * smaller boxes sit toward the front, nearest the viewer.
 */
type Placed<T> = T & { x: number; y: number; cy: number; ch: number };

function shelf<T extends Box>(items: T[], gap: number): { placed: Placed<T>[]; w: number; h: number } {
  if (!items.length) return { placed: [], w: 0, h: 0 };
  const area = items.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const target = Math.max(Math.sqrt(area) * 1.05, ...items.map((b) => b.w));
  const placed: Placed<T>[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let row: Placed<T>[] = [];
  let width = 0;
  const closeRow = () => {
    for (const p of row) {
      p.y = y + (rowH - p.h);
      p.cy = y;
      p.ch = rowH;
    }
    y += rowH + gap;
    row = [];
    x = 0;
    rowH = 0;
  };
  for (const b of items) {
    if (row.length && x + b.w > target) closeRow();
    const p = { ...b, x, y: 0, cy: 0, ch: 0 };
    row.push(p);
    placed.push(p);
    x += b.w + gap;
    width = Math.max(width, x - gap);
    rowH = Math.max(rowH, b.h);
  }
  const h = y + rowH;
  closeRow();
  return { placed, w: width, h };
}

const STATUS_ORDER: Status[] = ["attention", "active", "idle", "paused", "retired"];
const STATUS_GROUP: Record<Status, string> = { attention: "Needs attention", active: "Active", idle: "Idle", paused: "Paused", retired: "Retired" };

function groupOf(p: Project, by: GroupBy, agents: Agent[]): { key: string; label: string; rank: number } {
  if (by === "district") {
    const d = districtOf(p, agents).value;
    return { key: `d:${d}`, label: districtLabel(d), rank: districtRank(d) };
  }
  if (by === "status") return { key: `s:${p.status}`, label: STATUS_GROUP[p.status], rank: STATUS_ORDER.indexOf(p.status) };
  if (by === "tag") {
    const t = p.tags[0];
    return t ? { key: `t:${t}`, label: t, rank: 0 } : { key: "t:", label: "Untagged", rank: 1 };
  }
  return { key: "all", label: "", rank: 0 };
}

export function layoutMap(catalog: Catalog, uncataloged: string[] = [], groupBy: GroupBy = "none"): Layout {
  const registered = new Set([...LANDMARK_REPOSITORIES,...RETIRED_REPOSITORIES,...catalog.projects.flatMap(p => projectRepositories(p, catalog.agents))]);
  uncataloged = [...new Set(uncataloged)].filter(name => !registered.has(name));
  const agentsByProject = new Map<string, Agent[]>();
  for (const a of catalog.agents) agentsByProject.set(a.projectId, [...(agentsByProject.get(a.projectId) ?? []), a]);

  // Bucket projects into neighborhoods, then pack each neighborhood on its own.
  const buckets = new Map<string, { label: string; rank: number; projects: Project[] }>();
  // Off-map projects have no building (see OFF_MAP_PROJECTS). A removed tower keeps its land as a
  // vacant lot in every grouping, so the rest of the city, its roads and its traffic stay as they were.
  const vacant = (p: Project) => VACANT_LOTS.has(p.id);
  const kept = (p: Project) => !OFF_MAP_PROJECTS.has(p.id) || vacant(p) || CLEARED_LOTS.has(p.id);
  const projects = withRetiredLots(catalog.projects);
  for (const p of projects.filter(kept)) {
    const g = groupOf(p, groupBy, catalog.agents);
    const b = buckets.get(g.key) ?? { label: g.label, rank: g.rank, projects: [] };
    b.projects.push(p);
    buckets.set(g.key, b);
  }
  const ordered = [...buckets.entries()].sort(([ka, a], [kb, b]) => a.rank - b.rank || a.label.localeCompare(b.label) || ka.localeCompare(kb));

  type Item = Box & { project?: Project; park?: true; vacant?: string };
  const blocks: (Box & { key: string; label: string; count: number; inner: ReturnType<typeof shelf<Item>>; strays?: string[] })[] = ordered.map(([key, b],blockIndex) => {
    const items: Item[] = b.projects
      .map((project): Item & { fit: number } => {
        const r = residents(agentsByProject.get(project.id) ?? []);
        const s = districtSize(r.houses.length + r.services.length, project.id);
        const fit = districtSize(r.houses.length + r.services.length);
        return vacant(project) ? { vacant: project.id, w: s, h: s, fit } : { project, w: s, h: s, fit };
      })
      // Largest first packs tighter; ties keep catalog order. A widened district keeps the place its
      // houses and kiosks give it, so it grows where it stands and its neighbors step aside.
      .sort((a, c) => c.fit - a.fit);
    // An empty park keeps the "room for the next project" corner of the original map (the open lot).
    if (blockIndex === ordered.length-1 && projects.length < 40) items.push({ park: true, w: 12, h: 9 });
    const inner = shelf(items, GAP);
    return { key, label: b.label, count: b.projects.filter(p => !OFF_MAP_PROJECTS.has(p.id)).length, inner, w: inner.w, h: inner.h };
  });
  if (uncataloged.length) {
    const cols = Math.ceil(Math.sqrt(uncataloged.length * 1.5));
    const rows = Math.ceil(uncataloged.length / cols);
    const w = Math.max(cols * STRAY_STEP, 7.5);
    const h = Math.max(rows * STRAY_STEP, 5);
    blocks.push({ key: "uncataloged", label: "Not in the catalog yet", count: uncataloged.length, inner: { placed: [], w, h }, strays: uncataloged, w, h });
  }

  // Districts share one landmass: the usual street gap between them, and walkways across, so
  // roads, bridges and street-routed connections reach every district. Other groupings stay apart.
  const joined = groupBy === "district";
  const outer = shelf(blocks, joined ? GAP : GROUP_GAP);
  const rects: { id: string; x: number; y: number; w: number; h: number }[] = [];
  const districts: District[] = [];
  const cleared: District[] = [];
  const parks: Park[] = [];
  const neighborhoods: Neighborhood[] = [];
  const meadows: Meadow[] = [];
  const walks: Walk[] = [];
  const g2 = GAP / 2;

  for (const blk of outer.placed) {
    neighborhoods.push({ key: blk.key, label: blk.label, count: blk.count, ox: blk.x, oy: blk.y, w: blk.w, h: blk.h });
    if (blk.strays) {
      meadows.push({ ox: blk.x - g2, oy: blk.y - g2, w: blk.w + GAP, h: blk.h + GAP });
      const cols = Math.max(1, Math.round(blk.w / STRAY_STEP));
      const size = STRAY_STEP * 0.42;
      parks.push({
        id: `strays:${blk.key}`,
        ox: blk.x,
        oy: blk.y,
        w: blk.w,
        h: blk.h,
        strays: blk.strays.map((name, k) => ({
          name,
          gx: blk.x + ((k % cols) + 0.5) * STRAY_STEP - size / 2,
          gy: blk.y + (Math.floor(k / cols) + 0.5) * STRAY_STEP - size / 2,
          size,
          height: 30 + Math.round(hash(name) * 20),
        })),
      });
      continue;
    }
    // Each island's meadow fills its whole shelf cell plus half the gap, so neighbors' patches meet.
    for (const it of blk.inner.placed) meadows.push({ ox: blk.x + it.x - g2, oy: blk.y + it.cy - g2, w: it.w + GAP, h: it.ch + GAP });
    const lotId = (it: Item) => it.vacant ? `park:vacant:${it.vacant}` : `park:${blk.key}`;
    const own = blk.inner.placed.map((it) => ({ id: it.project?.id ?? lotId(it), x: blk.x + it.x, y: blk.y + it.y, w: it.w, h: it.h }));
    if (joined) rects.push(...own);
    else walks.push(...walkways(own));
    for (const it of blk.inner.placed) {
      const ox = blk.x + it.x;
      const oy = blk.y + it.y;
      if (it.park) {
        parks.push({ id: `park:${blk.key}`, ox, oy, w: it.w, h: it.h, strays: [] });
        continue;
      }
      if (it.vacant) {
        parks.push({ id: lotId(it), ox, oy, w: it.w, h: it.h, strays: [], vacant: true });
        continue;
      }
      const project = it.project!;
      const agents = agentsByProject.get(project.id) ?? [];
      const { crew, houses, services } = residents(agents);
      const n = houses.length + services.length;
      const size = it.w;
      const m = n ? ringFor(n) : 2;
      const operationsWidth = districtSize(0, "intelligence-hub") * .34;
      const hqSize = Math.max(n ? size * (DISTRICT_HQ_SHARE[project.id] ?? 0.26) : size * 0.34, MATCH_OPERATIONS_WIDTH.has(project.id) ? operationsWidth : 0);
      // Keep widened headquarters clear of the existing front approaches. The three
      // standard towers use a .92 scene footprint: half their added rendered depth is .46.
      const hqSetback = project.id === "ai-ops-atlas" ? .35 : ["portfolio-site", "github-profile", "soc-lab"].includes(project.id) ? (hqSize - (n ? size * .26 : size * .34)) * .46 : 0;
      const lotSize = (size / m) * 0.52;
      const spots = n ? workflowToolSpots(n, size) : [];
      (CLEARED_LOTS.has(project.id) ? cleared : districts).push({
        project,
        group: blk.key,
        ox,
        oy,
        size,
        // Taller towers for busier projects, from the real agent count.
        hq: { gx: ox + size / 2 - hqSize / 2, gy: oy + size / 2 - hqSize / 2 - hqSetback, size: hqSize, height: ["benjaire-site", "github-profile", "intelligence-hub", "benjaire-ops", "soc-lab", "portfolio-site"].includes(project.id) ? 112 : 64 + Math.min(agents.length, 12) * 3 },
        lots: houses.map((a, k) => ({
          agent: a,
          gx: ox + spots[k].gx - lotSize / 2,
          gy: oy + spots[k].gy - lotSize / 2,
          size: lotSize,
          height: 26 + Math.round(hash(a.id) * 22),
        })),
        crew,
        // Kiosks take the slots after the houses, and a smaller footprint.
        kiosks: services.map((service, k) => {
          const s = spots[houses.length + k];
          const ks = lotSize * 0.72;
          return { service, gx: ox + s.gx - ks / 2, gy: oy + s.gy - ks / 2, size: ks };
        }),
      });
    }
  }

  // Reuse the equal-sized cleared central parcel; keep the meadow grid and landmark anchors.
  if (joined) {
    const hub = districts.find(d => d.project.id === "ai-ops-atlas");
    const center = cleared.find(d => d.project.id === "benjaire-ops");
    const campusComplete = ["benjaire-site", "commerce-pipeline", "intelligence-hub", "soc-lab", "portfolio-site", "github-profile"].every(id => districts.some(d => d.project.id === id));
    // Keep the proven fallback packing when repository filtering removes part of this campus.
    if (hub && center && campusComplete && catalog.projects.some(p => p.id === "service-desk") && hub.size === center.size) {
      const dx = center.ox - hub.ox, dy = center.oy - hub.oy;
      const move = (d: District, x: number, y: number) => {
        d.ox += x; d.oy += y; d.hq.gx += x; d.hq.gy += y;
        for (const lot of [...d.lots, ...d.kiosks]) { lot.gx += x; lot.gy += y; }
        const rect = rects.find(r => r.id === d.project.id);
        if (rect) { rect.x += x; rect.y += y; }
      };
      move(hub, dx, dy); move(center, -dx, -dy);
      const heading = neighborhoods.find(n => n.key === hub.group);
      if (heading && heading.count === 1) { heading.ox = hub.ox; heading.oy = hub.oy; heading.w = hub.size; heading.h = hub.size; }
    }
  }

  if (joined) walks.push(...walkways(rects));

  const boxes = [...[...districts, ...cleared].map((d) => ({ ox: d.ox, oy: d.oy, w: d.size, h: d.size })), ...parks, ...meadows];
  const corners = boxes.flatMap((d) => [iso(d.ox, d.oy), iso(d.ox + d.w, d.oy), iso(d.ox, d.oy + d.h), iso(d.ox + d.w, d.oy + d.h)]);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    districts,
    cleared,
    parks,
    neighborhoods,
    walks,
    meadows,
    bounds: xs.length ? { minX: Math.min(...xs), minY: Math.min(...ys) - 120, maxX: Math.max(...xs), maxY: Math.max(...ys) + 90 } : { minX: -200, minY: -200, maxX: 200, maxY: 200 },
  };
}

/**
 * Joins each island to its nearest neighbor down-right on screen (+x) and down-left (+y), when the two
 * share enough edge for a path. That gives every neighborhood a connected street grid without crossings.
 */
function walkways(rs: { id: string; x: number; y: number; w: number; h: number }[]): Walk[] {
  const out: Walk[] = [];
  const MIN = 1.2;
  for (const a of rs) {
    type Near = { r: (typeof rs)[number]; gap: number; mid: number };
    let bx: Near | null = null;
    let by: Near | null = null;
    for (const r of rs) {
      if (r === a) continue;
      const oy = Math.min(a.y + a.h, r.y + r.h) - Math.max(a.y, r.y);
      const gx = r.x - (a.x + a.w);
      if (gx >= 0 && oy >= MIN && (!bx || gx < bx.gap)) bx = { r, gap: gx, mid: Math.max(a.y, r.y) + oy / 2 };
      const ox = Math.min(a.x + a.w, r.x + r.w) - Math.max(a.x, r.x);
      const gy = r.y - (a.y + a.h);
      if (gy >= 0 && ox >= MIN && (!by || gy < by.gap)) by = { r, gap: gy, mid: Math.max(a.x, r.x) + ox / 2 };
    }
    if (bx) out.push({ from: a.id, to: bx.r.id, axis: "x", a: { gx: a.x + a.w, gy: bx.mid }, b: { gx: bx.r.x, gy: bx.mid } });
    if (by) out.push({ from: a.id, to: by.r.id, axis: "y", a: { gx: by.mid, gy: a.y + a.h }, b: { gx: by.mid, gy: by.r.y } });
  }
  return out;
}

/** Deterministic tree spots along a lot's edges, away from the building ring. */
export function treeSpots(key: string, ox: number, oy: number, w: number, count: number, h = w) {
  const out: { gx: number; gy: number; r: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = hash(`${key}:${i}`);
    const u = hash(`${key}:${i}:u`);
    const edge = i % 4;
    const len = edge % 2 === 0 ? w : h;
    const along = 0.4 + t * (len - 0.8);
    const inset = 0.25 + u * 0.15;
    const gx = edge === 0 ? along : edge === 1 ? w - inset : edge === 2 ? along : inset;
    const gy = edge === 0 ? inset : edge === 1 ? along : edge === 2 ? h - inset : along;
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

// ── Label placement ─────────────────────────────────

export interface LabelBox {
  id: string;
  /** Center x and vertical extent in world (unscaled map) units. */
  x: number;
  top: number;
  bottom: number;
  w: number;
  /** Lower draws first and wins collisions. */
  priority: number;
  /** Vertical offsets to try, in order, when the preferred spot is taken. */
  alts?: number[];
}

/**
 * Greedy placement: labels are taken in priority order. Each tries its preferred spot, then its
 * alternatives, and is hidden only when every spot overlaps a label already placed. A coarse grid
 * keeps this near linear for hundreds of labels. Returns the chosen vertical offset per shown label.
 */
export function placeLabels(boxes: LabelBox[], pad = 4): Map<string, number> {
  const CELL = 160;
  const grid = new Map<string, LabelBox[]>();
  const shown = new Map<string, number>();
  const cells = (b: LabelBox) => {
    const out: string[] = [];
    for (let cx = Math.floor((b.x - b.w / 2 - pad) / CELL); cx <= Math.floor((b.x + b.w / 2 + pad) / CELL); cx++)
      for (let cy = Math.floor((b.top - pad) / CELL); cy <= Math.floor((b.bottom + pad) / CELL); cy++) out.push(`${cx},${cy}`);
    return out;
  };
  const hits = (a: LabelBox, b: LabelBox) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && a.top < b.bottom + pad && b.top < a.bottom + pad;
  for (const b of [...boxes].sort((p, q) => p.priority - q.priority)) {
    for (const dy of [0, ...(b.alts ?? [])]) {
      const c = { ...b, top: b.top + dy, bottom: b.bottom + dy };
      const keys = cells(c);
      if (keys.some((k) => grid.get(k)?.some((o) => hits(c, o)))) continue;
      shown.set(b.id, dy);
      for (const k of keys) grid.set(k, [...(grid.get(k) ?? []), c]);
      break;
    }
  }
  return shown;
}

/** Rough width of label text; good enough to keep pills from touching. */
export function textWidth(text: string, fontSize: number, serif = false) {
  return text.length * fontSize * (serif ? 0.5 : 0.55);
}
