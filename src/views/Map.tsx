import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Status } from "../catalog/types";
import { Icon, type IconName } from "../components/Icon";
import { StatusPill, statusLabel } from "../components/bits";
import { effectiveLastRun, overallHealth, repoData, repoHealth } from "../lib/derive";
import { relative } from "../lib/time";
import { useAtlas } from "../state";
import { FRAMEWORK_COLORS, TH, frameworkColor, iso, layoutMap, treeSpots, type District } from "./mapLayout";

type Pt = { x: number; y: number };
const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
const up = (p: Pt, h: number) => ({ x: p.x, y: p.y - h });

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function Box({ gx, gy, w, h, wall, roof, onClick, onEnter, onLeave, highlight, windows }: {
  gx: number; gy: number; w: number; h: number; wall: string; roof: string; highlight?: boolean; windows?: boolean;
  onClick?: () => void; onEnter?: (e: React.MouseEvent) => void; onLeave?: () => void;
}) {
  const A = iso(gx, gy + w), B = iso(gx + w, gy + w), C = iso(gx + w, gy), D = iso(gx, gy);
  const rows = windows ? Math.floor(h / 14) : 0;
  return (
    <g className="bldg" onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ cursor: onClick ? "pointer" : undefined }}>
      <ellipse cx={B.x} cy={B.y - 2} rx={w * 30} ry={w * 9} fill="rgba(30,45,30,0.12)" />
      <polygon points={pts([A, B, up(B, h), up(A, h)])} fill={shade(wall, 0.93)} />
      <polygon points={pts([B, C, up(C, h), up(B, h)])} fill={shade(wall, 0.8)} />
      {Array.from({ length: rows }, (_, r) => {
        const y = h - 10 - r * 14;
        const l1 = { x: A.x + (B.x - A.x) * 0.15, y: A.y + (B.y - A.y) * 0.15 - y };
        const l2 = { x: A.x + (B.x - A.x) * 0.85, y: A.y + (B.y - A.y) * 0.85 - y };
        const r1 = { x: B.x + (C.x - B.x) * 0.15, y: B.y + (C.y - B.y) * 0.15 - y };
        const r2 = { x: B.x + (C.x - B.x) * 0.85, y: B.y + (C.y - B.y) * 0.85 - y };
        return (
          <g key={r} stroke="rgba(40,60,50,0.35)" strokeWidth={3} strokeDasharray="5 4">
            <line x1={l1.x} y1={l1.y} x2={l2.x} y2={l2.y} />
            <line x1={r1.x} y1={r1.y} x2={r2.x} y2={r2.y} />
          </g>
        );
      })}
      <polygon points={pts([up(D, h), up(C, h), up(B, h), up(A, h)])} fill={roof} stroke={highlight ? "#c9a35a" : "rgba(255,255,255,0.35)"} strokeWidth={highlight ? 3 : 1} />
    </g>
  );
}

function Tree({ gx, gy, r }: { gx: number; gy: number; r: number }) {
  const p = iso(gx, gy);
  return (
    <g>
      <ellipse cx={p.x} cy={p.y} rx={r * 0.9} ry={r * 0.35} fill="rgba(30,45,30,0.15)" />
      <rect x={p.x - 1.5} y={p.y - 8} width={3} height={8} fill="#7b6a4f" />
      <circle cx={p.x} cy={p.y - 8 - r * 0.7} r={r} fill="#6f8f4e" />
      <circle cx={p.x - r * 0.3} cy={p.y - 8 - r} r={r * 0.45} fill="#86a560" />
    </g>
  );
}

function Label({ x, y, text, tone, onClick }: { x: number; y: number; text: string; tone: "dark" | "light" | "gold"; onClick?: () => void }) {
  const w = Math.max(48, text.length * 8.2 + 24);
  const fill = tone === "dark" ? "#1d2b22" : tone === "gold" ? "#6e5323" : "#f1f2ea";
  const color = tone === "light" ? "#1d2620" : "#f1f2ea";
  const stroke = tone === "gold" ? "#c9a35a" : tone === "dark" ? "rgba(201,163,90,0.35)" : "rgba(29,43,34,0.15)";
  return (
    <g transform={`translate(${x},${y})`} onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <rect x={-w / 2} y={-14} width={w} height={28} rx={9} fill={fill} stroke={stroke} />
      <text textAnchor="middle" y={5} fontSize={15} fill={color} fontFamily="-apple-system, system-ui, sans-serif">
        {text}
      </text>
    </g>
  );
}

const STATUS_ICON: Record<Status, IconName> = { active: "play", idle: "circle", paused: "pause", attention: "alert", retired: "close" };
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function MapView() {
  const { catalog, repos, select, selection, settings, setSettings, setView } = useAtlas();
  const layout = useMemo(() => layoutMap(catalog), [catalog]);
  const stage = useRef<HTMLDivElement>(null);
  const [view, setViewBox] = useState({ x: 0, y: 0, k: 1 });
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [focus, setFocus] = useState<string>(catalog.projects[0]?.id ?? "");
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const b = layout.bounds;
    // The intro text sits in the empty top-left corner of the diamond, so only a little is reserved.
    const top = 40;
    const bottom = 60;
    const k = Math.min((width - 60) / (b.maxX - b.minX), (height - top - bottom) / (b.maxY - b.minY), 1.4);
    setViewBox({ k, x: (width - (b.maxX - b.minX) * k) / 2 - b.minX * k, y: top + (height - top - bottom - (b.maxY - b.minY) * k) / 2 - b.minY * k });
  }, [layout]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (stage.current) ro.observe(stage.current);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const el = stage.current!;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setViewBox((v) => {
      const k = Math.min(3, Math.max(0.3, v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  };

  // Wheel zoom has to be a non-passive listener so it can stop the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else setViewBox((v) => ({ ...v, x: v.x - e.deltaX }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const showTip = (e: React.MouseEvent, title: string, sub: string) => {
    const r = stage.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, sub });
  };

  const agentsShown = settings.showMapLabels || view.k > 1.15;
  const focused = layout.districts.find((d) => d.project.id === focus) ?? layout.districts[0];
  const isSelected = (kind: "agent" | "repo", id: string) => selection?.kind === kind && selection.id === id;

  const lots = layout.districts.flatMap((d) => d.lots.map((l) => ({ ...l, d })));
  const drawables = [
    ...lots.map((l) => ({ depth: l.gx + l.gy + l.size * 2, kind: "lot" as const, l })),
    ...layout.districts.map((d) => ({ depth: d.hq.gx + d.hq.gy + d.hq.size * 2, kind: "hq" as const, d })),
  ].sort((a, b) => a.depth - b.depth);

  const usedFrameworks = FRAMEWORK_COLORS.filter(([re]) => catalog.agents.some((a) => re.test(a.framework)));

  return (
    <div className="map-wrap">
      <div
        ref={stage}
        className={`map-stage ${dragging ? "dragging" : ""}`}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) {
            d.moved = true;
            setDragging(true);
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }
          setTip(null);
          setViewBox((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onClickCapture={(e) => {
          // A drag that ends over a building must not count as a click on it.
          if (dragging) e.stopPropagation();
        }}
      >
        <svg role="img" aria-label="Workspace map of projects, repositories and agents">
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {layout.parks.map((p, i) => (
              <ParkTile key={i} ox={p.ox} oy={p.oy} size={p.size} />
            ))}
            {layout.districts.map((d) => (
              <Ground key={d.project.id} d={d} focused={d === focused} onFocus={() => setFocus(d.project.id)} />
            ))}
            {layout.districts.flatMap((d) => treeSpots(d.project.id, d.ox, d.oy, d.size, 18)).map((t, i) => (
              <Tree key={i} {...t} />
            ))}
            {drawables.map((it) => {
              if (it.kind === "hq") {
                const d = it.d;
                const snap = repoData(repos[d.project.repository]);
                return (
                  <Box
                    key={`hq:${d.project.id}`}
                    gx={d.hq.gx}
                    gy={d.hq.gy}
                    w={d.hq.size}
                    h={d.hq.height}
                    wall="#ece5d2"
                    roof="#2f4535"
                    windows
                    highlight={isSelected("repo", d.project.repository)}
                    onClick={() => {
                      setFocus(d.project.id);
                      select({ kind: "repo", id: d.project.repository });
                    }}
                    onEnter={(e) => showTip(e, d.project.repository, snap?.commits[0] ? `Latest commit ${relative(snap.commits[0].date)}: ${short(snap.commits[0].message, 40)}` : "Repository")}
                    onLeave={() => setTip(null)}
                  />
                );
              }
              const { l } = it;
              const a = l.agent;
              return (
                <Box
                  key={a.id}
                  gx={l.gx}
                  gy={l.gy}
                  w={l.size}
                  h={l.height}
                  wall={a.status === "retired" ? "#d4d6cc" : "#f2ecdc"}
                  roof={a.status === "attention" ? "#c9a35a" : frameworkColor(a.framework)}
                  highlight={isSelected("agent", a.id)}
                  onClick={() => {
                    setFocus(a.projectId);
                    select({ kind: "agent", id: a.id });
                  }}
                  onEnter={(e) => showTip(e, a.name, `${a.framework} · ${statusLabel(a.status)} · last run ${relative(effectiveLastRun(a, repoData(repos[a.repository]))).toLowerCase()}`)}
                  onLeave={() => setTip(null)}
                />
              );
            })}
            {layout.districts.map((d) => <Connections key={`c:${d.project.id}`} d={d} />)}
            {agentsShown &&
              lots.map((l) => {
                const c = iso(l.gx + l.size / 2, l.gy + l.size / 2);
                const a = l.agent;
                return (
                  <Label
                    key={`l:${a.id}`}
                    x={c.x}
                    y={c.y - l.height - TH * l.size * 0.5 - 14}
                    text={a.status === "attention" ? `${short(a.name, 18)} · needs attention` : short(a.name)}
                    tone={a.status === "attention" ? "gold" : "light"}
                    onClick={() => select({ kind: "agent", id: a.id })}
                  />
                );
              })}
            {layout.districts.map((d) => {
              const c = iso(d.hq.gx + d.hq.size / 2, d.hq.gy + d.hq.size / 2);
              const front = iso(d.ox + d.size, d.oy + d.size);
              return (
                <g key={`n:${d.project.id}`}>
                  <Label x={c.x} y={c.y - d.hq.height - TH * d.hq.size * 0.5 - 16} text={d.project.repository.split("/")[1]} tone="dark" onClick={() => select({ kind: "repo", id: d.project.repository })} />
                  <text x={front.x} y={front.y + 72} textAnchor="middle" fontFamily="ui-serif, 'New York', Georgia, serif" fontSize={26} fill="#1d2b22" style={{ cursor: "pointer" }} onClick={() => setFocus(d.project.id)}>
                    {d.project.name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="map-intro">
          <div className="eyebrow">Workspace map</div>
          <h1>Welcome to the neighborhood.</h1>
          <p className="lede small">Each project is a district. Its repository is the tall building in the middle and its agents are the houses around it.</p>
        </div>

        {tip && (
          <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
            <div className="t">{tip.title}</div>
            <div className="s">{tip.sub}</div>
          </div>
        )}

        <div className="map-legend" aria-label="Roof colors by framework">
          {usedFrameworks.map(([re, color, label]) => (
            <span key={String(re)} className="health">
              <i style={{ background: color, borderRadius: 2 }} />
              {label}
            </span>
          ))}
          <span className="health">
            <i style={{ background: "#c9a35a", borderRadius: 2, outline: "1px solid #7d5f25" }} />
            Needs attention
          </span>
        </div>

        <div className="map-controls">
          <button className="icon-btn" onClick={fit} aria-label="Fit map" title="Fit map">
            <Icon name="focus" size={17} />
          </button>
          <button className={`icon-btn ${settings.showMapLabels ? "on" : ""}`} onClick={() => setSettings({ showMapLabels: !settings.showMapLabels })} aria-label="Toggle agent labels" title="Agent labels">
            <Icon name="labels" size={17} />
          </button>
          <button className="icon-btn" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in">
            <Icon name="plus" size={17} />
          </button>
          <button className="icon-btn" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out">
            <Icon name="minus" size={17} />
          </button>
        </div>
      </div>

      {focused && <ProjectBar d={focused} onOpenList={() => setView("agents")} />}
    </div>
  );
}

function Ground({ d, focused, onFocus }: { d: District; focused: boolean; onFocus: () => void }) {
  const m = 0.55;
  const road = [iso(d.ox - m, d.oy - m), iso(d.ox + d.size + m, d.oy - m), iso(d.ox + d.size + m, d.oy + d.size + m), iso(d.ox - m, d.oy + d.size + m)];
  const ground = [iso(d.ox, d.oy), iso(d.ox + d.size, d.oy), iso(d.ox + d.size, d.oy + d.size), iso(d.ox, d.oy + d.size)];
  const depth = 10;
  return (
    <g onClick={onFocus}>
      <polygon points={pts([road[3], road[2], up(road[2], -depth), up(road[3], -depth)])} fill="#8e9586" />
      <polygon points={pts([road[2], road[1], up(road[1], -depth), up(road[2], -depth)])} fill="#7c8475" />
      <polygon points={pts(road)} fill="#aeb2a6" stroke={focused ? "#c9a35a" : "none"} strokeWidth={focused ? 3 : 0} />
      <polygon points={pts(road)} fill="none" stroke="#e8e6da" strokeWidth={1.5} strokeDasharray="10 10" transform="translate(0,0)" opacity={0.7} />
      <polygon points={pts(ground)} fill="#d8dcae" />
    </g>
  );
}

function Connections({ d }: { d: District }) {
  // Paths from the repository HQ to each agent house, drawn as footpaths on the ground.
  const hc = { gx: d.hq.gx + d.hq.size / 2, gy: d.hq.gy + d.hq.size / 2 };
  return (
    <g pointerEvents="none" opacity={0.55}>
      {d.lots.map((l) => {
        const lc = { gx: l.gx + l.size / 2, gy: l.gy + l.size / 2 };
        const a = iso(hc.gx, hc.gy), b = iso(lc.gx, hc.gy), c = iso(lc.gx, lc.gy);
        return <polyline key={l.agent.id} points={pts([a, b, c])} fill="none" stroke="#c9a35a" strokeWidth={1.5} strokeDasharray="2 5" />;
      })}
    </g>
  );
}

function ParkTile({ ox, oy, size }: { ox: number; oy: number; size: number }) {
  const ground = [iso(ox, oy), iso(ox + size, oy), iso(ox + size, oy + size), iso(ox, oy + size)];
  const pond = [iso(ox + size * 0.35, oy + size * 0.3), iso(ox + size * 0.75, oy + size * 0.3), iso(ox + size * 0.75, oy + size * 0.7), iso(ox + size * 0.35, oy + size * 0.7)];
  return (
    <g pointerEvents="none">
      <polygon points={pts(ground)} fill="#cdd3a3" opacity={0.85} />
      <polygon points={pts(pond)} fill="#8fb3a8" stroke="#a9c7bc" strokeWidth={3} />
      {treeSpots(`park:${ox}:${oy}`, ox, oy, size, 14).map((t, i) => (
        <Tree key={i} {...t} />
      ))}
      <text x={iso(ox + size * 0.75, oy + size * 0.75).x} y={iso(ox + size * 0.75, oy + size * 0.75).y + 40} textAnchor="middle" fontFamily="ui-serif, Georgia, serif" fontSize={20} fill="#47524a" opacity={0.8}>
        Room for the next project
      </text>
    </g>
  );
}

function ProjectBar({ d, onOpenList }: { d: District; onOpenList: () => void }) {
  const { catalog, repos, select, setFilters, clearFilters } = useAtlas();
  const agents: Agent[] = d.lots.map((l) => l.agent);
  const snap = repoData(repos[d.project.repository]);
  const health = overallHealth(repoHealth(snap, agents.length));
  return (
    <div className="map-bar">
      <div className="row">
        <span className="brand-mark" style={{ width: 44, height: 44, borderRadius: 12 }}>
          <Icon name="repos" size={20} />
        </span>
        <div>
          <div className="eyebrow">
            {d.project.repository} · {agents.length} agents
          </div>
          <h3>{d.project.name}</h3>
        </div>
        <span className="grow" />
        <StatusPill status={d.project.status} />
        <span className="health" style={{ color: "var(--on-dark-2)" }}>
          <i className={`h-${health}`} /> Repo {health === "good" ? "healthy" : health === "unknown" ? "not synced" : health === "warn" ? "needs a look" : "failing"}
        </span>
        <button className="ghost-btn" onClick={() => select({ kind: "repo", id: d.project.repository })}>
          <Icon name="repos" size={15} /> Repository
        </button>
        <button
          className="ghost-btn"
          onClick={() => {
            clearFilters();
            setFilters({ project: d.project.id });
            onOpenList();
          }}
        >
          <Icon name="agents" size={15} /> List agents
        </button>
      </div>
      <div className="steps" aria-label={`Agents in ${d.project.name}`}>
        {agents.map((a, i) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && <span className="step-line" />}
            <button className={`step s-${a.status}`} onClick={() => select({ kind: "agent", id: a.id })} title={`${a.name}: ${statusLabel(a.status)}`}>
              <span className="ring">
                <Icon name={STATUS_ICON[a.status]} size={12} />
              </span>
              {short(a.name, 22)}
            </button>
          </div>
        ))}
        {catalog.agents.length === 0 && <span className="muted">No agents registered</span>}
      </div>
    </div>
  );
}
