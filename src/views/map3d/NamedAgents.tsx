import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { AgentAvatar, AiAgentLabel } from "../../components/AgentIdentity";
import { useIntel } from "../../intel/state";
import { agentStatuses, IDENTITY_STATUS_LABEL, type IdentityStatus } from "../../registry/agentStatus";
import { identityFor } from "../../registry/identity";
import { buildRegistry } from "../../registry/registry";
import { useAtlas } from "../../state";
import { focusTasks } from "../../tasks/focus";
import { useTasks } from "../../tasks/store";
import type { StoredTask } from "../../tasks/types";
import { figureParts, partMatrix, poseBones, FIGURE_SCALE, RIG, type FigurePart } from "./agentFigures";
import { namedAgentAt, type NamedAgent, type NamedAgentPlan } from "./namedAgentPlan";
import { hideGait, newGait, stepGait, type Gait } from "./walkerFigure";

/**
 * The 17 named agents as characters in the city, each built from its illustrated avatar
 * (registry/cityFigures.ts) and placed at its real workplace (namedAgentPlan.ts). One character per
 * identity: automations and skills show their persona in lists but never add a second figure.
 *
 * Draws in four calls whatever the team size: every figure's boxes, every figure's balls, the
 * portrait badges (one atlas texture, billboards a fixed size on screen) and the activity rings.
 * Pointing at a character names it; a click or tap opens its profile card. Reduced motion keeps
 * everyone standing still and places walkers every two seconds without a stride.
 */
const OPEN: StoredTask["status"][] = ["running", "awaiting_approval", "blocked", "queued"];
const TASK_LABEL: Record<StoredTask["status"], string> = { running: "Running", awaiting_approval: "Waiting for approval", blocked: "Blocked", queued: "Queued", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
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
  /** Walk and idle; false for reduced motion or a paused map. */
  moving: boolean;
  /** The map is drawing (not hidden behind another tab). */
  drawing: boolean;
}

export function NamedAgents({ plan, moving, drawing }: Props) {
  const agents = plan.agents;
  const { camera, gl, size } = useThree();
  const { select, setView } = useAtlas();
  const work = useAgentWork(useMemo(() => agents.map((a) => a.personaId), [agents]));
  const boxes = useRef<THREE.InstancedMesh>(null), balls = useRef<THREE.InstancedMesh>(null), badges = useRef<THREE.InstancedMesh>(null), rings = useRef<THREE.InstancedMesh>(null);
  const card = useRef<THREE.Group>(null), chip = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

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
      ring: new THREE.MeshBasicMaterial({ color: "#7ee0ff", transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false }),
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
  const live = useRef({ t: 0, last: -1, gaits: [] as Gait[], bones: [] as THREE.Matrix4[], m: new THREE.Matrix4(), hidden: new THREE.Matrix4().makeScale(0, 0, 0), at: agents.map(() => null as null | { x: number; y: number; z: number }), yaw: agents.map(() => 0) });
  const place = (dt: number) => {
    const L = live.current, now = new Date();
    let ringN = 0;
    agents.forEach((a, i) => {
      const r = rigs[i], s = namedAgentAt(a, L.t, now), gait = (L.gaits[i] ??= newGait());
      const hideAll = () => {
        r.boxes.forEach((_, k) => boxes.current?.setMatrixAt(r.boxAt + k, L.hidden));
        r.balls.forEach((_, k) => balls.current?.setMatrixAt(r.ballAt + k, L.hidden));
        badges.current?.setMatrixAt(i, L.hidden);
        hideGait(gait);
        L.at[i] = null;
      };
      if (s.where === "home") return hideAll();
      const walking = s.where === "walking";
      const swing = moving ? stepGait(gait, s.x, s.z, dt) : 0;
      // Idle: a slow look around and a little arm sway, each figure on its own phase.
      const phase = i * 1.7, idle = moving && !walking ? 1 : 0;
      const scale = FIGURE_SCALE * a.figure.build.height;
      poseBones({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, swing, look: idle * Math.sin(L.t * 0.45 + phase) * 0.35, sway: idle * Math.sin(L.t * 1.1 + phase) * 0.05, scale }, a.figure.build.shoulders, L.bones);
      r.boxes.forEach((p: FigurePart, k) => boxes.current?.setMatrixAt(r.boxAt + k, partMatrix(L.bones, p, L.m)));
      r.balls.forEach((p: FigurePart, k) => balls.current?.setMatrixAt(r.ballAt + k, partMatrix(L.bones, p, L.m)));
      const top = s.y + RIG.top * scale;
      badges.current?.setMatrixAt(i, L.m.makeTranslation(s.x, top + BADGE.lift, s.z));
      L.at[i] = { x: s.x, y: top, z: s.z };
      L.yaw[i] = s.yaw;
      if (work.get(a.personaId)?.active && rings.current) {
        const pulse = moving ? 1 + Math.sin(L.t * 2.4 + phase) * 0.08 : 1;
        rings.current.setMatrixAt(ringN++, L.m.compose(new THREE.Vector3(s.x, top + 0.012, s.z), new THREE.Quaternion(), new THREE.Vector3(0.06 * pulse, 0.06, 0.06 * pulse)));
      }
    });
    if (rings.current) rings.current.count = ringN;
    // Which way each character faces, for the review shots (visual/named-agents.visual.ts).
    if (badges.current) badges.current.userData.yaw = L.yaw;
    for (const m of [boxes.current, balls.current, badges.current, rings.current]) if (m) m.instanceMatrix.needsUpdate = true;
  };

  useFrame((_, delta) => {
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
  const updateBadge = () => {
    const u = mat.badge.uniforms;
    u.uViewport.value.set(size.width, size.height);
    // Grow from far to near with the camera's distance to its target.
    // Distance to where the view meets the ground.
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
      // The agent's profile, not the building behind it.
      e.stopPropagation();
      setOpen(i);
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
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!agents.length) return null;
  const shown = open !== null ? agents[open] : null, w = shown ? work.get(shown.personaId) : undefined;
  const hovered = hover !== null && hover !== open ? agents[hover] : null;
  return (
    <group name="named-agents">
      <instancedMesh name="named-agent-boxes" ref={boxes} args={[geo.box, mat.body, boxCount]} frustumCulled={false} />
      <instancedMesh name="named-agent-balls" ref={balls} args={[geo.ball, mat.body, ballCount]} frustumCulled={false} />
      <instancedMesh name="named-agent-badges" ref={badges} args={[geo.badge, mat.badge, agents.length]} frustumCulled={false} renderOrder={2} />
      <instancedMesh name="named-agent-activity" ref={rings} args={[geo.ring, mat.ring, agents.length]} frustumCulled={false} />
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
        {shown && (
          <Html zIndexRange={[60, 50]}>
            <div className="m3-agent-profile" role="dialog" aria-label={`${shown.identity.name}, ${shown.identity.role}, AI agent`} onPointerDown={(e) => e.stopPropagation()}>
              <button type="button" className="x" aria-label="Close" onClick={() => setOpen(null)}>
                ×
              </button>
              <div className="who">
                <AgentAvatar identity={shown.identity} size={44} status={w?.status} />
                <div>
                  <div className="n">{shown.identity.name}</div>
                  <div className="r">{shown.identity.role}</div>
                  <AiAgentLabel />
                </div>
              </div>
              <dl>
                <dt>Building</dt>
                <dd>{shown.workLabel}</dd>
                <dt>Status</dt>
                <dd>{IDENTITY_STATUS_LABEL[w?.status ?? "unknown"]}</dd>
                <dt>Task</dt>
                <dd>{w?.task ? `${w.task.title} · ${TASK_LABEL[w.task.status]}` : "No open task"}</dd>
              </dl>
              <div className="acts">
                {w?.task && (
                  <button
                    type="button"
                    onClick={() => {
                      focusTasks({}, w.task!.id);
                      select(null);
                      setView("tasks");
                    }}
                  >
                    Open task
                  </button>
                )}
                <button type="button" onClick={() => select({ kind: "agent", id: shown.personaId })}>
                  Full profile
                </button>
              </div>
            </div>
          </Html>
        )}
      </group>
    </group>
  );
}
