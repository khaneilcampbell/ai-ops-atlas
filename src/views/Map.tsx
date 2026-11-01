import {districtHeadings} from "./mapPresentation";
import { toolWorkflowRoads } from "./toolWorkflowLayout";
import { toolBrand } from "./map3d/toolBrand";
import { SYMBOLS } from "./map3d/symbols";
import { projectRepositories } from "../catalog/projects";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAiAgent, residentsLabel } from "../catalog/roles";
import { CONNECTION_TYPES, type Agent, type ConnectionType, type Status } from "../catalog/types";
import { ConnectionPanel } from "../components/ConnectionPanel";
import { DetailPanel } from "../components/DetailPanel";
import { Icon, type IconName } from "../components/Icon";
import { StatusPill, statusLabel } from "../components/bits";
import { MapSelect } from "../components/MapSelect";
import type { LightMode } from "./map3d/living";
import { buildConnections, CONNECTION_LABEL, CONNECTION_STATUS_LABEL, endpointKey, LINK_COLORS, projectOfEndpoint } from "../lib/connections";
import { effectiveLastRun, overallHealth, repoData, repoHealth, verifiedState } from "../lib/derive";
import { LENS_INFO, lensLinks, MAP_LENSES, type MapLens } from "../lib/lenses";
import { load, save } from "../lib/storage";
import { loadInside, saveInside } from "./map3d/inside";
import { relative } from "../lib/time";
import { useReducedMotion } from "../lib/motion";
import { PHONE_QUERY, useMedia } from "../lib/media";
import { useAtlas } from "../state";
import {
  hash,
  TH,
  iso,
  layoutMap,
  placeLabels,
  treeSpots,
  TW,
  type District,
  type GroupBy,
  type LabelBox,
  type Neighborhood,
  type Meadow,
  type Park,
  type Walk,
} from "./mapLayout";
import { measure, SANS, SERIF, wrap } from "./mapText";
import type { Map3DApi, MapLink } from "./map3d/Map3D";
import { webglAvailable } from "./map3d/webgl";
import { leaveBuilding, useOffice } from "./office/store";

// three.js only loads when the 3D map is shown.
const Map3D = lazy(() => import("./map3d/Map3D"));
// The virtual office loads only when a building is entered.
import { AGENCY_OFFICE_ID } from "./office/agencyInteriorPlan";
const SkylineInterior = lazy(() => import("./office/SkylineInterior"));
const AgencyInterior = lazy(() => import("./office/AgencyInterior"));
const OfficeLayer = lazy(() => import("./office/OfficeLayer"));
const MallInterior = lazy(() => import("./office/MallInterior"));

type Pt = { x: number; y: number };
type Cam = { x: number; y: number; k: number };
const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(" ");
const up = (p: Pt, h: number) => ({ x: p.x, y: p.y - h });

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

type Kind = "house" | "tower" | "plain";

/** A point on a wall face: u runs along the bottom edge from a to b, v is height above the ground. */
const onFace = (a: Pt, b: Pt, u: number, v: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v });
const quad = (a: Pt, b: Pt, u0: number, u1: number, v0: number, v1: number) => pts([onFace(a, b, u0, v0), onFace(a, b, u1, v0), onFace(a, b, u1, v1), onFace(a, b, u0, v1)]);

function Box({ id, gx, gy, w, h, wall, roof, kind = "plain", onClick, onEnter, onLeave, selected, hovered, windows, worker }: {
  id: string; gx: number; gy: number; w: number; h: number; wall: string; roof: string; worker?: "agent" | "automation"; kind?: Kind; selected?: boolean; hovered?: boolean; windows?: boolean;
  onClick?: () => void; onEnter?: (e: React.MouseEvent) => void; onLeave?: () => void;
}) {
  const A = iso(gx, gy + w), B = iso(gx + w, gy + w), C = iso(gx + w, gy), D = iso(gx, gy);
  const base = iso(gx + w / 2, gy + w / 2);
  const front = shade(wall, 0.97);
  const side = shade(wall, 0.8);
  const edge = selected ? "#c9a35a" : hovered ? "#fffbe9" : "rgba(255,255,255,0.45)";
  const edgeW = selected ? 3 : hovered ? 2 : 1;
  const faceLen = Math.hypot(B.x - A.x, B.y - A.y);

  // Lit and unlit windows, decided per building so they do not flicker between renders.
  const lit = (i: number) => hash(`${id}:${i}`) > 0.55;
  // Towers keep their ground floor for the entrance.
  const firstRow = kind === "tower" ? 26 : 10;
  const windowRows = (a: Pt, b: Pt, face: string) => {
    if (!windows) return null;
    const rows = Math.max(1, Math.floor((h - firstRow - 4) / 13));
    const cols = Math.max(1, Math.floor(faceLen / 18));
    const out: React.ReactNode[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const u0 = (c + 0.25) / cols;
        const u1 = (c + 0.75) / cols;
        const v0 = firstRow + r * 13;
        out.push(<polygon key={`${face}${r}:${c}`} points={quad(a, b, u0, u1, v0, v0 + 7)} fill={lit(r * 31 + c + (face === "s" ? 500 : 0)) ? "#f6dc8f" : "rgba(52,74,62,0.55)"} />);
      }
    return out;
  };
  // Darker band where the walls meet the ground, so buildings sit on the grass instead of floating.
  const footing = (
    <>
      <polygon points={quad(A, B, 0, 1, 0, 4)} fill="rgba(40,52,32,0.16)" />
      <polygon points={quad(B, C, 0, 1, 0, 4)} fill="rgba(40,52,32,0.24)" />
    </>
  );

  let body: React.ReactNode;
  if (kind === "house") {
    // Gable or hip roof, chosen per agent so a street of houses is not a row of copies.
    const rh = Math.max(10, w * 13);
    const o = 0.1;
    const hip = hash(`${id}:roof`) > 0.5;
    const tA = up(iso(gx - o, gy + w + o), h), tB = up(iso(gx + w + o, gy + w + o), h), tC = up(iso(gx + w + o, gy - o), h), tD = up(iso(gx - o, gy - o), h);
    const ri = hip ? w * 0.3 : -o;
    const m1 = up(iso(gx + ri, gy + w / 2), h + rh), m2 = up(iso(gx + w - ri, gy + w / 2), h + rh);
    const g1 = up(B, h), g2 = up(C, h), gm = up(iso(gx + w, gy + w / 2), h + rh);
    // A chimney on the front slope of gabled houses.
    const cs = w * 0.13, cx = gx + w * 0.22, cy = gy + w * 0.62;
    const cv0 = h + rh * 0.45, cv1 = h + rh + 4;
    const ch = [iso(cx, cy + cs), iso(cx + cs, cy + cs), iso(cx + cs, cy)];
    body = (
      <>
        <polygon points={pts([A, B, up(B, h), up(A, h)])} fill={front} />
        <polygon points={pts([B, C, up(C, h), up(B, h)])} fill={side} />
        {footing}
        {!hip && <polygon points={pts([g1, g2, gm])} fill={side} />}
        <polygon points={quad(A, B, 0.42, 0.6, 0, Math.min(h - 4, 14))} fill="#5d4a36" />
        <polygon points={quad(A, B, 0.38, 0.64, Math.min(h - 4, 14), Math.min(h - 4, 14) + 2.5)} fill={shade(roof, 0.85)} />
        {windows && (
          <g stroke="#fffaf0" strokeWidth={0.8}>
            <polygon points={quad(A, B, 0.12, 0.3, h * 0.45, h * 0.45 + 8)} fill={lit(1) ? "#f6dc8f" : "#7d9488"} />
            <polygon points={quad(A, B, 0.72, 0.9, h * 0.45, h * 0.45 + 8)} fill={lit(2) ? "#f6dc8f" : "#7d9488"} />
            <polygon points={quad(B, C, 0.35, 0.65, h * 0.45, h * 0.45 + 8)} fill={lit(3) ? "#f6dc8f" : "#7d9488"} />
          </g>
        )}
        <polygon points={pts([tD, tC, m2, m1])} fill={shade(roof, 0.78)} />
        {hip && <polygon points={pts([tB, tC, m2])} fill={shade(roof, 0.68)} />}
        <polygon points={pts([tA, tB, m2, m1])} fill={roof} stroke={edge} strokeWidth={edgeW} strokeLinejoin="round" />
        <line x1={tA.x} y1={tA.y} x2={tB.x} y2={tB.y} stroke={shade(roof, 0.6)} strokeWidth={2} strokeLinecap="round" />
        <line x1={m1.x} y1={m1.y} x2={m2.x} y2={m2.y} stroke={shade(roof, 1.25)} strokeWidth={1.5} />
        {!hip && (
          <>
            <polygon points={pts([up(ch[0], cv0), up(ch[1], cv0), up(ch[1], cv1), up(ch[0], cv1)])} fill="#b9a487" />
            <polygon points={pts([up(ch[1], cv0), up(ch[2], cv0), up(ch[2], cv1), up(ch[1], cv1)])} fill="#9a856a" />
            <polygon points={pts([up(ch[0], cv1), up(ch[1], cv1), up(ch[2], cv1), up(iso(cx, cy), cv1)])} fill="#6b5a48" />
          </>
        )}
      </>
    );
  } else {
    const top = [up(D, h), up(C, h), up(B, h), up(A, h)];
    const inset = (p: Pt, f: number) => ({ x: base.x + (p.x - base.x) * f, y: base.y - h + (p.y - (base.y - h)) * f });
    const mast = up(inset(top[0], 0.5), 9);
    body = (
      <>
        <polygon points={pts([A, B, up(B, h), up(A, h)])} fill={front} />
        <polygon points={pts([B, C, up(C, h), up(B, h)])} fill={side} />
        {kind === "tower" && <polygon points={quad(A, B, 0, 1, 0, 6)} fill={shade(wall, 0.85)} />}
        {kind === "tower" && <polygon points={quad(B, C, 0, 1, 0, 6)} fill={shade(wall, 0.7)} />}
        {footing}
        {windowRows(A, B, "f")}
        {windowRows(B, C, "s")}
        {kind === "tower" && (
          <>
            {/* Lit glass entrance under a small canopy. */}
            <polygon points={quad(A, B, 0.37, 0.63, 0, 17)} fill="#2f4535" />
            <polygon points={quad(A, B, 0.41, 0.59, 0, 14)} fill="#f3dc95" opacity={0.9} />
            <polygon points={quad(A, B, 0.32, 0.68, 17, 20)} fill={shade(roof, 1.15)} />
            <line x1={B.x} y1={B.y - 6} x2={B.x} y2={B.y - h} stroke="rgba(255,255,255,0.55)" strokeWidth={1.2} />
          </>
        )}
        <polygon points={pts(top)} fill={roof} stroke={edge} strokeWidth={edgeW} />
        {kind === "tower" && (
          <>
            <polygon points={pts(top.map((p) => inset(p, 0.78)))} fill={shade(roof, 0.82)} />
            <polygon points={pts(top.map((p) => up(inset(p, 0.3), 9)))} fill={shade(roof, 1.2)} />
            <polygon points={pts([up(inset(top[3], 0.3), 0), up(inset(top[2], 0.3), 0), up(inset(top[2], 0.3), 9), up(inset(top[3], 0.3), 9)])} fill={shade(wall, 0.9)} />
            <polygon points={pts([up(inset(top[2], 0.3), 0), up(inset(top[1], 0.3), 0), up(inset(top[1], 0.3), 9), up(inset(top[2], 0.3), 9)])} fill={shade(wall, 0.75)} />
            {hash(`${id}:mast`) > 0.4 && (
              <>
                <line x1={mast.x} y1={mast.y} x2={mast.x} y2={mast.y - 16} stroke="#46584b" strokeWidth={1.5} />
                <circle cx={mast.x} cy={mast.y - 16} r={2} fill="#e2c27a" />
              </>
            )}
          </>
        )}
      </>
    );
  }

  return (
    <g onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ cursor: onClick ? "pointer" : undefined }}>
      <polygon points={pts([B, C, { x: C.x + w * 22, y: C.y + w * 4 }, { x: B.x + w * 22, y: B.y + w * 4 }])} fill="rgba(36,58,30,0.16)" />
      {(selected || hovered) && <ellipse className={selected ? "sel-glow" : "hover-glow"} cx={base.x} cy={base.y} rx={w * 62 + 18} ry={w * 31 + 9} />}
      {selected && <ellipse className="sel-ring" cx={base.x} cy={base.y} rx={w * 48 + 10} ry={w * 24 + 5} />}
      <g className={`bldg ${hovered ? "hover" : ""} ${selected ? "selected" : ""}`}>{body}</g>
      {worker && <g transform={`translate(${base.x - 9},${base.y - h - 21})`} pointerEvents="none"><rect width={18} height={18} rx={worker === "agent" ? 4 : 9} fill="#263c32" stroke="#c7d0bd"/><g transform="translate(2,2) scale(.58)" fill="none" stroke="#eff0df" strokeWidth={1.7}>{SYMBOLS[worker].stroke.map(d => <path key={d} d={d}/>)}</g></g>}
    </g>
  );
}

/** Round, conifer or (rarely) blossom tree, picked from its position so the choice is stable. */
function Tree({ gx, gy, r: r0 }: { gx: number; gy: number; r: number }) {
  const p = iso(gx, gy);
  const r = r0 * 1.35;
  const t = 6 + r * 0.5;
  const pick = hash(`${gx.toFixed(2)}:${gy.toFixed(2)}`);
  if (pick < 0.24) {
    const hh = r * 2.6;
    return (
      <g>
        <ellipse cx={p.x + r * 0.5} cy={p.y} rx={r * 0.9} ry={r * 0.36} fill="rgba(30,52,26,0.2)" />
        <rect x={p.x - 1.5} y={p.y - 6} width={3} height={6} fill="#6b523a" />
        <polygon points={pts([{ x: p.x - r * 0.95, y: p.y - 5 }, { x: p.x + r * 0.95, y: p.y - 5 }, { x: p.x, y: p.y - 5 - hh * 0.62 }])} fill="#3f6b3f" />
        <polygon points={pts([{ x: p.x - r * 0.75, y: p.y - 5 - hh * 0.32 }, { x: p.x + r * 0.75, y: p.y - 5 - hh * 0.32 }, { x: p.x, y: p.y - 5 - hh }])} fill="#55834c" />
        <polygon points={pts([{ x: p.x, y: p.y - 5 - hh }, { x: p.x + r * 0.75, y: p.y - 5 - hh * 0.32 }, { x: p.x, y: p.y - 5 - hh * 0.32 }])} fill="rgba(20,40,20,0.18)" />
      </g>
    );
  }
  const blossom = pick > 0.95;
  return (
    <g>
      <ellipse cx={p.x + r * 0.5} cy={p.y} rx={r * 1.05} ry={r * 0.42} fill="rgba(30,52,26,0.2)" />
      <rect x={p.x - 1.8} y={p.y - t} width={3.6} height={t} rx={1} fill="#7a5f42" />
      <circle cx={p.x} cy={p.y - t - r * 0.6} r={r} fill={blossom ? "#c99aa4" : "url(#tree-dark)"} />
      <circle cx={p.x - r * 0.42} cy={p.y - t - r * 0.95} r={r * 0.62} fill={blossom ? "#e0b7bf" : "url(#tree-mid)"} />
      <circle cx={p.x + r * 0.32} cy={p.y - t - r * 1.2} r={r * 0.55} fill={blossom ? "#efd3d7" : "url(#tree-light)"} />
    </g>
  );
}

function Bush({ gx, gy, r }: { gx: number; gy: number; r: number }) {
  const p = iso(gx, gy);
  // Every third bush flowers in cream and gold.
  const flowers = hash(`${gx.toFixed(2)}:${gy.toFixed(2)}:f`) > 0.66;
  return (
    <g>
      <ellipse cx={p.x} cy={p.y - r * 0.4} rx={r * 1.3} ry={r * 0.8} fill="#5f8b44" />
      <ellipse cx={p.x - r * 0.3} cy={p.y - r * 0.7} rx={r * 0.7} ry={r * 0.5} fill="#86b25f" />
      {flowers && (
        <>
          <circle cx={p.x - r * 0.6} cy={p.y - r * 0.6} r={1.6} fill="#f6efd8" />
          <circle cx={p.x + r * 0.2} cy={p.y - r * 0.9} r={1.6} fill="#e9c97a" />
          <circle cx={p.x + r * 0.7} cy={p.y - r * 0.4} r={1.6} fill="#f6efd8" />
        </>
      )}
    </g>
  );
}

/** Gradients and the glow filter shared by every district. */
function MapDefs() {
  return (
    <defs>
      <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#b9d38c" />
        <stop offset="1" stopColor="#97bd6b" />
      </linearGradient>
      <linearGradient id="grass-hot" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#c8dd97" />
        <stop offset="1" stopColor="#a4c776" />
      </linearGradient>
      <linearGradient id="soil-l" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#7aa356" />
        <stop offset="0.22" stopColor="#7aa356" />
        <stop offset="0.24" stopColor="#8f7151" />
        <stop offset="1" stopColor="#6e563d" />
      </linearGradient>
      <linearGradient id="soil-r" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#668e45" />
        <stop offset="0.22" stopColor="#668e45" />
        <stop offset="0.24" stopColor="#755b41" />
        <stop offset="1" stopColor="#5a4632" />
      </linearGradient>
      <radialGradient id="tree-dark" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#6e9d4a" />
        <stop offset="1" stopColor="#3f6b33" />
      </radialGradient>
      <radialGradient id="tree-mid" cx="0.4" cy="0.35" r="0.75">
        <stop offset="0" stopColor="#8fbb5e" />
        <stop offset="1" stopColor="#5a8a40" />
      </radialGradient>
      <radialGradient id="tree-light" cx="0.4" cy="0.3" r="0.75">
        <stop offset="0" stopColor="#b5d77a" />
        <stop offset="1" stopColor="#77a64f" />
      </radialGradient>
      <radialGradient id="aura" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#fbe7a6" stopOpacity="0.95" />
        <stop offset="0.55" stopColor="#efd48a" stopOpacity="0.4" />
        <stop offset="1" stopColor="#e9cf86" stopOpacity="0" />
      </radialGradient>
      <pattern id="grass-tex" width="26" height="13" patternUnits="userSpaceOnUse">
        <path d="M4 9 l1 -3 M6.5 9 l-0.8 -2.6 M17 3.5 l1 -3 M19.5 3.5 l-0.8 -2.4" stroke="rgba(62,100,44,0.28)" strokeWidth="1" strokeLinecap="round" />
        <circle cx="11" cy="11" r="0.9" fill="rgba(255,255,235,0.35)" />
      </pattern>
    </defs>
  );
}

const PILL_FONT = 12;
const pillWidth = (text: string) => Math.max(40, measure(text, PILL_FONT, SANS, 500) + 20);
const PILL_H = 22;

function Label({ x, y, text, tone, onClick, scale = 1, state = "idle" }: { x: number; y: number; text: string; tone: "dark" | "light" | "gold"; onClick?: () => void; scale?: number; state?: "idle" | "hover" | "selected" }) {
  const w = pillWidth(text);
  const fill = tone === "dark" ? "#1d2b22" : tone === "gold" ? "#6e5323" : "#f6f5ec";
  const color = tone === "light" ? "#1d2620" : "#f1f2ea";
  const stroke = state !== "idle" || tone === "gold" ? "#c9a35a" : tone === "dark" ? "rgba(201,163,90,0.35)" : "rgba(29,43,34,0.16)";
  return (
    <g className={`map-label ${state}`} transform={`translate(${x},${y}) scale(${scale})`} onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <g className="lift">
        <rect x={-w / 2} y={-PILL_H / 2 + 2} width={w} height={PILL_H} rx={PILL_H / 2} fill="rgba(22,33,26,0.16)" />
        <rect className="plate" x={-w / 2} y={-PILL_H / 2} width={w} height={PILL_H} rx={PILL_H / 2} fill={fill} stroke={stroke} strokeWidth={state === "selected" ? 2 : 1} />
        <text textAnchor="middle" y={4.2} fontSize={PILL_FONT} fontWeight={500} fill={color} fontFamily={SANS}>
          {text}
        </text>
      </g>
    </g>
  );
}

const STATUS_DOT: Record<Status, string> = { active: "#7fbf7a", idle: "#a9b4a0", paused: "#c4b07c", attention: "#e2b55a", retired: "#7d857a" };
const TITLE_FONT = 14;
const TITLE_LINE = 17;
const TITLE_MAX = 190;

interface Plaque {
  lines: string[];
  sub: string;
  w: number;
  /** Height of the plate, not counting the pointer below it. */
  h: number;
}

const plaques = new Map<string, Plaque>();
/** Plaque geometry, cached because labels are re-placed on every hover. */
function plaque(name: string, sub: string): Plaque {
  const key = `${name}\n${sub}`;
  const hit = plaques.get(key);
  if (hit) return hit;
  const p = measurePlaque(name, sub);
  plaques.set(key, p);
  return p;
}

function measurePlaque(name: string, sub: string): Plaque {
  const lines = wrap(name, TITLE_FONT, SERIF, TITLE_MAX);
  const titleW = Math.max(...lines.map((l) => measure(l, TITLE_FONT, SERIF)));
  const subW = measure(sub, 10.5, SANS) + 14;
  return { lines, sub, w: Math.max(titleW, subW) + 26, h: lines.length * TITLE_LINE + 26 };
}

/** Compact plaque above a repository tower: full project name, then a status dot and agent count. The pointer tip sits at (x, y). */
function DistrictLabel({ x, y, p, status, state, onClick, onEnter, onLeave, scale }: {
  x: number; y: number; p: Plaque; status: Status; state: "idle" | "hover" | "selected"; onClick: () => void; onEnter: () => void; onLeave: () => void; scale: number;
}) {
  const y0 = -7 - p.h;
  const subW = measure(p.sub, 10.5, SANS);
  const subY = y0 + 8 + p.lines.length * TITLE_LINE + 9;
  return (
    <g className={`map-label plaque ${state}`} transform={`translate(${x},${y}) scale(${scale})`} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave} style={{ cursor: "pointer" }}>
      <g className="lift">
        <rect x={-p.w / 2 + 1} y={y0 + 3} width={p.w} height={p.h} rx={9} fill="rgba(22,33,26,0.22)" />
        <path className="plate" d={`M-6 -8 L0 0 L6 -8 Z`} fill="#1d2b22" />
        <rect className="plate" x={-p.w / 2} y={y0} width={p.w} height={p.h} rx={9} fill="#1d2b22" stroke={state === "idle" ? "rgba(201,163,90,0.3)" : "#c9a35a"} strokeWidth={state === "selected" ? 2 : 1} />
        {p.lines.map((l, i) => (
          <text key={i} textAnchor="middle" y={y0 + 21 + i * TITLE_LINE} fontSize={TITLE_FONT} fill="#f1f2ea" fontFamily={SERIF}>
            {l}
          </text>
        ))}
        <circle className={status === "attention" ? "dot-pulse" : undefined} cx={-subW / 2 - 4} cy={subY - 3.5} r={3.2} fill={STATUS_DOT[status]} />
        <text textAnchor="middle" x={5} y={subY} fontSize={10.5} fill={state === "selected" ? "#e2c27a" : "#a9b3a5"} fontFamily={SANS} letterSpacing={0.2}>
          {p.sub}
        </text>
      </g>
    </g>
  );
}

const STATUS_ICON: Record<Status, IconName> = { active: "play", idle: "circle", paused: "pause", attention: "alert", retired: "close" };
const short = (s: string, n = 24) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const repoShort = (name: string) => name.split("/")[1] ?? name;
const GROUP_LABEL: Record<GroupBy, string> = { district: "By district", none: "No grouping", status: "By status", tag: "By tag" };

/** Where things sit in world space, for camera moves, hit lookups and keyboard navigation. */
function anchors(districts: District[], parks: Park[]) {
  const m = new Map<string, Pt & { district?: string }>();
  for (const d of districts) {
    const c = iso(d.hq.gx + d.hq.size / 2, d.hq.gy + d.hq.size / 2);
    const hq = { x: c.x, y: c.y - d.hq.height / 2, district: d.project.id };
    m.set(`project:${d.project.id}`, hq);
    for (const name of projectRepositories(d.project)) m.set(`repo:${name}`, hq);
    for (const k of d.kiosks) {
      const point = iso(k.gx + k.size / 2, k.gy + k.size / 2);
      m.set(`service:${d.project.id}:${k.service.id}`, { ...point, district: d.project.id });
    }
    // All workers are inside the project building.
    for (const a of d.crew) m.set(`agent:${a.id}`, hq);
    for (const l of d.lots) {
      const p = iso(l.gx + l.size / 2, l.gy + l.size / 2);
      m.set(`agent:${l.agent.id}`, { x: p.x, y: p.y - l.height / 2, district: d.project.id });
    }
  }
  for (const p of parks) for (const s of p.strays) m.set(`repo:${s.name}`, iso(s.gx + s.size / 2, s.gy + s.size / 2));
  return m;
}

export function MapView({active=true}:{active?:boolean}) {
  const { catalog, repos, uncataloged, select, selection: appSelection, setView } = useAtlas();
  const selection = active ? appSelection : null;
  const infrastructureMetrics = useMemo(() => {
    const aiAgents = catalog.agents.filter(isAiAgent).length;
    return [
      { label: "Projects", count: catalog.projects.length },
      { label: "AI Agents", count: aiAgents },
      { label: "Automations", count: catalog.agents.length - aiAgents },
    ];
  }, [catalog]);
  // Districts are the default layout; a new key so earlier saved groupings don't hide them.
  const [showNamesOnZoom, setShowNamesOnZoom] = useState(() => load<boolean>("mapNamesOnZoom", false));
  const [groupBy, setGroupByState] = useState<GroupBy>(() => (() => {const value=load<GroupBy>("mapProjectGrouping", "district");return Object.prototype.hasOwnProperty.call(GROUP_LABEL,value)?value:"district";})());
  const layout = useMemo(() => layoutMap(catalog, uncataloged, "district"), [catalog, uncataloged]);
  const where = useMemo(() => anchors(layout.districts, layout.parks), [layout]);
  const reduced = useReducedMotion();
  // The 3D neighborhood is the default; the flat isometric map stays as a lighter fallback.
  const [mode, setModeState] = useState<"3d" | "2d">(() => (webglAvailable() ? load<"3d" | "2d">("mapMode", "3d") : "2d"));
  const [light, setLightState] = useState<LightMode>(() => load<LightMode>("mapLight", "day"));
  const setLight = (l: LightMode) => {
    setLightState(l);
    save("mapLight", l);
  };
  // Decorative vehicles on the 3D map; on unless switched off.
  const [traffic, setTrafficState] = useState(() => load<boolean>("mapTraffic", true));
  // Inside: nearby headquarters open as cutaways showing their offices, without entering.
  const [inside, setInsideState] = useState(loadInside);
  const setInside = (on: boolean) => {
    setInsideState(on);
    saveInside(on);
  };
  const setTraffic = (on: boolean) => {
    setTrafficState(on);
    save("mapTraffic", on);
  };
  const is3d = mode === "3d";
  const office = useOffice();
  useEffect(() => () => leaveBuilding(true), []);
  useEffect(() => { if (!active) leaveBuilding(true); }, [active]);
  const displayNeighborhoods = useMemo(() => districtHeadings(layout, groupBy), [layout, groupBy]);
  const map3d = useRef<Map3DApi>(null);
  const phone = useMedia(PHONE_QUERY);

  // Connections between buildings, from catalog manifests and cached GitHub data only.
  const [linkPrefs, setLinkPrefsState] = useState<LinkPrefs>(() => {
    const saved = load<Partial<LinkPrefs>>("mapLinks3", {});
    return { ...LINK_DEFAULTS, ...saved, types: { ...LINK_DEFAULTS.types, ...saved.types } };
  });
  const setLinkPrefs = (p: Partial<LinkPrefs>) =>
    setLinkPrefsState((v) => {
      const next = { ...v, ...p };
      save("mapLinks3", next);
      return next;
    });
  const [linksMenu, setLinksMenu] = useState(false);
  const [linkSel, setLinkSel] = useState<string | null>(null);
  const connections = useMemo(() => buildConnections(catalog, repos), [catalog, repos]);

  // Every connection placed on the map; the view (lens) below decides which are drawn.
  const allLinks = useMemo<MapLink[]>(
    () =>
      connections.flatMap((c) => {
        const a = endpointKey(catalog, c.source);
        const b = endpointKey(catalog, c.target);
        if (!a || !b) return [];
        return [{ id: c.id, type: c.type, status: c.status, directed: c.directed, a, b, pa: projectOfEndpoint(catalog, c.source)?.id, pb: projectOfEndpoint(catalog, c.target)?.id }];
      }),
    [connections, catalog],
  );
  const [lens, setLensState] = useState<MapLens>(() => {
    const saved = load<MapLens>("mapLens", "infrastructure");
    return MAP_LENSES.includes(saved) ? saved : "infrastructure";
  });
  const setLens = (l: MapLens) => {
    setLensState(l);
    save("mapLens", l);
    setLinkSel(null);
    setLinksMenu(false);
    setLinkPrefs({on:l!=="infrastructure"});
  };
  const automationIds = useMemo(() => new Set(catalog.agents.filter((a) => !isAiAgent(a)).map((a) => a.id)), [catalog]);
  const linkCounts=useMemo(()=>{const eligible=lensLinks(allLinks,lens,{showAll:true,types:LINK_DEFAULTS.types,selKey:null,automations:automationIds});return Object.fromEntries(CONNECTION_TYPES.map(t=>[t,eligible.filter(l=>l.type===t).length])) as Record<ConnectionType,number>;},[allLinks,lens,automationIds]);
  const pickedLink = linkSel && is3d && allLinks.some((l) => l.id === linkSel) ? connections.find((c) => c.id === linkSel) : undefined;
  // A building selection replaces a connection selection, wherever it was made.
  useEffect(() => {
    if (selection) setLinkSel(null);
  }, [selection]);
  useEffect(() => {
    if (!active || !pickedLink) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLinkSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, pickedLink]);
  const linkTip = (id: string) => {
    const c = connections.find((x) => x.id === id);
    return c ? { title: c.relation, sub: `${CONNECTION_LABEL[c.type]} · ${CONNECTION_STATUS_LABEL[c.status]} · click to inspect` } : null;
  };
  const setMode = (m: "3d" | "2d") => {
    setModeState(m);
    setLinksMenu(false);
    setLinkSel(null);
    save("mapMode", m);
  };

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
  // Touch: every finger on the stage, and the two-finger pinch in progress.
  const fingers = useRef(new Map<number, Pt>());
  const pinch = useRef<{ x: number; y: number; d: number } | null>(null);

  useEffect(() => {
    camRef.current = cam;
  }, [cam]);

  const stop = useCallback(() => {
    if (anim.current !== null) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);
  useEffect(() => { if (!active) stop(); }, [active, stop]);

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
    [reduced, stop],
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
  }, [fitCam, stop]);

  useEffect(() => () => stop(), [stop]);

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
  }, [stop]);

  const endPointer = (id: number) => {
    fingers.current.delete(id);
    if (fingers.current.size < 2) pinch.current = null;
    if (fingers.current.size === 0) {
      drag.current = null;
      setDragging(false);
    }
  };

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
    // The 3D map's own controls handle the wheel.
    if (is3d) return;
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
  }, [zoomAt, is3d]);

  // Follow selections made elsewhere (search, inspector links) so the building stays in view.
  const selectedProject = selection?.kind === "repo" ? catalog.projects.find(p => projectRepositories(p, catalog.agents).includes(selection.id)) : undefined;
  const selKey = selectedProject ? `project:${selectedProject.id}` : selection ? `${selection.kind}:${selection.id}` : null;
  useEffect(() => {
    if (!active || !selKey) return;
    const p = where.get(selKey);
    if (!p) return;
    if (p.district) setFocus(p.district);
    // Wait a frame so the docked inspector has taken its width before measuring.
    const id = requestAnimationFrame(() => reveal(p, 0.55));
    return () => cancelAnimationFrame(id);
  }, [active, selKey, where, reveal]);

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
  const agentsShown = showNamesOnZoom && k >= 0.9;
  // Repository and district names grow as you zoom out so they stay readable.
  const nameScale = Math.min(2, Math.max(1, 0.85 / k));
  // Level of detail: windows, trees and footpaths only once there is room to see them.
  const detail = k >= 0.5 || layout.districts.length < 30;
  const focused = layout.districts.find((d) => d.project.id === focus) ?? layout.districts[0];
  const barProject = catalog.projects.find(p => p.id === (selection?.kind === "project" ? selection.id : focus)) ?? focused?.project;
  const isSelected = (kind: "agent" | "repo" | "project", id: string) => selection?.kind === kind && selection.id === id;
  const selectedDistrict = selKey ? where.get(selKey)?.district : undefined;
  const selProject = selection?.kind === "project" ? selection.id : selectedProject?.id;
  const mapLinks = useMemo(
    () => lensLinks(allLinks, lens, { showAll: linkPrefs.on, types: linkPrefs.types, selKey, selProject, automations: automationIds }),
    [allLinks, lens, linkPrefs.on, linkPrefs.types, selKey, selProject, automationIds],
  );
  // Lines that appear only because a building is selected stay with it, without fading the rest of the map.
  const selectionOnly = lens === "infrastructure" && !linkPrefs.on;

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

  // Islands back to front, so a nearer island's soil is never painted under a farther one.
  const islands = useMemo(
    () =>
      [
        ...layout.parks.map((p) => ({ kind: "park" as const, p, ox: p.ox, oy: p.oy, w: Math.max(p.w, p.h), depth: p.ox + p.oy + (p.w + p.h) / 2 })),
        ...layout.districts.map((d) => ({ kind: "district" as const, d, ox: d.ox, oy: d.oy, w: d.size, depth: d.ox + d.oy + d.size })),
      ].sort((a, b) => a.depth - b.depth),
    [layout],
  );
  // Where walkways leave an island (stairs down its visible faces) and where they meet each island's edge (inner paths).
  const { ramps, exits } = useMemo(() => {
    const ramps = new Map<string, Walk[]>();
    const exits = new Map<string, { gx: number; gy: number }[]>();
    const add = <T,>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
    for (const w of layout.walks) {
      add(ramps, w.from, w);
      add(exits, w.from, w.a);
      add(exits, w.to, w.b);
    }
    return { ramps, exits };
  }, [layout]);

  // Label geometry in world units, then greedy placement: a label moves up before it hides, so nothing overlaps.
  const labels = useMemo(() => {
    const out: (LabelBox & { draw: (dy: number) => React.ReactNode })[] = [];
    const urgent = (key: string, district?: string) =>
      key === selKey || key === hover || (district && hover === `district:${district}`) ? 0 : district && (district === selectedDistrict || district === focus) ? 2 : null;
    for (const d of layout.districts) {
      const c = iso(d.hq.gx + d.hq.size / 2, d.hq.gy + d.hq.size / 2);
      const key = `project:${d.project.id}`;
      const p = plaque(d.project.name, `${statusLabel(d.project.status)} · ${residentsLabel(d.crew.filter(isAiAgent).length, d.crew.filter(a => !isAiAgent(a)).length + d.lots.length)}`);
      // Pointer tip just above the tower's roof and mast.
      const y = c.y - d.hq.height - TH * d.hq.size * 0.5 - 14;
      const u = urgent(key, d.project.id);
      const h = (p.h + 7) * nameScale;
      const state = key === selKey || d.project.id === selectedDistrict ? "selected" : key === hover || hover === `district:${d.project.id}` ? "hover" : "idle";
      out.push({
        id: `hq:${d.project.id}`,
        x: c.x,
        top: y - h,
        bottom: y,
        w: p.w * nameScale,
        alts: [-h * 0.6, -h * 1.2],
        priority: u ?? 3 + (1 - Math.min(d.size, 15) / 15) * 0.5,
        draw: (dy) => (
          <g key={`n:${d.project.id}`}>
            {dy !== 0 && <line x1={c.x} y1={y + dy} x2={c.x} y2={y} stroke="rgba(29,43,34,0.45)" strokeWidth={1.2} strokeDasharray="2 3" />}
            <DistrictLabel
              x={c.x}
              y={y + dy}
              scale={nameScale}
              p={p}
              status={d.project.status}
              state={state}
              onClick={() => select({ kind: "project", id: d.project.id })}
              onEnter={() => setHover(key)}
              onLeave={() => setHover(null)}
            />
          </g>
        ),
      });
    }
    // A big lot of uncataloged repositories only gets names once you zoom toward it.
    const straysShown = strays.length <= 12 || k >= 0.4;
    for (const s of strays) {
      const key = `repo:${s.name}`;
      if (!straysShown && key !== selKey && key !== hover) continue;
      const c = iso(s.gx + s.size / 2, s.gy + s.size / 2);
      const text = short(repoShort(s.name), 30);
      const y = c.y - s.height - TH * s.size * 0.5 - 14 * nameScale;
      out.push({
        id: `stray:${s.name}`,
        x: c.x,
        top: y - (PILL_H / 2) * nameScale,
        bottom: y + (PILL_H / 2) * nameScale,
        w: pillWidth(text) * nameScale,
        alts: [-PILL_H * nameScale],
        priority: urgent(key) ?? 5,
        draw: (dy) => <Label key={`sl:${s.name}`} x={c.x} y={y + dy} scale={nameScale} text={text} tone="light" state={key === selKey ? "selected" : key === hover ? "hover" : "idle"} onClick={() => select({ kind: "repo", id: s.name })} />,
      });
    }
    for (const l of lots) {
      const a = l.agent;
      const key = `agent:${a.id}`;
      const u = urgent(key, l.d.project.id);
      if (!agentsShown && l.d.project.id !== selectedDistrict && key !== selKey && key !== hover) continue;
      const c = iso(l.gx + l.size / 2, l.gy + l.size / 2);
      const text = a.status === "attention" ? `${short(a.name, 22)} · needs attention` : short(a.name, 32);
      const y = c.y - l.height - TH * l.size * 0.5 - 16;
      out.push({
        id: key,
        x: c.x,
        top: y - PILL_H / 2,
        bottom: y + PILL_H / 2,
        w: pillWidth(text),
        alts: [-PILL_H - 2, PILL_H + 2],
        priority: u === 0 ? 0.5 : u === 2 ? 2.5 : 6,
        draw: (dy) => <Label key={`l:${a.id}`} x={c.x} y={y + dy} text={text} tone={a.status === "attention" ? "gold" : "light"} state={key === selKey ? "selected" : key === hover ? "hover" : "idle"} onClick={() => select({ kind: "agent", id: a.id })} />,
      });
    }
    const shown = placeLabels(out);
    // Draw back to front so the most important labels end up on top.
    return out
      .filter((b) => shown.has(b.id))
      .map((b) => ({ ...b, dy: shown.get(b.id)! }))
      .sort((a, b) => b.priority - a.priority);
  }, [layout, lots, strays, k, nameScale, agentsShown, selKey, hover, selectedDistrict, focus, select]);


  const setGroupBy = (g: GroupBy) => {
    setGroupByState(g);
    save("mapProjectGrouping", g);
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
    setAnnounce(`${d.project.name}. ${residentsLabel(d.crew.filter(isAiAgent).length, d.crew.filter(a => !isAiAgent(a)).length + d.lots.length)}. Press Enter to inspect.`);
    if (is3d) map3d.current?.reveal(d.ox + d.size / 2, d.oy + d.size / 2);
    else reveal(center(d));
  };

  const zoomBy = (f: number) => (is3d ? map3d.current?.zoom(f) : zoomAt(f));
  const fitAny = () => (is3d ? map3d.current?.fit() : fit());

  const healthFor = useCallback(
    (repository: string) => ({ ...verifiedState(repos[repository]), health: overallHealth(repoHealth(repoData(repos[repository]), 0)) }),
    [repos],
  );

  /** Hover text for a building, from the same live repository data the inspector uses. */
  const tipFor = (key: string) => {
    if (key.startsWith("agent:")) {
      const a = catalog.agents.find((x) => x.id === key.slice(6));
      return a ? { title: a.name, sub: `${a.framework} · ${statusLabel(a.status)} · last run ${relative(effectiveLastRun(a, repoData(repos[a.repository]))).toLowerCase()}` } : null;
    }
    if (key.startsWith("project:")) {
      const project = catalog.projects.find(p => p.id === key.slice(8));
      return project ? { title: project.name, sub: `Project · ${projectRepositories(project, catalog.agents).length} linked repositories` } : null;
    }
    const name = key.slice(5);
    const snap = repoData(repos[name]);
    if (!catalog.projects.some((p) => p.repository === name)) return { title: name, sub: snap?.pushedAt ? `Not in the catalog yet · pushed ${relative(snap.pushedAt)}` : "Not in the catalog yet" };
    return { title: name, sub: snap?.commits[0] ? `Latest commit ${relative(snap.commits[0].date)}: ${short(snap.commits[0].message, 40)}` : "Repository" };
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      if (e.shiftKey && !is3d) panBy(-dir[0] * 120, -dir[1] * 120);
      else moveFocus(dir[0], dir[1]);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focused) select({ kind: "project", id: focused.project.id });
    } else if (e.key === "+" || e.key === "=") zoomBy(1.25);
    else if (e.key === "-" || e.key === "_") zoomBy(0.8);
    else if (e.key === "0") fitAny();
    else if (is3d && (e.key === "q" || e.key === "e")) map3d.current?.rotate(e.key === "q" ? 45 : -45);
    else if (is3d && e.key === "i") setInside(!inside);
  };

  return (
    <div className={`map-wrap ${!office.projectId&&(selection || pickedLink) ? "inspecting" : ""}`}>
      {active && office.projectId && (
        <Suspense fallback={null}>
          {office.projectId === "atlas-marketplace" ? <MallInterior light={light} /> : office.projectId === AGENCY_OFFICE_ID ? <AgencyInterior light={light} key={office.projectId} /> : (office.projectId === "skyline-residences" || office.projectId.startsWith("skyline-business:")) ? <SkylineInterior maxFloor={office.projectId==="skyline-business:Atlas Hills"?1:4} light={light} key={office.projectId} building={office.projectId.startsWith("skyline-business:")?office.projectId.slice(17):"Skyline"} /> : <OfficeLayer light={light} />}
        </Suspense>
      )}
      <div className="map-col">
        <div
          ref={stage}
          className={`map-stage ${dragging ? "dragging" : ""} ${is3d && light === "night" ? "night" : ""}`}
          tabIndex={0}
          role="application"
          aria-roledescription="map"
          aria-label="Workspace map. Arrow keys move between projects, Enter inspects, plus and minus zoom, 0 fits, Shift and arrows pan, I shows inside the buildings."
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.button !== 0 || is3d) return;
            stop();
            fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (fingers.current.size === 2) {
              capture(e);
              drag.current = null;
              pinch.current = pinchOf([...fingers.current.values()]);
              touched.current = true;
              setDragging(true);
              setTip(null);
              return;
            }
            drag.current = { x: e.clientX, y: e.clientY, vx: cam.x, vy: cam.y, moved: false };
          }}
          onPointerMove={(e) => {
            if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const p = pinch.current;
            if (p && fingers.current.size >= 2) {
              const next = pinchOf([...fingers.current.values()].slice(0, 2));
              const r = e.currentTarget.getBoundingClientRect();
              const mx = next.x - r.left;
              const my = next.y - r.top;
              pinch.current = next;
              setCam((v) => {
                const k = Math.min(3, Math.max(kMin(), v.k * (next.d / p.d)));
                const f = k / v.k;
                return { k, x: mx - (mx - v.x - (next.x - p.x)) * f, y: my - (my - v.y - (next.y - p.y)) * f };
              });
              return;
            }
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (!d.moved && Math.hypot(dx, dy) < 4) return;
            if (!d.moved) {
              d.moved = true;
              touched.current = true;
              setDragging(true);
              capture(e);
            }
            setTip(null);
            setCam((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
          }}
          onPointerUp={(e) => endPointer(e.pointerId)}
          onPointerCancel={(e) => endPointer(e.pointerId)}
          onClickCapture={(e) => {
            // A drag that ends over a building must not count as a click on it.
            if (dragging) e.stopPropagation();
          }}
        >
          {is3d ? (
            <Suspense fallback={<div className="map-loading" role="status">Loading city…</div>}>
            <Map3D
              active={active}
              ref={map3d}
              layout={layout}
              displayNeighborhoods={displayNeighborhoods}
              // On a phone the inspector is a sheet over the lower half of the map (mobile.css).
              cover={phone && (selection || pickedLink) ? 0.4 : 0}
              selKey={selKey}
              selectedDistrict={selectedDistrict}
              focus={focus}
              showAgentLabels={showNamesOnZoom}
              reduced={reduced}
              tipFor={tipFor}
              healthFor={healthFor}
              light={light}
              onSelect={(sel, project) => {
                if (project) setFocus(project);
                select(sel);
              }}
              onFocus={setFocus}
              links={mapLinks}
              linkSel={pickedLink ? pickedLink.id : null}
              onLinkSelect={(id) => {
                select(null);
                setLinkSel(id);
              }}
              linkTip={linkTip}
              linkFocus={linkPrefs.focus && !selectionOnly}
              showLocal={lens !== "infrastructure"}
              traffic={traffic}
              inside={inside}
              linksMoving={!linkPrefs.paused}
            />
            </Suspense>
          ) : (
          <svg aria-hidden="true">
            <MapDefs />
            <g transform={`translate(${cam.x},${cam.y}) scale(${k})`}>
              {groupBy !== "none" && displayNeighborhoods.filter((n) => n.key !== "uncataloged").map((n) => <NeighborhoodPlate key={n.key} n={n} />)}
              <Meadows meadows={layout.meadows} walks={layout.walks} visible={rectVisible} texture={detail} />
              {islands.map((it) => {
                if (!rectVisible(it.ox, it.oy, it.w, it.w)) return null;
                if (it.kind === "park") return <ParkTile key={it.p.id} p={it.p} ramps={ramps.get(it.p.id)} textScale={nameScale} trees={detail} />;
                const d = it.d;
                return (
                  <Ground
                    key={d.project.id}
                    d={d}
                    ramps={ramps.get(d.project.id)}
                    focused={d === focused}
                    selected={isSelected("project", d.project.id) || (selection?.kind === "agent" && [...d.crew, ...d.lots.map((l) => l.agent)].some((a) => a.id === selection.id))}
                    hovered={!!hover && (hover === `district:${d.project.id}` || where.get(hover)?.district === d.project.id)}
                    detail={detail}
                    onFocus={() => setFocus(d.project.id)}
                    onEnter={() => setHover(`district:${d.project.id}`)}
                    onLeave={() => setHover((h) => (h === `district:${d.project.id}` ? null : h))}
                  />
                );
              })}
              {detail &&
                layout.districts
                  .filter((d) => rectVisible(d.ox, d.oy, d.size, d.size))
                  .flatMap((d) => [
                  <Connections key={`c:${d.project.id}`} d={d} exits={exits.get(d.project.id)} />,
                  ...treeSpots(`${d.project.id}:bush`, d.ox, d.oy, d.size, Math.round(d.size * 1.2)).map((t, i) => <Bush key={`${d.project.id}:b${i}`} gx={t.gx} gy={t.gy} r={t.r * 0.7} />),
                  ...treeSpots(d.project.id, d.ox, d.oy, d.size, Math.round(d.size * 3)).map((t, i) => <Tree key={`${d.project.id}:${i}`} {...t} />),
                ])}
              {drawables.map((it) => {
                if (it.kind === "stray") {
                  const s = it.s;
                  if (!ptVisible(iso(s.gx, s.gy))) return null;
                  const snap = repoData(repos[s.name]);
                  const key = `repo:${s.name}`;
                  return (
                    <Box
                      key={`stray:${s.name}`}
                      id={s.name}
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
                  const key = `project:${d.project.id}`;
                  return (
                    <Box
                      key={`hq:${d.project.id}`}
                      id={d.project.id}
                      kind="tower"
                      worker={d.crew.length > 0 ? "agent" : undefined}
                      gx={d.hq.gx}
                      gy={d.hq.gy}
                      w={d.hq.size}
                      h={d.hq.height}
                      wall="#ece5d2"
                      roof="#2f4535"
                      windows={detail}
                      selected={isSelected("project", d.project.id)}
                      hovered={hover === key}
                      onClick={() => {
                        setFocus(d.project.id);
                        select({ kind: "project", id: d.project.id });
                      }}
                      onEnter={enter(key, d.project.name, "Project building")}
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
                    id={a.id}
                    kind="house"
                    worker="automation"
                    windows={detail}
                    gx={l.gx}
                    gy={l.gy}
                    w={l.size}
                    h={l.height}
                    wall={a.status === "retired" ? "#d4d6cc" : "#f2ecdc"}
                    roof="#58665f"
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
              {labels.filter((b) => ptVisible({ x: b.x, y: b.top + b.dy })).map((b) => b.draw(b.dy))}
              {groupBy !== "none" && displayNeighborhoods.filter((n) => n.key !== "uncataloged").map((n) => <NeighborhoodLabel key={`nl:${n.key}`} n={n} scale={nameScale} />)}
            </g>
            {layout.districts.flatMap(d => d.kiosks.map(k => <Box key={`tool:${d.project.id}:${k.service.id}`} id={`tool:${d.project.id}:${k.service.id}`} kind="tower" gx={k.gx} gy={k.gy} w={k.size} h={88} wall={toolBrand(k.service.name).wall} roof={toolBrand(k.service.name).primary} windows={detail} onClick={() => { setFocus(d.project.id); select({ kind: "service", id: `${d.project.id}:${k.service.id}` }); }} selected={selection?.kind === "service" && selection.id === `${d.project.id}:${k.service.id}`} onEnter={() => { setHover(`service:${d.project.id}:${k.service.id}`); setTip(null); }} onLeave={leave} />))}
          </svg>
          )}

          <section className="map-intro selectable" aria-labelledby="workspace-map-title">
            <div className="eyebrow">WORKSPACE / INFRASTRUCTURE</div>
            <h1 id="workspace-map-title">Your Digital Infrastructure.</h1>
            <p className="map-intro-subheading">One connected ecosystem.</p>
            <p className="map-intro-description">Explore the projects, agents, and automated systems powering your digital environment.</p>
            <dl className="map-intro-metrics" aria-label="Infrastructure inventory">
              {infrastructureMetrics.map(({ label, count }) => (
                <div key={label}>
                  <dt><i aria-hidden="true" />{label}</dt>
                  <dd>{count.toLocaleString()}</dd>
                </div>
              ))}
            </dl>
          </section>

          {tip && (
            <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
              <div className="t">{tip.title}</div>
              <div className="s">{tip.sub}</div>
            </div>
          )}

          <div className="map-controls">
            <MapSelect label="Map view" value={lens} options={MAP_LENSES} text={(l) => LENS_INFO[l].label} short={(l) => LENS_INFO[l].label.replace(/ view$/, "")} onChange={setLens} disabled={!is3d}
              title={is3d ? LENS_INFO[lens].hint : "Connection views are available in 3D. Your selection is saved."} />
            <MapSelect label="Group projects" value={groupBy} options={Object.keys(GROUP_LABEL) as GroupBy[]} text={(g) => GROUP_LABEL[g]} onChange={setGroupBy}
              title="Keep district locations and clean district names; no grouping hides district headings" />
            <span className="sep" />
            {webglAvailable() && (
              <button className={`icon-btn text ${is3d ? "on" : ""}`} onClick={() => setMode(is3d ? "2d" : "3d")} aria-pressed={is3d} aria-label="3D map" title={is3d ? "Switch to the flat map" : "Switch to the 3D map"}>
                3D
              </button>
            )}
            {is3d && (
              <button
                className={`icon-btn ${inside ? "on" : ""}`}
                onClick={() => setInside(!inside)}
                aria-pressed={inside}
                aria-label="Inside"
                aria-keyshortcuts="I"
                title={inside ? "Close the buildings (I)" : "See inside the buildings near you (I). Select one and Enter it for the full office."}
              >
                <Icon name="cutaway" size={17} />
              </button>
            )}
            {is3d && (
              <button
                className={`icon-btn ${light === "night" ? "on" : ""}`}
                onClick={() => setLight(light === "night" ? "day" : "night")}
                aria-pressed={light === "night"}
                aria-label="Night mode"
                title={light === "night" ? "Switch to day" : "Switch to night"}
              >
                <Icon name={light === "night" ? "moon" : "sun"} size={17} />
              </button>
            )}
            {is3d && (
              <button className={`icon-btn ${traffic ? "on" : ""}`} onClick={() => setTraffic(!traffic)} aria-pressed={traffic} aria-label="Traffic" title={traffic ? "Hide road traffic" : "Show road traffic"}>
                <Icon name="car" size={17} />
              </button>
            )}
            {is3d && (
              <div className="map-menu-wrap">
                <button
                  className={`icon-btn ${linkPrefs.on || lens!=="infrastructure" ? "on" : ""}`}
                  onClick={() => setLinksMenu(!linksMenu)}
                  aria-expanded={linksMenu}
                  aria-haspopup="dialog"
                  aria-label="Connections"
                  title="Connections"
                >
                  <Icon name="network" size={17} />
                </button>
                {linksMenu && (
                  <ConnectionsMenu
                    prefs={{...linkPrefs,on:linkPrefs.on||lens!=="infrastructure"}}
                    counts={linkCounts}
                    picked={!!pickedLink}
                    onChange={p=>{setLinkPrefs(p);if(p.on===false){setLensState("infrastructure");save("mapLens","infrastructure");}setLinkSel(null);}}
                    onClear={() => setLinkSel(null)}
                    onClose={() => setLinksMenu(false)}
                  />
                )}
              </div>
            )}
            {is3d && (
              <button className="icon-btn" onClick={() => map3d.current?.rotate(-45)} aria-label="Rotate view" title="Rotate view (Q, E). Or drag with the right button, two fingers, or Shift held">
                <Icon name="rotate" size={17} />
              </button>
            )}
            <button className="icon-btn" onClick={fitAny} aria-label="Fit map" title="Fit map (0)">
              <Icon name="focus" size={17} />
            </button>
            <button className={`icon-btn ${showNamesOnZoom ? "on" : ""}`} onClick={() => { setShowNamesOnZoom(!showNamesOnZoom); save("mapNamesOnZoom", !showNamesOnZoom); }} aria-label="Show agent names when zoomed in" aria-pressed={showNamesOnZoom} title="Show agent and automation names when zoomed in. Selecting a project always reveals its names.">
              <Icon name="labels" size={17} />
            </button>
            <button className="icon-btn" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in (+)">
              <Icon name="plus" size={17} />
            </button>
            <button className="icon-btn" onClick={() => zoomBy(0.8)} aria-label="Zoom out" title="Zoom out (−)">
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
              <button tabIndex={-1} onClick={() => select({ kind: "project", id: d.project.id })}>
                {d.project.name}, {residentsLabel(d.crew.filter(isAiAgent).length, d.crew.filter(a => !isAiAgent(a)).length + d.lots.length)}
              </button>
            </li>
          ))}
        </ul>

        <ul className="sr-only" aria-label="Infrastructure tools">
          {layout.districts.flatMap(d => d.kiosks.map(k => <li key={`${d.project.id}:${k.service.id}`}><button onClick={() => select({ kind: "service", id: `${d.project.id}:${k.service.id}` })}>{k.service.name} · {d.project.name}</button></li>))}
        </ul>
        {is3d && mapLinks.length > 0 && (
          <ul className="sr-only" aria-label="Connections on the map">
            {mapLinks.map((l) => (
              <li key={l.id}>
                <button
                  tabIndex={-1}
                  onClick={() => {
                    select(null);
                    setLinkSel(l.id);
                  }}
                >
                  {linkTip(l.id)?.title} ({CONNECTION_STATUS_LABEL[l.status]})
                </button>
              </li>
            ))}
          </ul>
        )}

        {!office.projectId && barProject && selection && <ProjectBar d={{project:barProject,crew:catalog.agents.filter(a=>a.projectId===barProject.id),lots:[]}} onOpenList={() => setView("agents")} />}
      </div>

      {!office.projectId && (pickedLink ? <ConnectionPanel c={pickedLink} onClose={() => setLinkSel(null)} /> : selection && <DetailPanel docked />)}
    </div>
  );
}

interface LinkPrefs {
  on: boolean;
  types: Record<ConnectionType, boolean>;
  /** Selecting a building fades everything but it and its connections. */
  focus: boolean;
  paused: boolean;
}
const LINK_DEFAULTS: LinkPrefs = { on: false, types: { github: true, agent: true, n8n: true, dependency: true }, focus: true, paused: false };

/** The toolbar's Connections popover: what to draw, focus mode and animation. */
function ConnectionsMenu({ prefs, counts, picked, onChange, onClear, onClose }: {
  prefs: LinkPrefs;
  counts: Record<ConnectionType, number>;
  picked: boolean;
  onChange: (p: Partial<LinkPrefs>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);
  const missing = CONNECTION_TYPES.filter((t) => !counts[t]);
  return (
    <div className="map-menu" ref={ref} role="dialog" aria-label="Connections">
      <label className="row strong">
        <input type="checkbox" checked={prefs.on} onChange={(e) => onChange({ on: e.target.checked })} />
        Show all connections in this view
      </label>
      <div className="group">
        {CONNECTION_TYPES.map((t) => (
          <label key={t} className="row">
            <input type="checkbox" checked={prefs.types[t]} onChange={(e) => onChange({ types: { ...prefs.types, [t]: e.target.checked } })} />
            <i className="swatch" style={{ background: LINK_COLORS[t].day }} />
            {CONNECTION_LABEL[t]}
            <span className="count">{counts[t] || "None yet"}</span>
          </label>
        ))}
      </div>
      <label className="row">
        <input type="checkbox" checked={prefs.focus} onChange={(e) => onChange({ focus: e.target.checked })} />
        Selected building only
      </label>
      <label className="row">
        <input type="checkbox" checked={prefs.paused} onChange={(e) => onChange({ paused: e.target.checked })} />
        Pause animation
      </label>
      <button className="text-btn" disabled={!picked} onClick={onClear}>
        Clear connection selection
      </button>
      <p className="note">
        Drawn only from catalog manifests and GitHub data. Moving dots mean recently verified activity; faint lines have no live data. Red needs a real failure.
        {missing.length > 0 &&
          ` Not declared yet: ${missing.map((t) => CONNECTION_LABEL[t]).join(", ")}. To add one, list agent ids under registry.responsibilities.dependencies, or add connections to a project, in catalog/*.yaml.`}
      </p>
    </div>
  );
}

/** Islands stand this far above the meadow. */
const ISLAND = 26;
/** The meadow surface sits this far below the island tops, so islands keep a strip of soil above it. */
const DROP = 20;
const PATH_HW = 0.15;
const RAMP = 0.7;
const below = (p: Pt, h = DROP) => ({ x: p.x, y: p.y + h });

/** One low landmass under every island in a neighborhood, with stone walkways between the islands. */
function Meadows({ meadows, walks, visible, texture }: { meadows: Meadow[]; walks: Walk[]; visible: (ox: number, oy: number, w: number, h: number) => boolean; texture: boolean }) {
  const shown = meadows.filter((m) => visible(m.ox, m.oy, m.w, m.h));
  const top = (m: Meadow) => [iso(m.ox, m.oy), iso(m.ox + m.w, m.oy), iso(m.ox + m.w, m.oy + m.h), iso(m.ox, m.oy + m.h)].map((p) => below(p));
  const SOIL = 30;
  return (
    <g pointerEvents="none">
      {/* Sides first, then every top: a side only shows where no neighboring patch covers it, which is the shoreline. */}
      {shown.map((m, i) => {
        const t = top(m);
        return (
          <g key={`s${i}`}>
            <polygon points={pts([t[3], t[2], below(t[2], SOIL), below(t[3], SOIL)])} fill="url(#soil-l)" />
            <polygon points={pts([t[2], t[1], below(t[1], SOIL), below(t[2], SOIL)])} fill="url(#soil-r)" />
          </g>
        );
      })}
      {shown.map((m, i) => (
        <polygon key={`t${i}`} points={pts(top(m))} fill="#9fbd79" stroke="#9fbd79" strokeWidth={1.5} strokeLinejoin="round" />
      ))}
      {texture && shown.map((m, i) => <polygon key={`x${i}`} points={pts(top(m))} fill="url(#grass-tex)" />)}
      {walks.map((w, i) => {
        const along = w.axis === "x";
        const a = along ? { gx: w.a.gx + RAMP, gy: w.a.gy } : { gx: w.a.gx, gy: w.a.gy + RAMP };
        if (!visible(Math.min(a.gx, w.b.gx) - 1, Math.min(a.gy, w.b.gy) - 1, 2 + Math.abs(w.b.gx - a.gx), 2 + Math.abs(w.b.gy - a.gy))) return null;
        const q = along
          ? [iso(a.gx, a.gy - PATH_HW), iso(w.b.gx, a.gy - PATH_HW), iso(w.b.gx, a.gy + PATH_HW), iso(a.gx, a.gy + PATH_HW)]
          : [iso(a.gx - PATH_HW, a.gy), iso(a.gx + PATH_HW, a.gy), iso(a.gx + PATH_HW, w.b.gy), iso(a.gx - PATH_HW, w.b.gy)];
        const mid = iso((a.gx + w.b.gx) / 2, (a.gy + w.b.gy) / 2);
        return (
          <g key={`w${i}`}>
            <polygon points={pts(q.map((p) => below(p, DROP + 2)))} fill="rgba(60,80,45,0.22)" />
            <polygon points={pts(q.map((p) => below(p)))} fill="#ece5cf" stroke="#c8bd9b" strokeWidth={1} strokeLinejoin="round" />
            {/* A lamp post halfway along each walk. */}
            {texture && (
              <g>
                <line x1={mid.x + 14} y1={mid.y + DROP - 2} x2={mid.x + 14} y2={mid.y + DROP - 20} stroke="#3c4c40" strokeWidth={1.4} />
                <circle cx={mid.x + 14} cy={mid.y + DROP - 21} r={2.4} fill="#f3dc95" />
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** Stone steps from an island's edge down to the meadow, on the two faces the viewer can see. */
function Ramps({ ramps, m }: { ramps?: Walk[]; m: number }) {
  if (!ramps?.length) return null;
  return (
    <g pointerEvents="none">
      {ramps.map((w, i) => {
        const x = w.axis === "x";
        // u runs across the stair, v down it; corners at the island top (v=0) and on the meadow (v=1).
        const at = (u: number, v: number) => {
          const p = x ? iso(w.a.gx + m + v * (RAMP - m), w.a.gy + u) : iso(w.a.gx + u, w.a.gy + m + v * (RAMP - m));
          return below(p, v * DROP);
        };
        const hw = PATH_HW;
        const steps = [0.25, 0.5, 0.75];
        return (
          <g key={i}>
            <polygon points={pts([at(hw, 0), at(hw, 1), below(at(hw, 1), 6), below(at(hw, 0), ISLAND - 2)])} fill="#9b8a6d" />
            <polygon points={pts([at(-hw, 0), at(hw, 0), at(hw, 1), at(-hw, 1)])} fill="#e4dcc4" stroke="#b3a684" strokeWidth={1} strokeLinejoin="round" />
            {steps.map((v) => {
              const p = at(-hw, v), q = at(hw, v);
              return <line key={v} x1={p.x} y1={p.y} x2={q.x} y2={q.y} stroke="#b3a684" strokeWidth={1} />;
            })}
          </g>
        );
      })}
    </g>
  );
}

function Ground({ d, ramps, focused, hovered, selected, detail, onFocus, onEnter, onLeave }: {
  d: District; ramps?: Walk[]; focused: boolean; hovered: boolean; selected: boolean; detail: boolean; onFocus: () => void; onEnter: () => void; onLeave: () => void;
}) {
  // A raised grass plateau on the meadow: soil on the two visible sides, a contact shadow and a glow when active.
  const m = 0.45;
  const top = [iso(d.ox - m, d.oy - m), iso(d.ox + d.size + m, d.oy - m), iso(d.ox + d.size + m, d.oy + d.size + m), iso(d.ox - m, d.oy + d.size + m)];
  const c = iso(d.ox + d.size / 2, d.oy + d.size / 2);
  const span = (d.size + 2 * m) * TW;
  const lit = selected || hovered || focused;
  return (
    <g onClick={onFocus} onMouseEnter={onEnter} onMouseLeave={onLeave} className={`ground ${hovered ? "hover" : ""}`}>
      <polygon points={pts(top.map((p) => ({ x: p.x + 16, y: p.y + DROP + 4 })))} fill="rgba(38,60,30,0.22)" />
      {lit && <ellipse className={selected ? "district-aura on" : "district-aura"} cx={c.x} cy={c.y} rx={span * 1.15} ry={span * 0.6} fill="url(#aura)" />}
      <polygon points={pts([top[3], top[2], up(top[2], -ISLAND), up(top[3], -ISLAND)])} fill="url(#soil-l)" />
      <polygon points={pts([top[2], top[1], up(top[1], -ISLAND), up(top[2], -ISLAND)])} fill="url(#soil-r)" />
      <polygon
        points={pts(top)}
        fill={lit ? "url(#grass-hot)" : "url(#grass)"}
        stroke={selected || focused ? "#e2c27a" : hovered ? "rgba(246,226,160,0.8)" : "rgba(255,255,255,0.25)"}
        strokeWidth={selected || focused ? 3 : hovered ? 2 : 1}
        strokeLinejoin="round"
      />
      {detail && <polygon points={pts(top)} fill="url(#grass-tex)" pointerEvents="none" />}
      {detail &&
        treeSpots(`${d.project.id}:tuft`, d.ox, d.oy, d.size, Math.round(d.size * 3)).map((t, i) => {
          const q = iso(t.gx, t.gy);
          return <ellipse key={i} cx={q.x} cy={q.y} rx={t.r * 1.4} ry={t.r * 0.5} fill={i % 2 ? "rgba(255,255,230,0.14)" : "rgba(70,110,50,0.14)"} />;
        })}
      <Ramps ramps={ramps} m={m} />
    </g>
  );
}

function Connections({ d, exits }: { d: District; exits?: { gx: number; gy: number }[] }) {
  // Pale stone paths from the repository HQ to each agent house, and out to the walkways at the island's edge.
  const hc = { gx: d.hq.gx + d.hq.size / 2, gy: d.hq.gy + d.hq.size / 2 };
  const lines = d.lots.map((l) => {
    const lc = { gx: l.gx + l.size / 2, gy: l.gy + l.size / 2 };
    return { id: l.agent.id, p: pts([iso(hc.gx, hc.gy), iso(lc.gx, hc.gy), iso(lc.gx, lc.gy)]) };
  });
  toolWorkflowRoads(d.hq, d.kiosks).forEach((path, i) => lines.push({ id: `tool-flow:${i}`, p: pts(path.map(p => iso(p.gx, p.gy))) }));
  d.kiosks.forEach((k, i) => lines.push({ id: `tool-door:${i}`, p: pts([iso(k.gx+k.size/2,k.gy+k.size), iso(k.gx+k.size/2,k.gy+k.size+0.25)]) }));
  // Clamp to the island top (which overhangs the lot by its margin) so paths meet the steps.
  const m = 0.45;
  const clamp = (v: number, lo: number) => Math.min(lo + d.size + m, Math.max(lo - m, v));
  for (const [i, e] of (exits ?? []).entries()) {
    const ex = { gx: clamp(e.gx, d.ox), gy: clamp(e.gy, d.oy) };
    const onX = e.gx <= d.ox || e.gx >= d.ox + d.size;
    const corner = onX ? iso(hc.gx, ex.gy) : iso(ex.gx, hc.gy);
    lines.push({ id: `exit${i}`, p: pts([iso(hc.gx, hc.gy), corner, iso(ex.gx, ex.gy)]) });
  }
  return (
    <g pointerEvents="none" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {lines.map((l) => <polyline key={`u${l.id}`} points={l.p} stroke="#b9b29a" strokeWidth={13} />)}
      {lines.map((l) => <polyline key={l.id} points={l.p} stroke="#efe9d6" strokeWidth={10} />)}
    </g>
  );
}

function ParkTile({ p, ramps, textScale, trees }: { p: Park; ramps?: Walk[]; textScale: number; trees: boolean }) {
  const { ox, oy, w, h } = p;
  const hasStrays = p.strays.length > 0;
  const ground = [iso(ox, oy), iso(ox + w, oy), iso(ox + w, oy + h), iso(ox, oy + h)];
  const pond = [iso(ox + w * 0.35, oy + h * 0.3), iso(ox + w * 0.75, oy + h * 0.3), iso(ox + w * 0.75, oy + h * 0.7), iso(ox + w * 0.35, oy + h * 0.7)];
  const front = iso(ox + w, oy + h);
  return (
    <g pointerEvents="none">
      <polygon points={pts(ground.map((q) => ({ x: q.x + 16, y: q.y + DROP + 4 })))} fill="rgba(38,60,30,0.22)" />
      <polygon points={pts([ground[3], ground[2], up(ground[2], -ISLAND), up(ground[3], -ISLAND)])} fill="url(#soil-l)" />
      <polygon points={pts([ground[2], ground[1], up(ground[1], -ISLAND), up(ground[2], -ISLAND)])} fill="url(#soil-r)" />
      <polygon points={pts(ground)} fill="url(#grass)" />
      {trees && <polygon points={pts(ground)} fill="url(#grass-tex)" />}
      {!hasStrays && <polygon points={pts(pond)} fill="#8fb3a8" stroke="#a9c7bc" strokeWidth={3} />}
      <Ramps ramps={ramps} m={0} />
      {trees && treeSpots(`park:${ox}:${oy}`, ox, oy, w, Math.min(40, Math.round((w + h) * 0.9)), h).map((t, i) => <Tree key={i} {...t} />)}
      {hasStrays ? (
        <text x={front.x} y={front.y + DROP + 40 + 26 * textScale} textAnchor="middle" fontFamily={SERIF} fontSize={26 * textScale} fill="#1d2b22">
          {`Not in the catalog yet (${p.strays.length})`}
        </text>
      ) : (
        <Label x={iso(ox + w / 2, oy + h / 2).x} y={iso(ox + w / 2, oy + h / 2).y} text="Room for the next project" tone="light" scale={textScale} />
      )}
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

function ProjectBar({ d, onOpenList }: { d: Pick<District,"project"|"crew"|"lots">; onOpenList: () => void }) {
  const { repos, select, setFilters, clearFilters } = useAtlas();
  const agents: Agent[] = [...d.crew, ...d.lots.map((l) => l.agent)];
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
            {d.project.repository} · {residentsLabel(d.crew.filter(isAiAgent).length, d.crew.filter(a => !isAiAgent(a)).length + d.lots.length)}
          </div>
          <h3>{d.project.name}</h3>
        </div>
        <span className="grow" />
        <StatusPill status={d.project.status} />
        <span className="health" style={{ color: "var(--on-dark-2)" }}>
          <i className={`h-${health}`} /> Repo {health === "good" ? "healthy" : health === "unknown" ? "not synced" : health === "warn" ? "needs a look" : "failing"}
        </span>
        <button className="ghost-btn" onClick={() => select({ kind: "project", id: d.project.id })}>
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

function capture(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // The pointer may already be gone (a synthetic or cancelled touch).
  }
}

/** Midpoint and spread of two fingers. */
function pinchOf([a, b]: Pt[]) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}
