import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { AiAgentLabel } from "../../components/AgentIdentity";
import { useIntel } from "../../intel/state";
import { agentStatuses, type IdentityStatus } from "../../registry/agentStatus";
import { identityFor } from "../../registry/identity";
import { buildRegistry } from "../../registry/registry";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { useTasks } from "../../tasks/store";
import type { StoredTask } from "../../tasks/types";
import { useFreeTimeRequests } from "../../routine/freeTime";
import { activityText, planRoutine, segmentAt, type Routine, type RoutineEnv, type Segment } from "../../routine/routine";
import type { OpRun } from "../../routine/operations";
import { publishRoutines, publishWhere, routineOverride, useRoutineHeld, useRoutineOps } from "../../routine/useRoutineOps";
import { figureParts, partMatrix, poseBones, FIGURE_SCALE, RIG, type FigurePart } from "./agentFigures";
import { agentPositions, setFollowedAgent, useFollowedAgent, viewOffice } from "./agentFollow";
import { AgentTaskCard } from "./AgentTaskCard";
import { selectCityAgent, useCityAgents } from "./cityAgentsStore";
import { namedAgentAt, type NamedAgent, type NamedAgentPlan } from "./namedAgentPlan";
import { routineEnv, type CityPlaces, type CityRoutes } from "./routinePlaces";
import { CityRides, withTrips } from "./agentRides";
import { routinePose } from "./routinePose";
import { hideGait, newGait, stepGait, type Gait } from "./walkerFigure";
import { yachtLivePose } from "./yachtRidePlan";
import { wake } from "../../lib/power";

/**
 * The 17 named agents as characters in the city, each built from its illustrated avatar
 * (registry/cityFigures.ts). One character per identity: automations and skills show their persona
 * in lists but never add a second figure.
 *
 * Each one lives its day by its routine (routine/routine.ts): free time, the walk to the office
 * ahead of a scheduled run, its own desk in the Inside view while the run works, then free time
 * again (the park, other districts, the train, the yacht, the Ferris wheel, the Atlas Gold Jet, the
 * arena, home). The routine is worked out from real run events and the wall clock, so it never
 * drives or judges the work, and a reload picks up exactly where it was. Without the city places
 * (a layout with no streets) the agents fall back to standing at their workplaces (namedAgentPlan.ts).
 *
 * Draws in four calls whatever the team size: every figure's boxes, every figure's balls, the
 * portrait badges (one atlas texture, billboards a fixed size on screen) and the activity rings.
 * Pointing at a character names it; a click or tap opens its profile card. Reduced motion keeps
 * everyone standing still and places walkers every two seconds without a stride.
 */
const OPEN: StoredTask["status"][] = ["running", "awaiting_approval", "blocked", "queued"];
/** Badge sizes on screen in CSS pixels, near and far, and how far above the head it floats. */
const BADGE = { near: 34, far: 22, nearAt: 8, farAt: 40, lift: 0.075, tile: 128, cols: 5 } as const;
const HIT_PX = 20;
const dir = new THREE.Vector3();

export interface AgentWork {
  status: IdentityStatus;
  /** The task it is working on or waiting on, most urgent first. */
  task: StoredTask | null;
  /** A real task is running, or verified telemetry says it is working: the only time the ring shows. */
  active: boolean;
}

/** Each persona's status and current task, from the same sources as the Agents tab and Task Center. */
export function useAgentWork(personaIds: string[]): Map<string, AgentWork> {
  const { catalog, repos } = useAtlas();
  const { telemetry: intel } = useIntel();
  const tasks = useTasks();
  const statuses = useMemo(() => agentStatuses(catalog.agents, new Map(buildRegistry(catalog, repos, intel).map((e) => [e.profile.id, e.telemetry]))), [catalog, repos, intel]);
  return useMemo(() => {
    const out = new Map<string, AgentWork>();
    const byPersona = new Map<string, StoredTask[]>();
    for (const t of tasks) {
      if (!t.agentId || !OPEN.includes(t.status)) continue;
      const persona = identityFor(t.agentId, catalog.agents).personaId;
      byPersona.set(persona, [...(byPersona.get(persona) ?? []), t]);
    }
    for (const id of personaIds) {
      const open = (byPersona.get(id) ?? []).sort((a, b) => OPEN.indexOf(a.status) - OPEN.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt));
      const status = statuses.get(id)?.status ?? "unknown", task = open[0] ?? null;
      out.set(id, { status, task, active: task?.status === "running" || status === "working" });
    }
    return out;
  }, [tasks, statuses, catalog.agents, personaIds]);
}

/** The portrait badges' atlas: each avatar clipped to a circle inside its accent ring, initials until it loads. */
function useBadgeAtlas(agents: NamedAgent[]) {
  const texture = useMemo(() => {
    const T = BADGE.tile, rows = Math.max(1, Math.ceil(agents.length / BADGE.cols));
    const canvas = document.createElement("canvas");
    canvas.width = T * BADGE.cols;
    canvas.height = T * rows;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const g = canvas.getContext("2d");
    if (!g) return tex;
    agents.forEach((a, i) => {
      const cx = (i % BADGE.cols) * T + T / 2, cy = Math.floor(i / BADGE.cols) * T + T / 2;
      const ring = () => {
        g.fillStyle = "#ffffff";
        g.beginPath();
        g.arc(cx, cy, T / 2 - 1, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = a.identity.accent;
        g.beginPath();
        g.arc(cx, cy, T / 2 - 7, 0, Math.PI * 2);
        g.fill();
      };
      ring();
      g.fillStyle = "#ffffff";
      g.font = `700 ${T * 0.34}px Inter, -apple-system, sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(a.identity.initials, cx, cy + 2);
      if (!a.identity.portrait) return;
      const img = new Image();
      img.onload = () => {
        ring();
        g.save();
        g.beginPath();
        g.arc(cx, cy, T / 2 - 13, 0, Math.PI * 2);
        g.clip();
        g.drawImage(img, cx - T / 2 + 13, cy - T / 2 + 13, T - 26, T - 26);
        g.restore();
        tex.needsUpdate = true;
      };
      img.src = a.identity.portrait;
    });
    tex.needsUpdate = true;
    return tex;
  }, [agents]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

const BADGE_VERTEX = /* glsl */ `
attribute float aTile;
uniform vec2 uGrid;
uniform vec2 uViewport;
uniform float uPx;
varying vec2 vUv;
void main() {
  vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float shown = length(instanceMatrix[0].xyz);
  // A fixed size on screen that grows a little as the camera comes close (uPx is set each frame).
  vec4 clip = projectionMatrix * center;
  clip.xy += position.xy * uPx * shown * 2.0 / uViewport * clip.w;
  gl_Position = clip;
  float col = mod(aTile, uGrid.x), row = floor(aTile / uGrid.x);
  vUv = vec2((col + uv.x) / uGrid.x, (uGrid.y - 1.0 - row + uv.y) / uGrid.y);
}`;
const BADGE_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
  #include <colorspace_fragment>
}`;

interface Props {
  plan: NamedAgentPlan;
  /** The city's places and street routes for the routine (routinePlaces.ts). Without them agents stand at work. */
  places?: CityPlaces;
  routes?: CityRoutes;
  /** Headquarters open in the Inside view: agents at their desks there are drawn seated. */
  open?: ReadonlySet<string>;
  /** Walk and idle; false for reduced motion or a paused map. */
  moving: boolean;
  /** The map is drawing (not hidden behind another tab). */
  drawing: boolean;
}

/** Ring colours: working, waiting for approval, failed (needs attention). */
const RING: Record<string, string> = { running: "#7ee0ff", queued: "#7ee0ff", waiting_approval: "#ffcf6e", failed: "#ff6b57" };
const NO_OPEN: ReadonlySet<string> = new Set();
const SELECTED_RING = "#d0ad69";

function openUrl(href: string) {
  if ("__TAURI_INTERNALS__" in window) void import("@tauri-apps/plugin-opener").then((m) => m.openUrl(href));
  else window.open(href, "_blank", "noopener,noreferrer");
}

export function NamedAgents({ plan, places, routes, open: insideOpen = NO_OPEN, moving, drawing }: Props) {
  const agents = plan.agents;
  const { camera, gl, size } = useThree();
  const { select, setView } = useAtlas();
  const ids = useMemo(() => agents.map((a) => a.personaId), [agents]);
  const work = useAgentWork(ids);
  const ops = useRoutineOps(ids);
  const held = useRoutineHeld();
  const freeTime = useFreeTimeRequests();
  const followed = useFollowedAgent();
  const boxes = useRef<THREE.InstancedMesh>(null), balls = useRef<THREE.InstancedMesh>(null), badges = useRef<THREE.InstancedMesh>(null), rings = useRef<THREE.InstancedMesh>(null);
  const card = useRef<THREE.Group>(null), chip = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The selected agent is shared with the City agents panel (cityAgentsStore.ts): a click here selects its row.
  const { selected, panelOpen } = useCityAgents();
  const open = selected && ids.includes(selected) ? ids.indexOf(selected) : null;
  const setOpen = (i: number | null) => selectCityAgent(i === null ? null : (ids[i] ?? null));
  const selectedRef = useRef(open);
  selectedRef.current = open;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [, setCardTick] = useState(0);

  // Each agent's day, recomputed when its runs change or the clock ticks (useRoutineOps, every 20 s while visible).
  // Trips by car and train share one set of cars and kerbs for the whole team (agentRides.ts).
  const rides = useMemo(() => (routes ? new CityRides(routes, routes.places.roads) : null), [routes]);
  const envs = useMemo(() => new Map<string, RoutineEnv | null>(ids.map((id) => {
    const env = routes ? routineEnv(routes, id) : null;
    return [id, env && rides ? withTrips(env, rides, id) : env];
  })), [ids, routes, rides]);
  const routines = useMemo(() => {
    const out = new Map<string, Routine>();
    for (const id of ids) {
      const env = envs.get(id), o = ops.ops.get(id);
      if (env && o) out.set(id, planRoutine({ personaId: id, ops: o, env, now: ops.now, held: held.has(id), outing: freeTime.get(id) ?? null }));
    }
    return out;
  }, [ids, envs, ops.ops, ops.now, held, freeTime]);
  const routinesRef = useRef(routines);
  routinesRef.current = routines;
  useEffect(() => publishRoutines(routines), [routines]);
  const openRef = useRef(insideOpen);
  openRef.current = insideOpen;
  const opsRef = useRef(ops.ops);
  opsRef.current = ops.ops;
  const workRef = useRef(work);
  workRef.current = work;

  // Static: every figure's parts, split by shape, with where each agent's run of parts starts.
  const rigs = useMemo(() => {
    let box = 0, ball = 0;
    return agents.map((a) => {
      const parts = figureParts(a.figure), b = parts.filter((p) => p.shape === "box"), s = parts.filter((p) => p.shape === "ball");
      const r = { boxes: b, balls: s, boxAt: box, ballAt: ball };
      box += b.length;
      ball += s.length;
      return r;
    });
  }, [agents]);
  const boxCount = rigs.reduce((n, r) => n + r.boxes.length, 0), ballCount = rigs.reduce((n, r) => n + r.balls.length, 0);
  const geo = useMemo(() => {
    const badge = new THREE.PlaneGeometry(1, 1);
    badge.setAttribute("aTile", new THREE.InstancedBufferAttribute(new Float32Array(agents.map((_, i) => i)), 1));
    return { box: new THREE.BoxGeometry(1, 1, 1), ball: new THREE.SphereGeometry(1, 12, 8), ring: new THREE.TorusGeometry(1, 0.14, 6, 28).rotateX(Math.PI / 2), badge };
  }, [agents]);
  useEffect(() => () => Object.values(geo).forEach((x) => x.dispose()), [geo]);
  const atlas = useBadgeAtlas(agents);
  const mat = useMemo(() => {
    const rows = Math.max(1, Math.ceil(agents.length / BADGE.cols));
    return {
      body: new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0 }),
      ring: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }),
      badge: new THREE.ShaderMaterial({ vertexShader: BADGE_VERTEX, fragmentShader: BADGE_FRAGMENT, uniforms: { uMap: { value: atlas }, uGrid: { value: new THREE.Vector2(BADGE.cols, rows) }, uViewport: { value: new THREE.Vector2(1, 1) }, uPx: { value: BADGE.far } } }),
    };
  }, [agents, atlas]);
  useEffect(() => () => Object.values(mat).forEach((x) => x.dispose()), [mat]);

  // Colours never change, so set them once.
  useEffect(() => {
    const c = new THREE.Color();
    rigs.forEach((r) => {
      r.boxes.forEach((p, k) => boxes.current?.setColorAt(r.boxAt + k, c.set(p.c)));
      r.balls.forEach((p, k) => balls.current?.setColorAt(r.ballAt + k, c.set(p.c)));
    });
    for (const m of [boxes.current, balls.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
  }, [rigs]);

  // Per-frame state, reused.
  const live = useRef({
    t: 0,
    last: -1,
    published: 0,
    gaits: [] as Gait[],
    bones: [] as THREE.Matrix4[],
    m: new THREE.Matrix4(),
    c: new THREE.Color(),
    hidden: new THREE.Matrix4().makeScale(0, 0, 0),
    at: agents.map(() => null as null | { x: number; y: number; z: number }),
    yaw: agents.map(() => 0),
    segs: agents.map(() => null as Segment | null),
    place: agents.map(() => ""),
  });
  const place = (dt: number) => {
    const L = live.current, wall = Date.now(), yacht = yachtLivePose();
    const publish = wall - L.published > 1000;
    if (publish) L.published = wall;
    let ringN = 0;
    agents.forEach((a, i) => {
      const r = rigs[i], gait = (L.gaits[i] ??= newGait()), id = a.personaId;
      const hideBody = () => {
        r.boxes.forEach((_, k) => boxes.current?.setMatrixAt(r.boxAt + k, L.hidden));
        r.balls.forEach((_, k) => balls.current?.setMatrixAt(r.ballAt + k, L.hidden));
        hideGait(gait);
      };
      const cityScale = FIGURE_SCALE * a.figure.build.height;
      const rt = routineOverride.get(id) ?? routinesRef.current.get(id);
      const seg = rt ? segmentAt(rt, wall) : null;
      L.segs[i] = seg;
      let pose = seg && places && routes ? routinePose(seg, { routes, places, personaId: id, slot: i, open: openRef.current, wall, yacht, scale: cityScale }) : null;
      if (!rt) {
        // No routine (no city places for this layout): stand at the workplace as before.
        const s = namedAgentAt(a, L.t, new Date(wall));
        pose = s.where === "home" ? null : { x: s.x, y: s.y, z: s.z, yaw: s.yaw, figure: true, badge: [s.x, s.y + RIG.top * cityScale + BADGE.lift, s.z], sit: 0, typing: false, walking: s.where === "walking", officeScale: null, place: a.workLabel };
      }
      L.place[i] = pose?.place ?? "";
      if (publish && seg) publishWhere(id, { activity: activityText(seg), place: pose?.place ?? "", note: seg.note, at: wall });
      if (!pose || !pose.badge) {
        hideBody();
        badges.current?.setMatrixAt(i, L.hidden);
        L.at[i] = null;
        agentPositions.set(id, null);
        return;
      }
      const phase = i * 1.7;
      if (pose.figure) {
        const swing = moving && pose.walking ? stepGait(gait, pose.x, pose.z, dt) : (hideGait(gait), 0);
        const still = moving && !pose.walking && !pose.sit ? 1 : 0;
        const scale = (pose.officeScale ?? FIGURE_SCALE) * a.figure.build.height;
        // Typing at the desk: both hands on the keyboard, a small alternating tap.
        const tap = pose.typing && moving ? 0.1 * Math.sin(L.t * 9 + phase) : 0;
        const reach: [number, number] | undefined = pose.typing ? [1.2 + tap, 1.2 - tap] : pose.sit ? [0.35, 0.35] : undefined;
        poseBones({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, swing, look: still * Math.sin(L.t * 0.45 + phase) * 0.35, sway: still * Math.sin(L.t * 1.1 + phase) * 0.05, scale, sit: pose.sit, reach }, a.figure.build.shoulders, L.bones);
        r.boxes.forEach((p: FigurePart, k) => boxes.current?.setMatrixAt(r.boxAt + k, partMatrix(L.bones, p, L.m)));
        r.balls.forEach((p: FigurePart, k) => balls.current?.setMatrixAt(r.ballAt + k, partMatrix(L.bones, p, L.m)));
      } else hideBody();
      const [bx, by, bz] = pose.badge;
      badges.current?.setMatrixAt(i, L.m.makeTranslation(bx, by, bz));
      L.at[i] = { x: bx, y: by - BADGE.lift, z: bz };
      L.yaw[i] = pose.yaw;
      agentPositions.set(id, [pose.x, pose.y, pose.z]);
      // The ring shows real run state only: working, waiting for approval, or failed.
      const state = opsRef.current.get(id)?.state;
      const color = state ? RING[state] : workRef.current.get(id)?.active ? RING.running : undefined;
      if (color && rings.current) {
        const pulse = moving && state !== "failed" ? 1 + Math.sin(L.t * 2.4 + phase) * 0.08 : 1;
        rings.current.setMatrixAt(ringN, L.m.compose(new THREE.Vector3(bx, by - BADGE.lift + 0.012, bz), new THREE.Quaternion(), new THREE.Vector3(0.06 * pulse, 0.06, 0.06 * pulse)));
        rings.current.setColorAt(ringN++, L.c.set(color));
      }
      // The selected agent (map or City agents panel): a wider muted-gold ring around its feet.
      if (selectedRef.current === i && rings.current) {
        rings.current.setMatrixAt(ringN, L.m.compose(new THREE.Vector3(bx, by - BADGE.lift + 0.008, bz), new THREE.Quaternion(), new THREE.Vector3(0.095, 0.05, 0.095)));
        rings.current.setColorAt(ringN++, L.c.set(SELECTED_RING));
      }
    });
    if (rings.current) {
      rings.current.count = ringN;
      if (rings.current.instanceColor) rings.current.instanceColor.needsUpdate = true;
    }
    // Which way each character faces and what it's doing, for the review shots (visual/*.visual.ts).
    if (badges.current) {
      badges.current.userData.yaw = L.yaw;
      badges.current.userData.open = [...openRef.current];
      badges.current.userData.routine = agents.map((a, i) => ({ id: a.personaId, at: L.at[i], seg: L.segs[i] && { kind: L.segs[i]!.kind, phase: L.segs[i]!.phase, activity: L.segs[i]!.activity, note: L.segs[i]!.note }, place: L.place[i] }));
    }
    for (const m of [boxes.current, balls.current, badges.current, rings.current]) if (m) m.instanceMatrix.needsUpdate = true;
  };

  useFrame((_, delta) => {
    // Hidden map: nothing is drawn, but the work itself never depended on this.
    if (!drawing) return;
    const L = live.current, dt = Math.min(delta, 0.15);
    L.t += dt;
    // Reduced motion or a paused map: no stride or idle, and walkers move on every two seconds.
    if (!moving && L.last >= 0 && L.t - L.last < 2) return updateBadge();
    place(L.last < 0 ? 0 : dt);
    L.last = L.t;
    updateBadge();
    for (const [ref, i] of [[card, open], [chip, hover]] as const) {
      const at = i === null ? null : L.at[i];
      if (ref.current) {
        ref.current.visible = !!at;
        if (at) ref.current.position.set(at.x, at.y + BADGE.lift, at.z);
      }
    }
  });
  // The open card's activity and timings refresh every second.
  useEffect(() => {
    if (open === null) return;
    const id = window.setInterval(() => setCardTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [open]);
  const updateBadge = () => {
    const u = mat.badge.uniforms;
    u.uViewport.value.set(size.width, size.height);
    // Grow from far to near with the camera's distance to where the view meets the ground.
    camera.getWorldDirection(dir);
    const d = dir.y < -0.01 ? camera.position.y / -dir.y : BADGE.farAt;
    const k = THREE.MathUtils.clamp((d - BADGE.nearAt) / (BADGE.farAt - BADGE.nearAt), 0, 1);
    u.uPx.value = BADGE.near + (BADGE.far - BADGE.near) * k;
  };

  // Pointing and tapping: hit-test the badges and figures on screen, so a small figure is still easy to tap on a phone.
  useEffect(() => {
    const el = gl.domElement.parentElement ?? gl.domElement;
    const v = new THREE.Vector3();
    let down: { x: number; y: number } | null = null;
    const hit = (e: PointerEvent | MouseEvent) => {
      const r = gl.domElement.getBoundingClientRect(), px = mat.badge.uniforms.uPx.value as number;
      let best: { i: number; d: number } | null = null;
      live.current.at.forEach((at, i) => {
        if (!at) return;
        for (const [y, reach] of [[at.y + BADGE.lift, Math.max(HIT_PX, px * 0.6)], [at.y - 0.18, HIT_PX]] as const) {
          v.set(at.x, y, at.z).project(camera);
          if (v.z > 1) continue;
          const d = Math.hypot(r.left + ((v.x + 1) / 2) * r.width - e.clientX, r.top + ((1 - v.y) / 2) * r.height - e.clientY);
          if (d < reach && (!best || d < best.d)) best = { i, d };
        }
      });
      return (best as { i: number } | null)?.i ?? null;
    };
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons) return;
      const i = hit(e);
      setHover((h) => (h === i ? h : i));
      el.style.cursor = i !== null ? "pointer" : "";
    };
    const onClick = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !gl.domElement.contains(e.target)) return;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const i = hit(e);
      if (i === null) return;
      // The agent's card, not the building behind it.
      e.stopPropagation();
      selectCityAgent(idsRef.current[i] ?? null);
      setHover(null);
    };
    el.addEventListener("pointerdown", onDown, true);
    el.addEventListener("pointermove", onMove, true);
    el.addEventListener("click", onClick, true);
    return () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("pointermove", onMove, true);
      el.removeEventListener("click", onClick, true);
      el.style.cursor = "";
    };
  }, [gl, camera, mat]);
  useEffect(() => {
    // With the City agents panel open, Escape belongs to the panel.
    if (open === null || panelOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && selectCityAgent(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, panelOpen]);
  // A new selection redraws at once, so its gold ring shows even while the map is idle.
  useEffect(() => wake(200), [open]);
  // A test hook for the review shots: open an agent's card by id (visual/agent-routine.visual.ts).
  useEffect(() => {
    const w = window as unknown as { __atlasOpenAgent?: (id: string) => void };
    w.__atlasOpenAgent = (id: string) => selectCityAgent(ids.includes(id) ? id : null);
    return () => {
      delete w.__atlasOpenAgent;
    };
  }, [ids]);

  if (!agents.length) return null;
  const shown = open !== null ? agents[open] : null;
  const hovered = hover !== null && hover !== open ? agents[hover] : null;
  const onOpenRun = (run: OpRun) => {
    if (run.source === "task") {
      focusTasks({}, run.key.replace(/^task:/, ""));
      select(null);
      setView("tasks");
    } else if (run.url) openUrl(run.url);
  };
  return (
    <group name="named-agents">
      <instancedMesh name="named-agent-boxes" ref={boxes} args={[geo.box, mat.body, boxCount]} frustumCulled={false} />
      <instancedMesh name="named-agent-balls" ref={balls} args={[geo.ball, mat.body, ballCount]} frustumCulled={false} />
      <instancedMesh name="named-agent-badges" ref={badges} args={[geo.badge, mat.badge, agents.length]} frustumCulled={false} renderOrder={2} />
      <instancedMesh name="named-agent-activity" ref={rings} args={[geo.ring, mat.ring, agents.length + 1]} frustumCulled={false} />
      <group ref={chip}>
        {hovered && (
          <Html zIndexRange={[40, 30]} style={{ pointerEvents: "none" }}>
            <div className="m3-agent-chip">
              <b>{hovered.identity.name}</b>
              <span>{hovered.identity.role}</span>
              <AiAgentLabel />
            </div>
          </Html>
        )}
      </group>
      <group ref={card}>
        {shown && open !== null && !panelOpen && (
          // Docked in the map's top corner, not floating over the agent: it stays readable while the agent walks or the camera follows.
          <Html zIndexRange={[60, 50]} calculatePosition={() => [Math.max(8, size.width - 312), 12]}>
            <AgentTaskCard
              identity={shown.identity}
              status={work.get(shown.personaId)?.status ?? "unknown"}
              workLabel={shown.workLabel}
              ops={ops.ops.get(shown.personaId)}
              seg={live.current.segs[open]}
              place={live.current.place[open]}
              now={Date.now()}
              source={ops.source}
              fetchedAt={ops.fetchedAt}
              following={followed === shown.personaId}
              hasOffice={!!places?.agents.get(shown.personaId)?.desk}
              docked
              onClose={() => setOpen(null)}
              onFollow={() => setFollowedAgent(followed === shown.personaId ? null : shown.personaId)}
              onViewOffice={() => {
                const desk = places?.agents.get(shown.personaId)?.desk;
                // Its own building and floor, following it so its desk (or wherever it is now) stays in view.
                if (desk) viewOffice({ towerKey: desk.towerKey, projectId: desk.towerKey.replace(/^project:/, ""), personaId: shown.personaId, floor: desk.floor });
              }}
              onOpenRun={onOpenRun}
              onProfile={() => select({ kind: "agent", id: shown.personaId })}
            />
          </Html>
        )}
      </group>
    </group>
  );
}
