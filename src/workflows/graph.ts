import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "./types";

// Pure graph helpers: checks, order and a deterministic layered layout. No graph library: the
// layout is a longest-path layering, which is all a left-to-right dependency chart needs.

export function definitionProblems(d: WorkflowDefinition): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const n of d.nodes) {
    if (ids.has(n.id)) out.push(`Duplicate node ${n.id}`);
    ids.add(n.id);
  }
  const edgeIds = new Set<string>();
  for (const e of d.edges) {
    if (edgeIds.has(e.id)) out.push(`Duplicate edge ${e.id}`);
    edgeIds.add(e.id);
    if (!ids.has(e.from) || !ids.has(e.to)) out.push(`Edge ${e.id} points at a missing node`);
    if (e.from === e.to) out.push(`Edge ${e.id} loops on itself`);
  }
  for (const n of d.nodes) {
    const outs = d.edges.filter((e) => e.from === n.id);
    if (n.kind === "decision" && (outs.length < 2 || outs.some((e) => !e.branch))) out.push(`Decision ${n.id} needs labelled yes/no branches`);
    if (n.kind !== "decision" && outs.some((e) => e.branch)) out.push(`Only decisions branch (${n.id})`);
    if (n.kind === "approval" && !n.approval?.categories.length) out.push(`Approval ${n.id} names no approval category`);
  }
  if (!out.length && topoOrder(d) === null) out.push("The workflow has a cycle");
  return out;
}

/** Kahn's order, ties broken by the order nodes are listed. Null when there's a cycle. */
export function topoOrder(d: Pick<WorkflowDefinition, "nodes" | "edges">): string[] | null {
  const indeg = new Map(d.nodes.map((n) => [n.id, 0]));
  for (const e of d.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const pos = new Map(d.nodes.map((n, i) => [n.id, i]));
  const ready = d.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const out: string[] = [];
  while (ready.length) {
    ready.sort((a, b) => pos.get(a)! - pos.get(b)!);
    const id = ready.shift()!;
    out.push(id);
    for (const e of d.edges) {
      if (e.from !== id) continue;
      const left = indeg.get(e.to)! - 1;
      indeg.set(e.to, left);
      if (left === 0) ready.push(e.to);
    }
  }
  return out.length === d.nodes.length ? out : null;
}

export const upstream = (d: Pick<WorkflowDefinition, "edges">, id: string) => d.edges.filter((e) => e.to === id).map((e) => e.from);
export const downstream = (d: Pick<WorkflowDefinition, "edges">, id: string) => d.edges.filter((e) => e.from === id).map((e) => e.to);

/** Longest-path depth from any start node. */
export function levels(d: WorkflowDefinition): Map<string, number> {
  const order = topoOrder(d) ?? d.nodes.map((n) => n.id);
  const lv = new Map<string, number>(order.map((id) => [id, 0]));
  for (const id of order) for (const e of d.edges) if (e.from === id) lv.set(e.to, Math.max(lv.get(e.to) ?? 0, lv.get(id)! + 1));
  return lv;
}

export const NODE_W = 196;
export const NODE_H = 72;
const COL_GAP = 64;
const ROW_GAP = 22;
const PAD = 24;

export interface PlacedNode {
  node: WorkflowNode;
  x: number;
  y: number;
  level: number;
}

export interface PlacedEdge {
  edge: WorkflowEdge;
  /** SVG path from the source's right side to the target's left side. */
  d: string;
  /** Where the label sits. */
  lx: number;
  ly: number;
}

export interface Layout {
  nodes: PlacedNode[];
  byId: Map<string, PlacedNode>;
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/** Columns by level, rows by listing order, each column centred on the tallest one. */
export function layout(d: WorkflowDefinition): Layout {
  const lv = levels(d);
  const cols = new Map<number, WorkflowNode[]>();
  for (const n of d.nodes) {
    const l = lv.get(n.id) ?? 0;
    if (!cols.has(l)) cols.set(l, []);
    cols.get(l)!.push(n);
  }
  const tallest = Math.max(1, ...[...cols.values()].map((c) => c.length));
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP;
  const nodes: PlacedNode[] = [];
  for (const [l, col] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    const colH = col.length * NODE_H + (col.length - 1) * ROW_GAP;
    const top = (height - colH) / 2;
    col.forEach((node, i) => nodes.push({ node, level: l, x: PAD + l * (NODE_W + COL_GAP), y: top + i * (NODE_H + ROW_GAP) }));
  }
  const byId = new Map(nodes.map((p) => [p.node.id, p]));
  const edges: PlacedEdge[] = d.edges.flatMap((edge) => {
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    if (!a || !b) return [];
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    return [{ edge, d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, lx: mid, ly: (y1 + y2) / 2 - 6 }];
  });
  const maxLevel = Math.max(0, ...nodes.map((n) => n.level));
  return { nodes, byId, edges, width: PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * COL_GAP, height };
}
