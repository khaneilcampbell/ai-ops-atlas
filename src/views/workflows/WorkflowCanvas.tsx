import { memo, useCallback, useEffect, useRef } from "react";
import { NODE_H, NODE_W, type Layout, type PlacedNode } from "../../workflows/graph";
import type { ResolvedNode } from "../../workflows/engine";
import { NODE_STATUS_LABEL, type NodeKind, type NodeStatus } from "../../workflows/types";

// The execution canvas: a plain SVG drawing of the workflow. Pan and zoom write the transform
// straight to the DOM (no React state per pointer move), and nodes are memoised on their own props,
// so a status change re-renders only the nodes it touches.

const KIND_LABEL: Record<NodeKind, string> = { agent: "Agent", automation: "Automation", decision: "Decision", approval: "Approval", outcome: "Outcome" };

export const statusTone = (s: NodeStatus): string =>
  s === "running" || s === "queued" ? "run" : s === "completed" ? "done" : s === "failed" || s === "no_task" ? "bad" : s === "awaiting_approval" || s === "blocked" ? "wait" : s === "unconfigured" ? "unconf" : s === "skipped" ? "skip" : "idle";

interface NodeProps {
  p: PlacedNode;
  who: string;
  where: string;
  status: NodeStatus;
  selected: boolean;
  /** In the building picked in the building list or on the map. */
  inBuilding: boolean;
  dimmed: boolean;
  onPick: (id: string) => void;
}

const WfNode = memo(function WfNode({ p, who, where, status, selected, inBuilding, dimmed, onPick }: NodeProps) {
  const n = p.node;
  const tone = statusTone(status);
  const cls = `wf-node kind-${n.kind} tone-${tone}${selected ? " selected" : ""}${inBuilding ? " in-building" : ""}${dimmed ? " dimmed" : ""}${n.unconfigured ? " unconfigured" : ""}`;
  return (
    <g
      className={cls}
      transform={`translate(${p.x},${p.y})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${n.title}. ${KIND_LABEL[n.kind]}. ${NODE_STATUS_LABEL[status]}${n.unconfigured ? ". Unconfigured" : ""}`}
      onClick={() => onPick(n.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(n.id);
        }
      }}
    >
      <rect className="wf-node-box" width={NODE_W} height={NODE_H} rx={n.kind === "outcome" ? NODE_H / 2 : n.kind === "decision" ? 4 : 10} />
      <rect className="wf-node-band" width={4} height={NODE_H - 16} x={0} y={8} rx={2} />
      <text className="wf-node-kind" x={14} y={17}>
        {KIND_LABEL[n.kind].toUpperCase()}
        {n.approval ? " · APPROVAL GATE" : ""}
      </text>
      <text className="wf-node-title" x={14} y={35}>
        {clip(n.title, 26)}
      </text>
      <text className="wf-node-who" x={14} y={51}>
        {clip(who, 30)}
      </text>
      <circle className="wf-node-dot" cx={18} cy={63} r={3.5} />
      <text className="wf-node-status" x={27} y={66}>
        {clip(n.unconfigured && status !== "unconfigured" ? `Unconfigured` : NODE_STATUS_LABEL[status], 17)}
      </text>
      <text className="wf-node-where" x={NODE_W - 10} y={66} textAnchor="end">
        {clip(where, 12)}
      </text>
    </g>
  );
});

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface CanvasProps {
  layout: Layout;
  resolved: ReadonlyMap<string, ResolvedNode>;
  status: ReadonlyMap<string, NodeStatus>;
  selectedNode: string | null;
  selectedBuilding: string | null;
  onPick: (id: string) => void;
}

export function WorkflowCanvas({ layout, resolved, status, selectedNode, selectedBuilding, onPick }: CanvasProps) {
  const svg = useRef<SVGSVGElement>(null);
  const view = useRef<SVGGElement>(null);
  const t = useRef({ x: 0, y: 0, k: 1 });

  const apply = useCallback(() => {
    const { x, y, k } = t.current;
    view.current?.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
  }, []);

  // Natural size, vertically centred, starting at the left. "Fit" shows the whole graph.
  const reset = useCallback(
    (whole: boolean) => {
      const el = svg.current;
      if (!el) return;
      const w = el.clientWidth || 800;
      const h = el.clientHeight || 400;
      const k = whole ? Math.min(w / layout.width, h / layout.height) : 1;
      t.current = { k, x: whole ? 0 : 8, y: (h - layout.height * k) / 2 };
      apply();
    },
    [apply, layout.width, layout.height],
  );
  useEffect(() => reset(false), [reset]);

  // Bring a selected step into view (selected here, in the timeline or from the map side).
  useEffect(() => {
    const el = svg.current;
    const p = selectedNode ? layout.byId.get(selectedNode) : undefined;
    if (!el || !p) return;
    const { x, y, k } = t.current;
    const l = p.x * k + x;
    const r = (p.x + NODE_W) * k + x;
    if (l >= 0 && r <= el.clientWidth) return;
    t.current = { k, y, x: el.clientWidth / 2 - (p.x + NODE_W / 2) * k };
    apply();
  }, [selectedNode, layout, apply]);

  const zoom = useCallback(
    (factor: number, cx = (svg.current?.clientWidth ?? 800) / 2, cy = (svg.current?.clientHeight ?? 400) / 2) => {
      const c = t.current;
      const k = Math.min(3, Math.max(0.4, c.k * factor));
      t.current = { k, x: cx - ((cx - c.x) * k) / c.k, y: cy - ((cy - c.y) * k) / c.k };
      apply();
    },
    [apply],
  );

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 40) {
        // Two-finger scroll pans; pinch (ctrlKey) or a mouse wheel zooms.
        t.current = { ...t.current, x: t.current.x - e.deltaX, y: t.current.y - e.deltaY };
        apply();
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [apply, zoom]);

  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest(".wf-node")) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const el = svg.current;
    if (!d || d.id !== e.pointerId || !el) return;
    t.current = { ...t.current, x: t.current.x + (e.clientX - d.x), y: t.current.y + (e.clientY - d.y) };
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved = true;
    apply();
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const doneOrLive = (id: string) => {
    const s = status.get(id);
    return s === "completed";
  };

  return (
    <div className="wf-canvas">
      <div className="wf-canvas-tools" role="toolbar" aria-label="Canvas zoom">
        <button className="icon-btn" onClick={() => zoom(1.2)} aria-label="Zoom in" title="Zoom in">
          +
        </button>
        <button className="icon-btn" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out" title="Zoom out">
          −
        </button>
        <button className="text-btn small" onClick={() => reset(true)} title="Fit the whole workflow">
          Fit
        </button>
        <button className="text-btn small" onClick={() => reset(false)} title="Actual size">
          100%
        </button>
      </div>
      <svg
        ref={svg}
        className="wf-svg"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="group"
        aria-label="Workflow graph. Drag to pan, pinch or scroll to zoom."
      >
        <defs>
          <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="wf-arrow" />
          </marker>
          <marker id="wf-arrow-live" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="wf-arrow live" />
          </marker>
        </defs>
        <g ref={view}>
          {layout.edges.map((e) => {
            const skipped = status.get(e.edge.to) === "skipped";
            const live = doneOrLive(e.edge.from) && !skipped;
            const touches = selectedNode && (e.edge.from === selectedNode || e.edge.to === selectedNode);
            return (
              <g key={e.edge.id} className={`wf-edge${live ? " live" : ""}${skipped ? " skipped" : ""}${touches ? " touches" : ""}`}>
                <path d={e.d} markerEnd={`url(#${live ? "wf-arrow-live" : "wf-arrow"})`} />
                {e.edge.label && (
                  <text x={e.lx} y={e.ly} textAnchor="middle" className="wf-edge-label">
                    {e.edge.label}
                  </text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((p) => {
            const r = resolved.get(p.node.id);
            const inBuilding = !!selectedBuilding && r?.buildingId === selectedBuilding;
            return (
              <WfNode
                key={p.node.id}
                p={p}
                who={r?.agentName ?? (p.node.kind === "approval" || p.node.kind === "decision" ? "Khaneil" : p.node.unconfigured ? "No owner configured" : "—")}
                where={r?.buildingName ?? ""}
                status={status.get(p.node.id) ?? "not_started"}
                selected={selectedNode === p.node.id}
                inBuilding={inBuilding}
                dimmed={!!selectedBuilding && !inBuilding}
                onPick={onPick}
              />
            );
          })}
        </g>
      </svg>
    </div>
  );
}
