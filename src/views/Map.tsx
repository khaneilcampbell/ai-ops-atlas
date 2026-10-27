import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Status } from "../catalog/types";
import { DetailPanel } from "../components/DetailPanel";
import { Icon, type IconName } from "../components/Icon";
import { StatusPill, statusLabel } from "../components/bits";
import { effectiveLastRun, overallHealth, repoData, repoHealth } from "../lib/derive";
import { load, save } from "../lib/storage";
import { relative } from "../lib/time";
import { useReducedMotion } from "../lib/motion";
import { useAtlas } from "../state";
import {
  FRAMEWORK_COLORS,
  TH,
  frameworkColor,
  iso,
  layoutMap,
  placeLabels,
  textWidth,
  treeSpots,
  type District,
  type GroupBy,
  type LabelBox,
  type Neighborhood,
  type Park,
} from "./mapLayout";

type Pt = { x: number; y: number };
type Cam = { x: number; y: number; k: number };
const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
const up = (p: Pt, h: number) => ({ x: p.x, y: p.y - h });

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

function Box({ gx, gy, w, h, wall, roof, onClick, onEnter, onLeave, selected, hovered, windows }: {
  gx: number; gy: number; w: number; h: number; wall: string; roof: string; selected?: boolean; hovered?: boolean; windows?: boolean;
  onClick?: () => void; onEnter?: (e: React.MouseEvent) => void; onLeave?: () => void;
}) {
  const A = iso(gx, gy + w), B = iso(gx + w, gy + w), C = iso(gx + w, gy), D = iso(gx, gy);
  const rows = windows ? Math.floor(h / 14) : 0;
  const base = iso(gx + w / 2, gy + w / 2);
  return (
    <g onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ cursor: onClick ? "pointer" : undefined }}>
      <ellipse cx={B.x} cy={B.y - 2} rx={w * 30} ry={w * 9} fill="rgba(30,45,30,0.12)" />
      {selected && <ellipse className="sel-ring" cx={base.x} cy={base.y} rx={w * 48 + 10} ry={w * 24 + 5} />}
      <g className={`bldg ${hovered ? "hover" : ""} ${selected ? "selected" : ""}`}>
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
        <polygon
          points={pts([up(D, h), up(C, h), up(B, h), up(A, h)])}
          fill={roof}
          stroke={selected ? "#c9a35a" : hovered ? "#f1f2ea" : "rgba(255,255,255,0.35)"}
          strokeWidth={selected ? 3 : hovered ? 2 : 1}
        />
      </g>
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

const pillWidth = (text: string) => Math.max(48, text.length * 8.2 + 24);

function Label({ x, y, text, tone, onClick, scale = 1 }: { x: number; y: number; text: string; tone: "dark" | "light" | "gold"; onClick?: () => void; scale?: number }) {
  const w = pillWidth(text);
  const fill = tone === "dark" ? "#1d2b22" : tone === "gold" ? "#6e5323" : "#f1f2ea";
  const color = tone === "light" ? "#1d2620" : "#f1f2ea";
  const stroke = tone === "gold" ? "#c9a35a" : tone === "dark" ? "rgba(201,163,90,0.35)" : "rgba(29,43,34,0.15)";
  return (
    <g className="map-label" transform={`translate(${x},${y}) scale(${scale})`} onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <rect x={-w / 2} y={-14} width={w} height={28} rx={9} fill={fill} stroke={stroke} />
      <text textAnchor="middle" y={5} fontSize={15} fill={color} fontFamily="-apple-system, system-ui, sans-serif">
        {text}
      </text>
    </g>
  );
}

const districtLabelWidth = (title: string, sub: string) => Math.max(textWidth(title, 16, true) * 1.1, sub.length * 6.4) + 30;

/** Two-line plaque above a repository building: project name, then repository and agent count. */
function DistrictLabel({ x, y, title, sub, active, onClick, scale }: { x: number; y: number; title: string; sub: string; active: boolean; onClick: () => void; scale: number }) {
  const w = districtLabelWidth(title, sub);
  return (
    <g className="map-label" transform={`translate(${x},${y}) scale(${scale})`} onClick={onClick} style={{ cursor: "pointer" }}>
      <path d={`M-7 21 L0 29 L7 21 Z`} fill="#1d2b22" />
      <rect x={-w / 2} y={-21} width={w} height={42} rx={10} fill="#1d2b22" stroke={active ? "#c9a35a" : "rgba(201,163,90,0.35)"} strokeWidth={active ? 2 : 1} />
      <text textAnchor="middle" y={-2} fontSize={16} fill="#f1f2ea" fontFamily="ui-serif, 'New York', Georgia, serif">
        {title}
      </text>
      <text textAnchor="middle" y={13} fontSize={10.5} fill="#a9b3a5" fontFamily="-apple-system, system-ui, sans-serif" letterSpacing={0.4}>
        {sub}
      </text>
    </g>
  );
}

const STATUS_ICON: Record<Status, IconName> = { active: "play", idle: "circle", paused: "pause", attention: "alert", retired: "close" };
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const repoShort = (name: string) => name.split("/")[1] ?? name;
const GROUP_LABEL: Record<GroupBy, string> = { none: "No grouping", status: "By status", tag: "By tag" };

/** Where things sit in world space, for camera moves, hit lookups and keyboard navigation. */
function anchors(districts: District[], parks: Park[]) {
  const m = new Map<string, Pt & { district?: string }>();
  for (const d of districts) {
    const c = iso(d.hq.gx + d.hq.size / 2, d.hq.gy + d.hq.size / 2);
    m.set(`repo:${d.project.repository}`, { x: c.x, y: c.y - d.hq.height / 2, district: d.project.id });
    for (const l of d.lots) {
      const p = iso(l.gx + l.size / 2, l.gy + l.size / 2);
      m.set(`agent:${l.agent.id}`, { x: p.x, y: p.y - l.height / 2, district: d.project.id });
    }
  }
  for (const p of parks) for (const s of p.strays) m.set(`repo:${s.name}`, iso(s.gx + s.size / 2, s.gy + s.size / 2));
  return m;
}

export function MapView() {
  const { catalog, repos, uncataloged, select, selection, settings, setSettings, setView } = useAtlas();
  const [groupBy, setGroupByState] = useState<GroupBy>(() => load<GroupBy>("mapGroupBy", "none"));
  const layout = useMemo(() => layoutMap(catalog, uncataloged, groupBy), [catalog, uncataloged, groupBy]);
  const where = useMemo(() => anchors(layout.districts, layout.parks), [layout]);
  const reduced = useReducedMotion();

  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 1 });
  const camRef = useRef(cam);
  const fitK = useRef(1);
  /** Once the person pans or zooms, resizes keep their view instead of refitting. */
  const touched = useRef(false);
  const anim = useRef<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string>(catalog.projects[0]?.id ?? "");
  const [announce, setAnnounce] = useState("");
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    camRef.current = cam;
  }, [cam]);

  const stop = () => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  };

  const animateTo = useCallback(
    (to: Cam) => {
      stop();
      const from = camRef.current;
      if (reduced) {
        setCam(to);
        return;
      }
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / 380);
        const e = 1 - Math.pow(1 - p, 3);
        setCam({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e });
        anim.current = p < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [reduced],
  );

  const fitCam = useCallback(
    (w: number, h: number): Cam => {
      const b = layout.bounds;
      // The intro text sits in the empty top-left corner of the diamond, so only a little is reserved.
      const top = 40;
      const bottom = 60;
      const k = Math.min((w - 60) / (b.maxX - b.minX), (h - top - bottom) / (b.maxY - b.minY), 1.4);
      fitK.current = k;
      return { k, x: (w - (b.maxX - b.minX) * k) / 2 - b.minX * k, y: top + (h - top - bottom - (b.maxY - b.minY) * k) / 2 - b.minY * k };
    },
    [layout],
  );

  const fit = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    touched.current = false;
    const r = el.getBoundingClientRect();
    animateTo(fitCam(r.width, r.height));
  }, [animateTo, fitCam]);

  // Fit on first show and whenever the layout changes; afterwards keep the view centered on resize
  // (for example when the inspector opens) unless the person has not moved the camera yet.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let prev = { w: 0, h: 0 };
    touched.current = false;
    const onResize = () => {
      const { width: w, height: h } = el.getBoundingClientRect();
      if (!w || !h) return;
      setSize({ w, h });
      if (!touched.current || !prev.w) {
        stop();
        setCam(fitCam(w, h));
      } else {
        const dx = (w - prev.w) / 2;
        const dy = (h - prev.h) / 2;
        setCam((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      }
      prev = { w, h };
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitCam]);

  useEffect(() => () => stop(), []);

  const kMin = () => Math.min(0.3, fitK.current * 0.8);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = stage.current;
    if (!el) return;
    stop();
    touched.current = true;
    const r = el.getBoundingClientRect();
    const px = cx ?? r.width / 2;
    const py = cy ?? r.height / 2;
    setCam((v) => {
      const k = Math.min(3, Math.max(kMin(), v.k * factor));
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  const panBy = (dx: number, dy: number) => {
    stop();
    touched.current = true;
    setCam((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  /** Bring a world point into the comfortable middle of the stage, zooming in a little if far out. */
  const reveal = useCallback(
    (p: Pt, minK = 0) => {
      const el = stage.current;
      if (!el) return;
      const { width: w, height: h } = el.getBoundingClientRect();
      const v = camRef.current;
      const sx = p.x * v.k + v.x;
      const sy = p.y * v.k + v.y;
      const inside = sx > w * 0.15 && sx < w * 0.85 && sy > h * 0.18 && sy < h * 0.85;
      if (inside && v.k >= minK) return;
      const k = Math.max(v.k, minK);
      touched.current = true;
      animateTo({ k, x: w / 2 - p.x * k, y: h / 2 - p.y * k });
    },
    [animateTo],
  );

  // Wheel zoom has to be a non-passive listener so it can stop the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      else {
        touched.current = true;
        setCam((v) => ({ ...v, x: v.x - e.deltaX }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Follow selections made elsewhere (search, inspector links) so the building stays in view.
  const selKey = selection ? `${selection.kind}:${selection.id}` : null;
  useEffect(() => {
    if (!selKey) return;
    const p = where.get(selKey);
    if (!p) return;
    if (p.district) setFocus(p.district);
    // Wait a frame so the docked inspector has taken its width before measuring.
    const id = requestAnimationFrame(() => reveal(p, 0.55));
    return () => cancelAnimationFrame(id);
  }, [selKey, where, reveal]);

  const showTip = (e: React.MouseEvent, title: string, sub: string) => {
    const r = stage.current!.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, title, sub });
  };
  const enter = (key: string, title: string, sub: string) => (e: React.MouseEvent) => {
    setHover(key);
    showTip(e, title, sub);
  };
  const leave = () => {
    setHover(null);
    setTip(null);
  };

  const k = cam.k;
  // Agent labels need room: show them once zoomed in far enough, earlier if "always show" is on.
  const agentsShown = k >= (settings.showMapLabels ? 0.5 : 0.9);
  // Repository and district names grow as you zoom out so they stay readable.
  const nameScale = Math.min(2, Math.max(1, 0.85 / k));
  // Level of detail: windows, trees and footpaths only once there is room to see them.
  const detail = k >= 0.5 || layout.districts.length < 30;
  const focused = layout.districts.find((d) => d.project.id === focus) ?? layout.districts[0];
  const isSelected = (kind: "agent" | "repo", id: string) => selection?.kind === kind && selection.id === id;
  const selectedDistrict = selKey ? where.get(selKey)?.district : undefined;

  // Visible world rectangle, padded so tall buildings and labels do not pop at the edges.
  const vis = useMemo(() => {
    const m = 220 / k;
    return { x0: -cam.x / k - m, y0: -cam.y / k - m, x1: (size.w - cam.x) / k + m, y1: (size.h - cam.y) / k + m };
  }, [cam.x, cam.y, k, size.w, size.h]);
  const rectVisible = (ox: number, oy: number, w: number, h: number) =>
    iso(ox, oy + h).x <= vis.x1 && iso(ox + w, oy).x >= vis.x0 && iso(ox, oy).y - 140 <= vis.y1 && iso(ox + w, oy + h).y >= vis.y0;
  const ptVisible = (p: Pt) => p.x >= vis.x0 && p.x <= vis.x1 && p.y >= vis.y0 && p.y <= vis.y1;

  const lots = useMemo(() => layout.districts.flatMap((d) => d.lots.map((l) => ({ ...l, d }))), [layout]);
  const strays = useMemo(() => layout.parks.flatMap((p) => p.strays), [layout]);
  const drawables = useMemo(
    () =>
      [
        ...lots.map((l) => ({ depth: l.gx + l.gy + l.size * 2, kind: "lot" as const, l })),
        ...layout.districts.map((d) => ({ depth: d.hq.gx + d.hq.gy + d.hq.size * 2, kind: "hq" as const, d })),
        ...strays.map((s) => ({ depth: s.gx + s.gy + s.size * 2, kind: "stray" as const, s })),
      ].sort((a, b) => a.depth - b.depth),
    [lots, layout, strays],
  );

  // Label geometry in world units, then greedy placement so nothing overlaps as repositories are added.
  const labels = useMemo(() => {
    const out: (LabelBox & { draw: () => React.ReactNode })[] = [];
    const urgent = (key: string, district?: string) =>
      key === selKey || key === hover ? 0 : district && (district === selectedDistrict || district === focus) ? 2 : null;
    for (const d of layout.districts) {
      const c = iso(d.hq.gx + d.hq.size / 2, d.hq.gy + d.hq.size / 2);
      const key = `repo:${d.project.repository}`;
      const title = short(d.project.name, 34);
      const sub = `${repoShort(d.project.repository)} · ${d.lots.length} ${d.lots.length === 1 ? "agent" : "agents"}`;
      const y = c.y - d.hq.height - TH * d.hq.size * 0.5 - 26 * nameScale;
      const u = urgent(key, d.project.id);
      out.push({
        id: `hq:${d.project.id}`,
        x: c.x,
        top: y - 22 * nameScale,
        bottom: y + 22 * nameScale,
        w: districtLabelWidth(title, sub) * nameScale,
        priority: u ?? 3 + (1 - Math.min(d.size, 15) / 15) * 0.5,
        draw: () => (
          <DistrictLabel
            key={`n:${d.project.id}`}
            x={c.x}
            y={y}
            scale={nameScale}
            title={title}
            sub={sub}
            active={key === selKey || key === hover || d.project.id === selectedDistrict}
            onClick={() => select({ kind: "repo", id: d.project.repository })}
          />
        ),
      });
    }
    // A big lot of uncataloged repositories only gets names once you zoom toward it.
    const straysShown = strays.length <= 12 || k >= 0.4;
    for (const s of strays) {
      const key = `repo:${s.name}`;
      if (!straysShown && key !== selKey && key !== hover) continue;
      const c = iso(s.gx + s.size / 2, s.gy + s.size / 2);
      const text = short(repoShort(s.name));
      const y = c.y - s.height - TH * s.size * 0.5 - 14 * nameScale;
      out.push({
        id: `stray:${s.name}`,
        x: c.x,
        top: y - 14 * nameScale,
        bottom: y + 14 * nameScale,
        w: pillWidth(text) * nameScale,
        priority: urgent(key) ?? 5,
        draw: () => <Label key={`sl:${s.name}`} x={c.x} y={y} scale={nameScale} text={text} tone="light" onClick={() => select({ kind: "repo", id: s.name })} />,
      });
    }
    for (const l of lots) {
      const a = l.agent;
      const key = `agent:${a.id}`;
      const u = urgent(key, l.d.project.id);
      if (!agentsShown && u !== 0) continue;
      const c = iso(l.gx + l.size / 2, l.gy + l.size / 2);
      const text = a.status === "attention" ? `${short(a.name, 18)} · needs attention` : short(a.name);
      const y = c.y - l.height - TH * l.size * 0.5 - 14;
      out.push({
        id: key,
        x: c.x,
        top: y - 14,
        bottom: y + 14,
        w: pillWidth(text),
        priority: u === 0 ? 0.5 : u === 2 ? 2.5 : 6,
        draw: () => <Label key={`l:${a.id}`} x={c.x} y={y} text={text} tone={a.status === "attention" ? "gold" : "light"} onClick={() => select({ kind: "agent", id: a.id })} />,
      });
    }
    const shown = placeLabels(out);
    // Draw back to front so the most important labels end up on top.
    return out.filter((b) => shown.has(b.id)).sort((a, b) => b.priority - a.priority);
  }, [layout, lots, strays, k, nameScale, agentsShown, selKey, hover, selectedDistrict, focus, select]);

  const usedFrameworks = FRAMEWORK_COLORS.filter(([re]) => catalog.agents.some((a) => re.test(a.framework)));

  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    save("mapGroupBy", g);
  };

  /** Arrow keys move between districts in the direction pressed, measured on screen. */
  const moveFocus = (dx: number, dy: number) => {
    const cur = layout.districts.find((d) => d.project.id === focus) ?? layout.districts[0];
    if (!cur) return;
    const center = (d: District) => iso(d.ox + d.size / 2, d.oy + d.size / 2);
    const from = center(cur);
    let best: { d: District; score: number } | null = null;
    for (const d of layout.districts) {
      if (d === cur) continue;
      const p = center(d);
      const vx = p.x - from.x;
      const vy = (p.y - from.y) * 2; // undo the isometric squash so up/down feel as far as left/right
      const along = vx * dx + vy * dy;
      if (along <= 0) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2;
      if (!best || score < best.score) best = { d, score };
    }
    if (!best) return;
    const d = best.d;
    setFocus(d.project.id);
    setAnnounce(`${d.project.name}. ${d.lots.length} agents. Press Enter to inspect.`);
    reveal(center(d));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      if (e.shiftKey) panBy(-dir[0] * 120, -dir[1] * 120);
      else moveFocus(dir[0], dir[1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focused) select({ kind: "repo", id: focused.project.repository });
    } else if (e.key === "+" || e.key === "=") zoomAt(1.25);
    else if (e.key === "-" || e.key === "_") zoomAt(0.8);
    else if (e.key === "0") fit();
  };

  return (
    <div className={`map-wrap ${selection ? "inspecting" : ""}`}>
      <div className="map-col">
        <div
          ref={stage}
          className={`map-stage ${dragging ? "dragging" : ""}`}
          tabIndex={0}
          role="application"
          aria-roledescription="map"
          aria-label="Workspace map. Arrow keys move between projects, Enter inspects, plus and minus zoom, 0 fits, Shift and arrows pan."
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            stop();
            drag.current = { x: e.clientX, y: e.clientY, vx: cam.x, vy: cam.y, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 4) return;
            if (!d.moved) {
              d.moved = true;
              touched.current = true;
              setDragging(true);
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }
            setTip(null);
            setCam((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
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
          <svg aria-hidden="true">
            <g transform={`translate(${cam.x},${cam.y}) scale(${k})`}>
              {groupBy !== "none" && layout.neighborhoods.filter((n) => n.key !== "uncataloged").map((n) => <NeighborhoodPlate key={n.key} n={n} />)}
              {layout.parks.map((p, i) =>
                rectVisible(p.ox, p.oy, p.w, p.h) ? <ParkTile key={i} p={p} textScale={nameScale} trees={detail} /> : null,
              )}
              {layout.districts.map((d) =>
                rectVisible(d.ox, d.oy, d.size, d.size) ? (
                  <Ground
                    key={d.project.id}
                    d={d}
                    focused={d === focused}
                    hovered={!!hover && where.get(hover)?.district === d.project.id}
                    detail={detail}
                    onFocus={() => setFocus(d.project.id)}
                  />
                ) : null,
              )}
              {detail &&
                layout.districts
                  .filter((d) => rectVisible(d.ox, d.oy, d.size, d.size))
                  .flatMap((d) => treeSpots(d.project.id, d.ox, d.oy, d.size, Math.round(d.size * 1.8)).map((t, i) => <Tree key={`${d.project.id}:${i}`} {...t} />))}
              {drawables.map((it) => {
                if (it.kind === "stray") {
                  const s = it.s;
                  if (!ptVisible(iso(s.gx, s.gy))) return null;
                  const snap = repoData(repos[s.name]);
                  const key = `repo:${s.name}`;
                  return (
                    <Box
                      key={`stray:${s.name}`}
                      gx={s.gx}
                      gy={s.gy}
                      w={s.size}
                      h={s.height}
                      wall="#e4e1d4"
                      roof="#7f8a7c"
                      windows={detail}
                      selected={isSelected("repo", s.name)}
                      hovered={hover === key}
                      onClick={() => select({ kind: "repo", id: s.name })}
                      onEnter={enter(key, s.name, snap?.pushedAt ? `Not in the catalog yet · pushed ${relative(snap.pushedAt)}` : "Not in the catalog yet")}
                      onLeave={leave}
                    />
                  );
                }
                if (it.kind === "hq") {
                  const d = it.d;
                  if (!rectVisible(d.ox, d.oy, d.size, d.size)) return null;
                  const snap = repoData(repos[d.project.repository]);
                  const key = `repo:${d.project.repository}`;
                  return (
                    <Box
                      key={`hq:${d.project.id}`}
                      gx={d.hq.gx}
                      gy={d.hq.gy}
                      w={d.hq.size}
                      h={d.hq.height}
                      wall="#ece5d2"
                      roof="#2f4535"
                      windows={detail}
                      selected={isSelected("repo", d.project.repository)}
                      hovered={hover === key}
                      onClick={() => {
                        setFocus(d.project.id);
                        select({ kind: "repo", id: d.project.repository });
                      }}
                      onEnter={enter(key, d.project.repository, snap?.commits[0] ? `Latest commit ${relative(snap.commits[0].date)}: ${short(snap.commits[0].message, 40)}` : "Repository")}
                      onLeave={leave}
                    />
                  );
                }
                const { l } = it;
                if (!rectVisible(l.d.ox, l.d.oy, l.d.size, l.d.size)) return null;
                const a = l.agent;
                const key = `agent:${a.id}`;
                return (
                  <Box
                    key={a.id}
                    gx={l.gx}
                    gy={l.gy}
                    w={l.size}
                    h={l.height}
                    wall={a.status === "retired" ? "#d4d6cc" : "#f2ecdc"}
                    roof={a.status === "attention" ? "#c9a35a" : frameworkColor(a.framework)}
                    selected={isSelected("agent", a.id)}
                    hovered={hover === key}
                    onClick={() => {
                      setFocus(a.projectId);
                      select({ kind: "agent", id: a.id });
                    }}
                    onEnter={enter(key, a.name, `${a.framework} · ${statusLabel(a.status)} · last run ${relative(effectiveLastRun(a, repoData(repos[a.repository]))).toLowerCase()}`)}
                    onLeave={leave}
                  />
                );
              })}
              {detail && layout.districts.filter((d) => rectVisible(d.ox, d.oy, d.size, d.size)).map((d) => <Connections key={`c:${d.project.id}`} d={d} />)}
              {labels.filter((b) => ptVisible({ x: b.x, y: b.top })).map((b) => b.draw())}
              {groupBy !== "none" && layout.neighborhoods.filter((n) => n.key !== "uncataloged").map((n) => <NeighborhoodLabel key={`nl:${n.key}`} n={n} scale={nameScale} />)}
            </g>
          </svg>

          <div className={`map-intro ${selection || k > fitK.current * 1.15 ? "faded" : ""}`}>
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
            <label className="map-group" title="Group projects into neighborhoods">
              <span className="sr-only">Group projects</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
            <span className="sep" />
            <button className="icon-btn" onClick={fit} aria-label="Fit map" title="Fit map (0)">
              <Icon name="focus" size={17} />
            </button>
            <button className={`icon-btn ${settings.showMapLabels ? "on" : ""}`} onClick={() => setSettings({ showMapLabels: !settings.showMapLabels })} aria-label="Toggle agent labels" aria-pressed={settings.showMapLabels} title="Agent labels">
              <Icon name="labels" size={17} />
            </button>
            <button className="icon-btn" onClick={() => zoomAt(1.25)} aria-label="Zoom in" title="Zoom in (+)">
              <Icon name="plus" size={17} />
            </button>
            <button className="icon-btn" onClick={() => zoomAt(0.8)} aria-label="Zoom out" title="Zoom out (−)">
              <Icon name="minus" size={17} />
            </button>
          </div>

          <div className="sr-only" aria-live="polite">
            {announce}
          </div>
        </div>

        {/* The drawing is decorative for assistive tech; this list carries the same content. */}
        <ul className="sr-only" aria-label="Projects on the map">
          {layout.districts.map((d) => (
            <li key={d.project.id}>
              <button tabIndex={-1} onClick={() => select({ kind: "repo", id: d.project.repository })}>
                {d.project.name}, {d.lots.length} agents
              </button>
            </li>
          ))}
        </ul>

        {focused && <ProjectBar d={focused} onOpenList={() => setView("agents")} />}
      </div>

      {selection && <DetailPanel docked />}
    </div>
  );
}

function Ground({ d, focused, hovered, detail, onFocus }: { d: District; focused: boolean; hovered: boolean; detail: boolean; onFocus: () => void }) {
  const m = 0.55;
  const road = [iso(d.ox - m, d.oy - m), iso(d.ox + d.size + m, d.oy - m), iso(d.ox + d.size + m, d.oy + d.size + m), iso(d.ox - m, d.oy + d.size + m)];
  const ground = [iso(d.ox, d.oy), iso(d.ox + d.size, d.oy), iso(d.ox + d.size, d.oy + d.size), iso(d.ox, d.oy + d.size)];
  const depth = 10;
  return (
    <g onClick={onFocus} className="ground">
      <polygon points={pts([road[3], road[2], up(road[2], -depth), up(road[3], -depth)])} fill="#8e9586" />
      <polygon points={pts([road[2], road[1], up(road[1], -depth), up(road[2], -depth)])} fill="#7c8475" />
      <polygon points={pts(road)} fill={hovered ? "#b8bcaf" : "#aeb2a6"} stroke={focused ? "#c9a35a" : hovered ? "rgba(201,163,90,0.55)" : "none"} strokeWidth={focused || hovered ? 3 : 0} />
      {detail && <polygon points={pts(road)} fill="none" stroke="#e8e6da" strokeWidth={1.5} strokeDasharray="10 10" opacity={0.7} />}
      <polygon points={pts(ground)} fill={hovered ? "#dde1b6" : "#d8dcae"} />
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

function ParkTile({ p, textScale, trees }: { p: Park; textScale: number; trees: boolean }) {
  const { ox, oy, w, h } = p;
  const hasStrays = p.strays.length > 0;
  const ground = [iso(ox, oy), iso(ox + w, oy), iso(ox + w, oy + h), iso(ox, oy + h)];
  const pond = [iso(ox + w * 0.35, oy + h * 0.3), iso(ox + w * 0.75, oy + h * 0.3), iso(ox + w * 0.75, oy + h * 0.7), iso(ox + w * 0.35, oy + h * 0.7)];
  const front = iso(ox + w, oy + h);
  return (
    <g pointerEvents="none">
      <polygon points={pts(ground)} fill="#cdd3a3" opacity={0.85} />
      {!hasStrays && <polygon points={pts(pond)} fill="#8fb3a8" stroke="#a9c7bc" strokeWidth={3} />}
      {trees && treeSpots(`park:${ox}:${oy}`, ox, oy, w, Math.min(40, Math.round((w + h) * 0.9)), h).map((t, i) => <Tree key={i} {...t} />)}
      <text
        x={front.x}
        y={front.y + (hasStrays ? 44 + 28 * textScale : -40)}
        textAnchor="middle"
        fontFamily="ui-serif, 'New York', Georgia, serif"
        fontSize={(hasStrays ? 26 : 20) * textScale}
        fill={hasStrays ? "#1d2b22" : "#47524a"}
        opacity={hasStrays ? 1 : 0.8}
      >
        {hasStrays ? `Not in the catalog yet (${p.strays.length})` : "Room for the next project"}
      </text>
    </g>
  );
}

function NeighborhoodPlate({ n }: { n: Neighborhood }) {
  const m = 2;
  const c = [iso(n.ox - m, n.oy - m), iso(n.ox + n.w + m, n.oy - m), iso(n.ox + n.w + m, n.oy + n.h + m), iso(n.ox - m, n.oy + n.h + m)];
  return <polygon points={pts(c)} fill="rgba(241,242,234,0.18)" stroke="rgba(29,43,34,0.22)" strokeWidth={2} strokeDasharray="14 10" pointerEvents="none" />;
}

function NeighborhoodLabel({ n, scale }: { n: Neighborhood; scale: number }) {
  const p = iso(n.ox - 2, n.oy - 2);
  return (
    <text x={p.x} y={p.y - 24 * scale} textAnchor="middle" fontSize={15 * scale} letterSpacing={3 * scale} fill="#47524a" pointerEvents="none" fontFamily="-apple-system, system-ui, sans-serif">
      {`${n.label.toUpperCase()} · ${n.count}`}
    </text>
  );
}

function ProjectBar({ d, onOpenList }: { d: District; onOpenList: () => void }) {
  const { repos, select, setFilters, clearFilters } = useAtlas();
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
          <Icon name="repos" size={15} /> Inspect
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
        {agents.length === 0 && <span className="muted">No agents registered for this project</span>}
      </div>
    </div>
  );
}
