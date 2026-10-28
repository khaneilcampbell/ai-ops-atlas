import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MapControls } from "three/examples/jsm/controls/MapControls.js";
import type { Status } from "../../catalog/types";
import type { Health, Verified } from "../../lib/derive";
import { Bloom, Sky, Traffic, Vehicles, type LightMode } from "./living";
import { statusLabel } from "../../components/bits";
import { placeLabels, type Layout } from "../mapLayout";
import { clip, measure, SANS, wrap } from "../mapText";
import type { ConnectionStatus } from "../../lib/connections";
import type { ConnectionType } from "../../catalog/types";
import { focus as focusLevel, focusCount, focusRects, FOCUS_MAX, time } from "./materials";
import { Network, type NetLink } from "./network";
import { Houses, Landscape, Terrain, Towers, towerTop, useGeometries, useMaterials, type Pick, type PickHandlerSet } from "./models";
import { buildScene, TERRACE_H, WATER_Y, type Scene3D } from "./scene";
import { ENTER_MS, LEAVE_MS, useOffice } from "../office/store";
import { useBuildingActivity, type Illumination } from "../office/activity";
import { ActivityGlow } from "./activity";

export interface Map3DApi {
  zoom: (factor: number) => void;
  fit: () => void;
  /** Glide to a grid point, optionally zooming in to at least neighborhood level. */
  reveal: (gx: number, gz: number, closer?: boolean) => void;
}

type Sel = { kind: "repo" | "agent"; id: string };

/** A connection as the map needs it: the building keys and projects at both ends. */
export interface MapLink {
  id: string;
  type: ConnectionType;
  status: ConnectionStatus;
  directed: boolean;
  /** Building keys (repo:… or agent:…) and the projects they belong to. */
  a: string;
  b: string;
  pa?: string;
  pb?: string;
}

interface Props {
  layout: Layout;
  selKey: string | null;
  selectedDistrict?: string;
  focus: string;
  showAgentLabels: boolean;
  reduced: boolean;
  onSelect: (sel: Sel, projectId?: string) => void;
  onFocus: (projectId: string) => void;
  tipFor: (key: string) => { title: string; sub: string } | null;
  /** Verified repository health, for the discreet mark on each nameplate. */
  healthFor: (repository: string) => { kind: Verified; label: string; stale: boolean; health: Health };
  /** Day or night lighting. */
  light: LightMode;
  /** Connections to draw, already filtered by the toolbar; empty when they are switched off. */
  links: MapLink[];
  linkSel: string | null;
  onLinkSelect: (id: string) => void;
  linkTip: (id: string) => { title: string; sub: string } | null;
  /** Selecting a building shows only its connections and fades the rest of the map. */
  linkFocus: boolean;
  /** Connection particles move; off when paused in the toolbar or for reduced motion. */
  linksMoving: boolean;
  /** Decorative vehicles on the districts' paths; the toolbar's Traffic toggle. */
  traffic: boolean;
}

// Camera looks down from +x+z, matching the isometric map, at a miniature-photography angle.
const ELEVATION = (42 * Math.PI) / 180;
const DIR = new THREE.Vector3(Math.cos(ELEVATION) * Math.SQRT1_2, Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.SQRT1_2);
const FOV = 30;

const STATUS_DOT: Record<Status, string> = { active: "#7fbf7a", idle: "#a9b4a0", paused: "#c4b07c", attention: "#e2b55a", retired: "#7d857a" };

interface LabelSpec {
  id: string;
  key: string;
  pos: THREE.Vector3;
  w: number;
  h: number;
  priority: number;
  node: React.ReactNode;
  className: string;
  onClick?: () => void;
  title?: string;
}

const selOf = (key: string): Sel => {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as Sel["kind"], id: key.slice(i + 1) };
};

/** Where each clickable thing sits and how big it is, for highlights, labels and camera moves. */
function anchorsOf(scene: Scene3D) {
  const m = new Map<string, { x: number; z: number; y0: number; y1: number; w: number; d: number; project?: string }>();
  for (const t of scene.towers) m.set(t.key, { x: t.x, z: t.z, y0: TERRACE_H, y1: towerTop(t), w: t.size, d: t.size, project: t.projectId });
  for (const h of scene.houses) m.set(h.key, { x: h.x, z: h.z, y0: TERRACE_H, y1: TERRACE_H + h.h + h.roofH + 0.03, w: h.w + 0.14, d: h.d + 0.16, project: h.projectId });
  for (const s of scene.strays) m.set(s.key, { x: s.x, z: s.z, y0: 0, y1: Math.max(2, Math.round(s.height / 0.3)) * 0.3 + 0.06, w: s.size, d: s.size });
  return m;
}

const Map3D = forwardRef<Map3DApi, Props>(function Map3D(props, ref) {
  const { layout, selKey, selectedDistrict, focus, showAgentLabels, onSelect, tipFor, healthFor, links, linkSel, linkFocus } = props;
  const scene = useMemo(() => buildScene(layout), [layout]);
  const anchors = useMemo(() => anchorsOf(scene), [scene]);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; sub: string } | null>(null);
  const [near, setNear] = useState<"far" | "mid" | "near">("far");
  const api = useRef<Map3DApi | null>(null);
  const wrapEl = useRef<HTMLDivElement>(null);
  const labelEls = useRef(new Map<string, HTMLDivElement>());

  useImperativeHandle(ref, () => ({
    zoom: (f) => api.current?.zoom(f),
    fit: () => api.current?.fit(),
    reveal: (x, z, c) => api.current?.reveal(x, z, c),
  }));

  const select = (key: string) => {
    const a = anchors.get(key);
    onSelect(selOf(key), a?.project);
  };
  const hoverDistrict = hover?.startsWith("district:") ? hover.slice(9) : hover ? anchors.get(hover)?.project : undefined;
  const [hoverLink, setHoverLink] = useState<string | null>(null);

  // Which connections show, and how strongly. A selected connection wins; then a selected
  // building, whose own connections light up while the rest fade or hide.
  const net = useMemo(() => {
    const touches = (l: MapLink) =>
      !!selKey && (l.a === selKey || l.b === selKey || (selKey.startsWith("repo:") && !!selectedDistrict && (l.pa === selectedDistrict || l.pb === selectedDistrict)));
    const placed = links.filter((l) => anchors.has(l.a) && anchors.has(l.b));
    const picked = linkSel ? placed.find((l) => l.id === linkSel) : undefined;
    const inHand = (p?: string) => !!p && (p === selectedDistrict || p === hoverDistrict);
    const shown: { l: MapLink; level: NetLink["level"] }[] = [];
    for (const l of placed) {
      if (picked) {
        if (l === picked) shown.push({ l, level: "selected" });
        else if (!linkFocus) shown.push({ l, level: "dim" });
        continue;
      }
      if (selKey) {
        if (touches(l)) shown.push({ l, level: "strong" });
        else if (!linkFocus) shown.push({ l, level: "dim" });
        continue;
      }
      // Links inside one project only up close, or around the project in hand.
      if (l.pa === l.pb && near === "far" && !inHand(l.pa)) continue;
      shown.push({ l, level: l.status === "active" || l.status === "unhealthy" ? "strong" : "weak" });
    }
    // Many links at once: keep only failures at full strength so the map stays readable.
    if (!picked && !selKey && shown.length > 24) for (const s of shown) if (s.level === "strong" && s.l.status !== "unhealthy") s.level = "weak";
    // The projects in focus: both ends of the picked link, or the selected building's project and its partners.
    let focusSet: Set<string> | null = null;
    if (picked) focusSet = new Set([picked.pa, picked.pb].filter((p): p is string => !!p));
    else if (selKey && linkFocus && links.length) {
      focusSet = new Set(selectedDistrict ? [selectedDistrict] : []);
      for (const s of shown) for (const p of [s.l.pa, s.l.pb]) if (p) focusSet.add(p);
    }
    return { shown, picked, focusSet };
  }, [links, anchors, linkSel, selKey, selectedDistrict, hoverDistrict, near, linkFocus]);

  // Labels: project plaques always, agent pills once zoomed in (or for the hovered or selected agent).
  const labels = useMemo(() => {
    const out: LabelSpec[] = [];
    // Agent names only up close, and then only around the project in hand, unless the person
    // asked to always show them.
    const agentsNear = near === "near" || (showAgentLabels && near === "mid");
    const inHand = (p: string) => p === selectedDistrict || p === hoverDistrict || (p === focus && near === "near");
    for (const t of scene.towers) {
      const state = t.key === selKey || t.projectId === selectedDistrict ? "selected" : t.key === hover || hoverDistrict === t.projectId ? "hover" : "";
      const health = healthFor(t.repository);
      const mark = <b className={`hm hm-${health.kind}${health.stale ? " stale" : ""}`} title={health.label} aria-label={health.label} />;
      // A compact nameplate by default; the full name and details on hover or selection.
      if (!state) {
        const name = clip(t.name, 12, 168);
        out.push({
          id: `hq:${t.projectId}`,
          key: t.key,
          pos: new THREE.Vector3(t.x, towerTop(t) + 0.3, t.z),
          w: measure(name, 12, SANS, 600) + 40,
          h: 34,
          priority: t.projectId === focus ? 2 : 3 + 1 / (1 + t.agents),
          className: `m3-plaque compact${net.focusSet && !net.focusSet.has(t.projectId) ? " dim" : ""}`,
          onClick: () => select(t.key),
          title: `${t.name} · ${health.label}`,
          node: (
            <div className="t">
              <i className={t.status === "attention" ? "pulse" : undefined} style={{ background: STATUS_DOT[t.status] }} />
              {name}
              {mark}
            </div>
          ),
        });
        continue;
      }
      const lines = wrap(t.name, 13, SANS, 230, 600);
      const sub = `${t.agents} ${t.agents === 1 ? "agent" : "agents"} · ${statusLabel(t.status)}`;
      const w = Math.max(...lines.map((l) => measure(l, 13, SANS, 600)), measure(sub, 11, SANS) + 14, measure(health.label, 11, SANS) + 14) + 26;
      const h = lines.length * 17 + 48;
      out.push({
        id: `hq:${t.projectId}`,
        key: t.key,
        pos: new THREE.Vector3(t.x, towerTop(t) + 0.3, t.z),
        w,
        h: h + 8,
        priority: 0,
        className: `m3-plaque ${state}`,
        onClick: () => select(t.key),
        node: (
          <>
            {lines.map((l, i) => (
              <div key={i} className="t">
                {l}
              </div>
            ))}
            <div className="s">
              <i className={t.status === "attention" ? "pulse" : undefined} style={{ background: STATUS_DOT[t.status] }} />
              {sub}
            </div>
            <div className="s">
              {mark}
              {health.label}
            </div>
          </>
        ),
      });
    }
    for (const h of scene.houses) {
      const urgent = h.key === selKey || h.key === hover;
      if (!urgent && !(agentsNear && (showAgentLabels || inHand(h.projectId)))) continue;
      const a = h.agent;
      const text = a.status === "attention" ? `${a.name} · needs attention` : a.name;
      out.push({
        id: h.key,
        key: h.key,
        pos: new THREE.Vector3(h.x, TERRACE_H + h.h + h.roofH + 0.12, h.z),
        w: measure(text, 11.5, SANS, 500) + 22,
        h: 28,
        priority: urgent ? 0.5 : h.projectId === hoverDistrict || h.projectId === selectedDistrict ? 2.5 : 6,
        className: `m3-pill ${a.status === "attention" ? "gold" : ""} ${h.key === selKey ? "selected" : h.key === hover ? "hover" : ""}${net.focusSet && !net.focusSet.has(h.projectId) ? " dim" : ""}`,
        onClick: () => select(h.key),
        node: text,
      });
    }
    for (const s of scene.strays) {
      const text = s.name.split("/")[1] ?? s.name;
      out.push({
        id: s.key,
        key: s.key,
        pos: new THREE.Vector3(s.x, Math.max(2, Math.round(s.height / 0.3)) * 0.3 + 0.3, s.z),
        w: measure(text, 11.5, SANS, 500) + 22,
        h: 28,
        priority: s.key === selKey || s.key === hover ? 0.5 : 5,
        className: `m3-pill ${s.key === selKey ? "selected" : s.key === hover ? "hover" : ""}`,
        onClick: () => select(s.key),
        node: text,
      });
    }
    // Neighborhood names when the map is grouped, at the back corner of each landmass.
    for (const n of layout.neighborhoods) {
      if (!n.label || layout.neighborhoods.length < 2) continue;
      const text = `${n.label.toUpperCase()} · ${n.count}`;
      out.push({ id: `nb:${n.key}`, key: n.key, pos: new THREE.Vector3(n.ox + n.w / 2, 0.2, n.oy - 1.2), w: measure(text, 11.5, SANS, 500) + 34, h: 28, priority: 1.5, className: "m3-pill hood", node: text });
    }
    for (const p of scene.parks) {
      out.push({ id: p.id, key: p.id, pos: new THREE.Vector3(p.x + p.w / 2, TERRACE_H + 1.1, p.z + p.d / 2), w: measure(p.label, 11.5, SANS, 500) + 22, h: 28, priority: 7, className: "m3-pill quiet", node: p.label });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- select only reads anchors and onSelect
  }, [scene, layout, near, showAgentLabels, selKey, selectedDistrict, hover, hoverDistrict, focus, anchors, onSelect, healthFor, net.focusSet]);

  const pick: PickHandlerSet = {
    of: (keys) => ({
      keys,
      over: (k, e) => {
        setHover(k);
        const r = wrapEl.current!.getBoundingClientRect();
        const t = tipFor(k);
        setTip(t ? { x: e.nativeEvent.clientX - r.left, y: e.nativeEvent.clientY - r.top, ...t } : null);
      },
      out: () => {
        setHover(null);
        setTip(null);
      },
      click: (k, e) => {
        if (e.delta > 4) return;
        select(k);
      },
    }),
  };
  const terracePick: Pick = {
    keys: scene.terraces.map((t) => t.id),
    over: (id) => !id.startsWith("park:") && setHover(`district:${id}`),
    out: () => setHover((h) => (h?.startsWith("district:") ? null : h)),
    click: (id, e) => {
      if (e.delta > 4 || id.startsWith("park:")) return;
      props.onFocus(id);
    },
  };

  // Health accents on each headquarters, from the same verified data as the inspector.
  const health = useMemo(() => new Map(scene.towers.map((t) => [t.key, healthFor(t.repository).health])), [scene, healthFor]);
  // Stop rendering while the window is hidden; nothing on the map needs to move then.
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  // The map is fully covered while a building's office is open, so it stops rendering then.
  const officePhase = useOffice().phase;
  // Buildings light up while their agents are observed working.
  const activity = useBuildingActivity();

  return (
    <div className="map3d" ref={wrapEl}>
      <Canvas shadows dpr={[1, 2]} frameloop={visible && officePhase !== "inside" ? "always" : "never"} camera={{ fov: FOV, near: 0.5, far: 800 }} gl={{ antialias: true }}>
        <World
          light={props.light}
          health={health}
          net={net}
          hoverLink={hoverLink}
          linksMoving={props.linksMoving}
          traffic={props.traffic}
          onLinkHover={(id, e) => {
            setHoverLink(id);
            const t = id ? props.linkTip(id) : null;
            if (!t || !e) return setTip(null);
            const r = wrapEl.current!.getBoundingClientRect();
            setTip({ x: e.nativeEvent.clientX - r.left, y: e.nativeEvent.clientY - r.top, ...t });
          }}
          onLinkPick={props.onLinkSelect}
          hoods={layout.neighborhoods.length}
          scene={scene}
          anchors={anchors}
          labels={labels}
          labelEls={labelEls}
          hover={hover}
          selKey={selKey}
          hoverDistrict={hoverDistrict}
          selectedDistrict={selectedDistrict}
          api={api}
          pick={pick}
          terracePick={terracePick}
          reduced={props.reduced}
          activity={activity}
          onNear={setNear}
          onMoved={() => setTip(null)}
        />
      </Canvas>
      <div
        className="m3-labels"
        // Labels sit over the canvas; pass the wheel through so zooming works anywhere.
        onWheel={(e) => wrapEl.current?.querySelector("canvas")?.dispatchEvent(new WheelEvent("wheel", e.nativeEvent))}
      >
        {labels.map((l) => (
          <div
            key={l.id}
            ref={(el) => {
              if (el) labelEls.current.set(l.id, el);
              else labelEls.current.delete(l.id);
            }}
            className={l.className}
            title={l.title}
            style={{ width: l.w, visibility: "hidden" }}
            onClick={l.onClick}
            onMouseEnter={l.onClick ? () => setHover(l.key) : undefined}
            onMouseLeave={l.onClick ? () => setHover(null) : undefined}
          >
            {l.node}
          </div>
        ))}
      </div>
      {tip && (
        <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
          <div className="t">{tip.title}</div>
          <div className="s">{tip.sub}</div>
        </div>
      )}
    </div>
  );
});

function World({
  light: lightMode,
  health,
  net,
  hoverLink,
  linksMoving,
  traffic,
  onLinkHover,
  onLinkPick,
  hoods,
  scene,
  anchors,
  labels,
  labelEls,
  hover,
  selKey,
  hoverDistrict,
  selectedDistrict,
  api,
  pick,
  terracePick,
  reduced,
  activity,
  onNear,
  onMoved,
}: {
  light: LightMode;
  health: Map<string, Health>;
  net: { shown: { l: MapLink; level: NetLink["level"] }[]; picked?: MapLink; focusSet: Set<string> | null };
  hoverLink: string | null;
  linksMoving: boolean;
  traffic: boolean;
  onLinkHover: (id: string | null, e?: { nativeEvent: PointerEvent }) => void;
  onLinkPick: (id: string) => void;
  hoods: number;
  scene: Scene3D;
  anchors: ReturnType<typeof anchorsOf>;
  labels: LabelSpec[];
  labelEls: React.MutableRefObject<Map<string, HTMLDivElement>>;
  hover: string | null;
  selKey: string | null;
  hoverDistrict?: string;
  selectedDistrict?: string;
  api: React.MutableRefObject<Map3DApi | null>;
  pick: PickHandlerSet;
  terracePick: Pick;
  reduced: boolean;
  activity: Map<string, Illumination>;
  onNear: (near: "far" | "mid" | "near") => void;
  onMoved: () => void;
}) {
  const { camera, gl, size, scene: three } = useThree();
  const g = useGeometries();
  const m = useMaterials();
  const controls = useMemo(() => {
    const c = new MapControls(camera, gl.domElement);
    c.enableRotate = false;
    c.enableDamping = true;
    c.dampingFactor = 0.14;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.zoomSpeed = 1.2;
    return c;
  }, [camera, gl]);
  const touched = useRef(false);
  const fitDist = useRef(30);
  const anim = useRef<{ t0: number; ms: number; from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3] } | null>(null);
  /** The selection the camera is framing, until the person moves the camera themselves. */
  const framing = useRef<string | null>(null);
  const center = useMemo(() => {
    const b = scene.bounds;
    return new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
  }, [scene]);
  const ext = Math.max(scene.bounds.x1 - scene.bounds.x0, scene.bounds.z1 - scene.bounds.z0) / 2 + 4;

  const movedRef = useRef(onMoved);
  movedRef.current = onMoved;
  useEffect(() => {
    const start = () => {
      touched.current = true;
      anim.current = null;
      framing.current = null;
      movedRef.current();
    };
    // Reconnect on every mount: React's development double-mount would otherwise leave them detached.
    controls.disconnect();
    controls.connect(gl.domElement);
    controls.addEventListener("start", start);
    return () => {
      controls.removeEventListener("start", start);
      controls.disconnect();
    };
  }, [controls, gl]);

  /** Distance from the target at which the whole landmass fits the view, by bisection on its corners. */
  const computeFit = () => {
    const b = scene.bounds;
    const top = Math.max(2, ...scene.towers.map((t) => towerTop(t))) + 1;
    const corners = [b.x0, b.x1].flatMap((x) => [b.z0, b.z1].flatMap((z) => [WATER_Y, top].map((y) => new THREE.Vector3(x, y, z))));
    const cam = (camera as THREE.PerspectiveCamera).clone();
    cam.aspect = size.width / Math.max(1, size.height);
    cam.updateProjectionMatrix();
    let lo = 2;
    let hi = 600;
    const v = new THREE.Vector3();
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(center).addScaledVector(DIR, mid);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      const ok = corners.every((c) => {
        v.copy(c).project(cam);
        return Math.abs(v.x) <= 0.97 && v.y <= 0.84 && v.y >= -0.9;
      });
      if (ok) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  const goto = (target: THREE.Vector3, dist: number, instant = false, ms = 420) => {
    const to: [THREE.Vector3, THREE.Vector3] = [target.clone(), target.clone().addScaledVector(DIR, dist)];
    if (instant || reduced) {
      controls.target.copy(to[0]);
      camera.position.copy(to[1]);
      anim.current = null;
      return;
    }
    anim.current = { t0: performance.now(), ms, from: [controls.target.clone(), camera.position.clone()], to };
  };

  const fitNow = (instant = false) => {
    fitDist.current = computeFit();
    controls.maxDistance = fitDist.current * 1.8;
    controls.minDistance = 4;
    // Frame the heart of the map, the way the reference crops its coastline, rather than every corner.
    // Grouped maps keep every neighborhood in view.
    goto(center, fitDist.current * (hoods > 1 ? 0.9 : 0.7), instant);
  };

  // Fit on first show and when the layout changes; refit on resize until the person moves the camera.
  useEffect(() => {
    touched.current = false;
    fitNow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);
  useEffect(() => {
    if (framing.current) frame(framing.current);
    else if (!touched.current) fitNow(true);
    else fitDist.current = computeFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height]);

  api.current = {
    zoom: (f) => {
      touched.current = true;
      const d = camera.position.distanceTo(controls.target);
      goto(controls.target, THREE.MathUtils.clamp(d / f, controls.minDistance, controls.maxDistance));
    },
    fit: () => {
      touched.current = false;
      fitNow();
    },
    reveal: (x, z, closer) => {
      touched.current = true;
      const d = camera.position.distanceTo(controls.target);
      goto(new THREE.Vector3(x, TERRACE_H, z), closer ? Math.min(d, fitDist.current * 0.5) : d);
    },
  };

  /** Glide to a selected building, close enough to read its signs, with the whole building in view. */
  function frame(key: string) {
    const a = anchors.get(key);
    if (!a) return;
    touched.current = true;
    const h = a.y1 - a.y0;
    const dist = THREE.MathUtils.clamp(Math.max(h * 3.4, Math.max(a.w, a.d) * 5) + 3, controls.minDistance, fitDist.current * 0.45);
    goto(new THREE.Vector3(a.x, a.y0 + h * 0.42, a.z), dist, false, 900);
  }

  // Frame every selection, wherever it was made (map, search, inspector). The docked inspector
  // resizes the canvas a moment later, so the resize handler frames it again.
  useEffect(() => {
    framing.current = selKey && anchors.has(selKey) ? selKey : null;
    if (framing.current) frame(framing.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, anchors]);

  // Entering a building: remember the view, glide in toward its headquarters, and glide back to
  // the same view on the way out.
  const office = useOffice();
  const saved = useRef<[THREE.Vector3, THREE.Vector3] | null>(null);
  useEffect(() => {
    const { phase, projectId } = office;
    if ((phase === "entering" || phase === "inside") && projectId && !saved.current) {
      saved.current = [controls.target.clone(), camera.position.clone()];
      framing.current = null;
      const t = scene.towers.find((x) => x.projectId === projectId);
      const a = t && anchors.get(t.key);
      if (a && phase === "entering") {
        const h = a.y1 - a.y0;
        goto(new THREE.Vector3(a.x, a.y0 + h * 0.35, a.z), Math.max(h * 1.3, a.w * 2.4), false, ENTER_MS);
      }
    } else if ((phase === "leaving" || !phase) && saved.current) {
      const to = saved.current;
      saved.current = null;
      if (reduced || !phase) {
        controls.target.copy(to[0]);
        camera.position.copy(to[1]);
        anim.current = null;
      } else anim.current = { t0: performance.now(), ms: LEAVE_MS + 300, from: [controls.target.clone(), camera.position.clone()], to };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office.phase, office.projectId]);

  // Light and shadows sized to the whole map.
  const light = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.position.copy(center).add(new THREE.Vector3(-ext * 0.7, ext * 1.2, ext * 0.25));
    l.target.position.copy(center);
    three.add(l.target);
    const c = l.shadow.camera;
    c.left = -ext * 1.2;
    c.right = ext * 1.2;
    c.top = ext * 1.2;
    c.bottom = -ext * 1.2;
    c.near = 1;
    c.far = ext * 5;
    c.updateProjectionMatrix();
    return () => {
      three.remove(l.target);
    };
  }, [center, ext, three]);

  const fog = useMemo(() => new THREE.Fog("#d3e4de", 40, 120), []);
  useEffect(() => {
    three.fog = fog;
    return () => {
      three.fog = null;
    };
  }, [fog, three]);

  const lastSig = useRef("");
  const labelSig = useRef(0);
  useEffect(() => {
    labelSig.current++;
  }, [labels]);
  const nearRef = useRef<"far" | "mid" | "near">("far");
  const v = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    if (!reduced) time.value = state.clock.elapsedTime;
    const a = anim.current;
    if (a) {
      const p = Math.min(1, (performance.now() - a.t0) / a.ms);
      // Ease in and out so long glides start and land gently.
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      controls.target.lerpVectors(a.from[0], a.to[0], e);
      camera.position.lerpVectors(a.from[1], a.to[1], e);
      if (p >= 1) anim.current = null;
    }
    controls.update();
    const dist = camera.position.distanceTo(controls.target);
    fog.near = dist * 1.25;
    fog.far = dist * 3.2;
    const isNear = dist < fitDist.current * 0.4 ? "near" : dist < fitDist.current * 0.62 ? "mid" : "far";
    if (isNear !== nearRef.current) {
      nearRef.current = isNear;
      onNear(isNear);
    }

    // Re-place labels only when the view or the label set changed.
    const e = camera.matrixWorld.elements;
    const sig = `${e[12].toFixed(3)},${e[13].toFixed(3)},${e[14].toFixed(3)},${size.width},${size.height},${labelSig.current}`;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    const boxes = [];
    const screen = new Map<string, { x: number; y: number }>();
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      screen.set(l.id, { x, y });
      boxes.push({ id: l.id, x, top: y - l.h, bottom: y, w: l.w, priority: l.priority, alts: [-(l.h * 0.55), -(l.h + 6)] });
    }
    const shown = placeLabels(boxes, 5);
    for (const l of labels) {
      const el = labelEls.current.get(l.id);
      if (!el) continue;
      const s = screen.get(l.id);
      const dy = shown.get(l.id);
      if (!s || dy === undefined) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "visible";
      el.style.transform = `translate(${Math.round(s.x - l.w / 2)}px, ${Math.round(s.y + dy - l.h)}px)`;
      el.style.setProperty("--stem", `${Math.max(0, -dy)}px`);
    }
  });

  // Focus mode fades everything outside the terraces in focus; the shader reads these rectangles.
  const focusTarget = net.focusSet ? 1 : 0;
  useEffect(() => {
    const ts = net.focusSet ? scene.terraces.filter((t) => net.focusSet!.has(t.id)).slice(0, FOCUS_MAX) : [];
    ts.forEach((t, i) => focusRects.value[i].set(t.x - 0.2, t.z - 0.2, t.x + t.w + 0.2, t.z + t.d + 0.2));
    if (ts.length) focusCount.value = ts.length;
  }, [net.focusSet, scene]);
  useEffect(() => () => void (focusLevel.value = 0), []);
  useFrame((_, delta) => {
    const f = focusLevel.value;
    if (f === focusTarget) return;
    focusLevel.value = reduced ? focusTarget : THREE.MathUtils.clamp(f + Math.sign(focusTarget - f) * delta * 3.5, 0, 1);
  });

  const netLinks = useMemo<NetLink[]>(() => {
    const at = (k: string) => {
      const a = anchors.get(k)!;
      return new THREE.Vector3(a.x, a.y1 + 0.04, a.z);
    };
    // Highest headquarters roof near the straight line between the ends, for the arc to clear.
    const clearance = (p: THREE.Vector3, q: THREE.Vector3) => {
      let h = 0;
      const seg = new THREE.Line3(new THREE.Vector3(p.x, 0, p.z), new THREE.Vector3(q.x, 0, q.z));
      const c = new THREE.Vector3();
      for (const t of scene.towers) {
        const o = new THREE.Vector3(t.x, 0, t.z);
        if (o.distanceTo(seg.start) < 0.1 || o.distanceTo(seg.end) < 0.1) continue;
        seg.closestPointToPoint(o, true, c);
        if (c.distanceTo(o) < t.size * 0.8) h = Math.max(h, towerTop(t) + 0.6);
      }
      return Math.round(h * 100) / 100;
    };
    return net.shown.map(({ l, level }) => {
      const from = at(l.a);
      const to = at(l.b);
      return { id: l.id, type: l.type, status: l.status, from, to, clear: clearance(from, to), level, flow: l.directed && l.status === "active" && level !== "dim" };
    });
  }, [net, anchors, scene]);

  // Frame both ends of a selected connection.
  useEffect(() => {
    const l = net.picked;
    const a = l && anchors.get(l.a);
    const b = l && anchors.get(l.b);
    if (!a || !b) return;
    framing.current = null;
    touched.current = true;
    const span = Math.hypot(a.x - b.x, a.z - b.z);
    const dist = THREE.MathUtils.clamp(span * 1.7 + Math.max(a.y1, b.y1) * 2, controls.minDistance, fitDist.current * 0.8);
    goto(new THREE.Vector3((a.x + b.x) / 2, TERRACE_H + 0.5, (a.z + b.z) / 2), dist, false, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net.picked?.id]);

  const hl = (key: string | null) => (key ? anchors.get(key) : undefined);
  const terraceOf = (id?: string) => (id ? scene.terraces.find((t) => t.id === id) : undefined);
  return (
    <>
      <Sky mode={lightMode} reduced={reduced} m={m} sun={light} fog={fog} />
      <Bloom />
      <Traffic scene={scene} g={g} m={m} moving={!reduced} />
      {traffic && <Vehicles scene={scene} g={g} m={m} moving={!reduced} />}
      <directionalLight ref={light} castShadow intensity={2.5} color="#fff0d2" shadow-mapSize={[4096, 4096]} shadow-bias={-0.0004} shadow-normalBias={0.03} />
      <Terrain scene={scene} g={g} m={m} onTerrace={terracePick} />
      <Landscape scene={scene} g={g} m={m} />
      <Houses houses={scene.houses} g={g} m={m} pick={pick} />
      <Towers towers={scene.towers} strays={scene.strays} health={health} g={g} m={m} pick={pick} />
      <ActivityGlow towers={scene.towers} houses={scene.houses} states={activity} g={g} m={m} reduced={reduced} />
      <Outline a={hl(hover !== selKey ? hover : null)} color="#fff6d8" />
      <Outline a={hl(selKey)} color="#c9a35a" ring />
      {net.picked && <Outline a={hl(net.picked.a)} color="#c9a35a" />}
      {net.picked && <Outline a={hl(net.picked.b)} color="#c9a35a" />}
      {netLinks.length > 0 && <Network links={netLinks} hover={hoverLink} moving={linksMoving && !reduced} onHover={onLinkHover} onPick={onLinkPick} />}
      <TerraceGlow t={terraceOf(selectedDistrict)} strong />
      {hoverDistrict !== selectedDistrict && <TerraceGlow t={terraceOf(hoverDistrict)} />}
    </>
  );
}

/** A slightly larger back-faced shell behind a building, which reads as an outline. */
const BOX_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function Outline({ a, color, ring }: { a?: { x: number; z: number; y0: number; y1: number; w: number; d: number }; color: string; ring?: boolean }) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const r = ringRef.current;
    if (!r) return;
    const t = (clock.elapsedTime % 1.8) / 1.8;
    r.scale.setScalar(0.85 + t * 0.45);
    (r.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
  });
  if (!a) return null;
  const pad = 0.12;
  return (
    <group>
      {/* Crisp edges rather than a solid silhouette, so the facade stays visible. */}
      <lineSegments position={[a.x, (a.y0 + a.y1) / 2, a.z]} scale={[a.w + pad, a.y1 - a.y0 + pad, a.d + pad]} geometry={BOX_EDGES} raycast={() => null}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      <mesh position={[a.x, (a.y0 + a.y1) / 2, a.z]} scale={[a.w + pad * 2, a.y1 - a.y0 + pad * 2, a.d + pad * 2]} raycast={() => null}>
        <boxGeometry />
        {/* A faint glaze; kept light so the building's signs and details stay readable. */}
        <meshBasicMaterial color={color} transparent opacity={ring ? 0.05 : 0.1} depthWrite={false} />
      </mesh>
      {ring && (
        <mesh ref={ringRef} position={[a.x, a.y0 + 0.05, a.z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
          <ringGeometry args={[Math.max(a.w, a.d) * 0.75, Math.max(a.w, a.d) * 0.75 + 0.08, 48]} />
          <meshBasicMaterial color="#c9a35a" transparent depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** A warm rim around a terrace when its project is hovered or selected. */
function TerraceGlow({ t, strong }: { t?: { x: number; z: number; w: number; d: number }; strong?: boolean }) {
  if (!t) return null;
  const y = TERRACE_H + 0.035;
  const k = 0.07;
  const bars: [number, number, number, number][] = [
    [t.x + t.w / 2, t.z, t.w, k],
    [t.x + t.w / 2, t.z + t.d, t.w, k],
    [t.x, t.z + t.d / 2, k, t.d],
    [t.x + t.w, t.z + t.d / 2, k, t.d],
  ];
  return (
    <group>
      {bars.map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, y, z]} raycast={() => null}>
          <boxGeometry args={[w, 0.03, d]} />
          <meshBasicMaterial color={strong ? "#e2c27a" : "#fff3cf"} transparent opacity={strong ? 1 : 0.8} />
        </mesh>
      ))}
    </group>
  );
}

export default Map3D;
