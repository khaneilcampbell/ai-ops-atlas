import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { relative } from "../../lib/time";
import { STATE_COLOR } from "./textures";
import type { HologramData, OrgBand, RunMark } from "./officeOrg";
import { RUN_SLOTS } from "./officeOrg";

/**
 * The glass data view over an agent: a panel of what Atlas has verified about its work, two
 * small tiles beside it and a light stream rising from the monitor. Drawn only for the hovered
 * or selected desk, so the office keeps its frame budget. The stream flows only while a run is
 * observed in progress; otherwise it holds still.
 */

const GLASS = "#bfeaf5";
const LINE = "rgba(150,236,255,0.95)";
const INK = "#effcff";
const SOFT = "rgba(220,244,252,0.74)";
const FONT = "Inter, -apple-system, 'Segoe UI', sans-serif";
const RUN_COLOR: Record<RunMark, string> = { success: "#7fe0a0", failure: "#ff8a78", running: "#8fe6ff", other: "#b9c7cc" };

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Word-wraps into at most `lines` lines, the last one ellipsized. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number) {
  const out: string[] = [];
  let line = "";
  const words = text.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= max) line = next;
    else {
      out.push(line);
      line = words[i];
      if (out.length === lines - 1) {
        out.push(fit(ctx, words.slice(i).join(" "), max));
        return out;
      }
    }
  }
  if (line) out.push(line);
  return out;
}

/** Translucent glass card with a bright outline and corner ticks, the reference's tile language. */
function glassCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, "rgba(22,92,112,0.80)");
  g.addColorStop(1, "rgba(8,44,58,0.74)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * 26, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * 26);
    ctx.stroke();
  }
}

/** The run strip: one bar per observed run, oldest on the left. Empty slots stay outlined. */
function runBars(ctx: CanvasRenderingContext2D, runs: RunMark[], x: number, y: number, w: number, h: number) {
  const gap = 8;
  const bw = (w - gap * (RUN_SLOTS - 1)) / RUN_SLOTS;
  const offset = RUN_SLOTS - runs.length;
  for (let i = 0; i < RUN_SLOTS; i++) {
    const bx = x + i * (bw + gap);
    const r = i >= offset ? runs[i - offset] : null;
    if (!r) {
      ctx.strokeStyle = "rgba(214,247,255,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, y + h * 0.55, bw, h * 0.45);
      continue;
    }
    // Height is a fixed code per result, not a measurement: success tall, failure short.
    const bh = r === "success" ? h : r === "running" ? h * 0.75 : r === "failure" ? h * 0.42 : h * 0.3;
    ctx.fillStyle = RUN_COLOR[r];
    ctx.fillRect(bx, y + h - bh, bw, bh);
  }
}

/** The main panel: identity and team, verified state, run strip, latest run, goal and tasks. */
export function hologramTexture(d: HologramData) {
  const W = 1024;
  const H = 760;
  const [c, ctx] = makeCanvas(W, H);
  glassCard(ctx, 8, 8, W - 16, H - 16, 26);
  const state = STATE_COLOR[d.state];
  // Status ring, after the reference's circular indicators: full while running, a quarter when unknown.
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(214,247,255,0.25)";
  ctx.beginPath();
  ctx.arc(96, 98, 46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = state;
  const sweep = d.successPct != null ? d.successPct / 100 : d.state === "unknown" ? 0 : 1;
  ctx.beginPath();
  ctx.arc(96, 98, 46, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.font = `700 26px ${FONT}`;
  ctx.fillText(d.successPct != null ? `${d.successPct}%` : "—", 96, 108);
  ctx.textAlign = "left";

  ctx.fillStyle = INK;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(fit(ctx, d.name, 820), 170, 82);
  ctx.fillStyle = SOFT;
  ctx.font = `500 25px ${FONT}`;
  ctx.fillText(fit(ctx, d.team, 820), 170, 120);

  // State pill
  ctx.font = `700 25px ${FONT}`;
  const pill = d.stateLabel.toUpperCase();
  const pw = ctx.measureText(pill).width + 52;
  ctx.fillStyle = "rgba(8,32,40,0.55)";
  ctx.beginPath();
  ctx.roundRect(40, 168, pw, 46, 23);
  ctx.fill();
  ctx.fillStyle = state;
  ctx.beginPath();
  ctx.arc(64, 191, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.fillText(pill, 82, 200);
  ctx.fillStyle = SOFT;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText(fit(ctx, `Source · ${d.source}`, W - pw - 120), 60 + pw, 199);
  ctx.font = `400 23px ${FONT}`;
  ctx.fillStyle = INK;
  wrap(ctx, d.reason, W - 80, 2).forEach((l, i) => ctx.fillText(l, 40, 252 + i * 30));

  // Run strip
  ctx.fillStyle = SOFT;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText("RECENT RUNS", 40, 334);
  runBars(ctx, d.runs, 40, 346, 440, 90);
  ctx.font = `500 21px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.fillText(fit(ctx, d.runsCaption, 440), 40, 470);
  if (d.latest) {
    ctx.fillStyle = SOFT;
    ctx.fillText(fit(ctx, `Latest · ${d.latest.label}`, 440), 40, 502);
    ctx.fillText(relative(d.latest.at), 40, 532);
  }

  // Goal and responsibilities
  ctx.strokeStyle = "rgba(214,247,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(512, 320);
  ctx.lineTo(512, 590);
  ctx.stroke();
  ctx.fillStyle = SOFT;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText("GOAL", 540, 334);
  ctx.fillStyle = INK;
  ctx.font = `500 22px ${FONT}`;
  const goal = wrap(ctx, d.goal ?? "Not documented", 440, 2);
  goal.forEach((l, i) => ctx.fillText(l, 540, 366 + i * 28));
  ctx.fillStyle = SOFT;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText("RESPONSIBILITIES", 540, 446);
  ctx.font = `400 21px ${FONT}`;
  ctx.fillStyle = INK;
  const tasks = d.tasks.length ? d.tasks : ["Not documented"];
  tasks.forEach((t, i) => ctx.fillText(fit(ctx, `• ${t}`, 440), 540, 478 + i * 30));
  if (d.autonomy != null) {
    ctx.fillStyle = SOFT;
    ctx.font = `500 20px ${FONT}`;
    ctx.fillText(`Autonomy level ${d.autonomy} of 4`, 540, 588);
  }

  // Home and work: who this is and where it belongs, wherever it is drawn. Placement only.
  ctx.strokeStyle = "rgba(214,247,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(40, 616);
  ctx.lineTo(W - 40, 616);
  ctx.stroke();
  const place = (title: string, p: HologramData["home"], x: number) => {
    ctx.fillStyle = SOFT;
    ctx.font = `600 20px ${FONT}`;
    ctx.fillText(p?.source === "assigned" ? `${title} · ASSIGNED BY ATLAS` : title, x, 650);
    ctx.fillStyle = INK;
    ctx.font = `500 22px ${FONT}`;
    wrap(ctx, p?.label ?? "Not documented", 440, 2).forEach((l, i) => ctx.fillText(l, x, 682 + i * 28));
  };
  place("HOME", d.home, 40);
  place("WORK BUILDING", d.work, 540);
  return tex(c);
}

/** A small side tile: a document glyph or a bar-chart glyph, with a one-line caption. */
function tileTexture(kind: "doc" | "chart", caption: string, runs: RunMark[]) {
  const [c, ctx] = makeCanvas(256, 256);
  glassCard(ctx, 6, 6, 244, 244, 18);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 5;
  if (kind === "doc") {
    ctx.beginPath();
    ctx.moveTo(78, 40);
    ctx.lineTo(150, 40);
    ctx.lineTo(180, 70);
    ctx.lineTo(180, 176);
    ctx.lineTo(78, 176);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(96, 92 + i * 20);
      ctx.lineTo(i === 3 ? 136 : 162, 92 + i * 20);
      ctx.stroke();
    }
  } else {
    // Same observed runs as the panel, drawn bigger: the tile repeats data, never adds it.
    const last = runs.slice(-6);
    for (let i = 0; i < 6; i++) {
      const r = last[i - (6 - last.length)];
      const bx = 52 + i * 26;
      if (!r) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.strokeRect(bx, 140, 18, 36);
        continue;
      }
      const bh = r === "success" ? 130 : r === "running" ? 96 : r === "failure" ? 56 : 40;
      ctx.fillStyle = RUN_COLOR[r];
      ctx.fillRect(bx, 176 - bh, 18, bh);
    }
  }
  ctx.fillStyle = INK;
  ctx.font = `600 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.fillText(fit(ctx, caption, 220), 128, 222);
  return tex(c);
}

/** A soft streak texture; scrolling it along the tube reads as data flowing. */
function streamTexture() {
  const [c, ctx] = makeCanvas(256, 16);
  const g = ctx.createLinearGradient(0, 0, 256, 0);
  for (let i = 0; i <= 4; i++) {
    g.addColorStop(i / 4, i % 2 ? "rgba(160,240,255,0.95)" : "rgba(60,180,220,0.05)");
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 16);
  const t = tex(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(3, 1);
  return t;
}

const PANEL_Y = 2.95;

/** Turns a child to face the camera, undoing its parents' rotation. */
function useFaceCamera(ref: React.RefObject<THREE.Object3D>) {
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ camera }) => {
    const o = ref.current;
    if (!o?.parent) return;
    o.parent.getWorldQuaternion(q);
    o.quaternion.copy(q.invert().multiply(camera.quaternion));
  });
}

// The panel and tiles draw over the room (no depth test), like a heads-up display, so a sign or a
// nearby desk never cuts through the data.
export function AgentHologram({ data, reduced }: { data: HologramData; reduced: boolean }) {
  const panel = useMemo(() => hologramTexture(data), [data]);
  const chart = useMemo(() => tileTexture("chart", data.runs.length ? `${data.runs.length} runs` : "No runs", data.runs), [data.runs]);
  const doc = useMemo(() => tileTexture("doc", data.tasks.length ? `${data.tasks.length} duties` : "Not documented", []), [data.tasks.length]);
  const stream = useMemo(streamTexture, []);
  useEffect(() => () => panel.dispose(), [panel]);
  useEffect(() => () => chart.dispose(), [chart]);
  useEffect(() => () => doc.dispose(), [doc]);
  useEffect(() => () => stream.dispose(), [stream]);
  const face = useRef<THREE.Group>(null);
  const float = useRef<THREE.Group>(null);
  useFaceCamera(face);
  const running = data.state === "working";
  // Rising from the monitor (desk-local), curling once, into the bottom of the panel.
  const tube = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.45, -0.22), new THREE.Vector3(0.35, 1.7, 0.05), new THREE.Vector3(-0.3, 1.86, 0.15), new THREE.Vector3(0.05, 2.03, 0)]);
    return new THREE.TubeGeometry(curve, 48, 0.012, 6, false);
  }, []);
  useEffect(() => () => tube.dispose(), [tube]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (running && !reduced) stream.offset.x = -t * 0.6;
    if (float.current && !reduced) float.current.position.y = Math.sin(t * 1.3) * 0.03;
  });
  return (
    <group raycast={() => null}>
      <mesh geometry={tube} raycast={() => null}>
        <meshBasicMaterial map={stream} color={running ? "#9ff0ff" : "#7fc9dc"} transparent opacity={running ? 0.95 : 0.45} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <group ref={float}>
        <group ref={face} position={[0, PANEL_Y, 0]}>
          <mesh renderOrder={10} raycast={() => null}>
            <planeGeometry args={[2.5, 1.855]} />
            <meshBasicMaterial map={panel} transparent depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[-1.66, -0.22, -0.12]} renderOrder={10} raycast={() => null}>
            <planeGeometry args={[0.66, 0.66]} />
            <meshBasicMaterial map={chart} transparent opacity={0.92} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[1.66, -0.22, -0.12]} renderOrder={10} raycast={() => null}>
            <planeGeometry args={[0.66, 0.66]} />
            <meshBasicMaterial map={doc} transparent opacity={0.92} depthWrite={false} depthTest={false} toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, -0.97, -0.01]} raycast={() => null}>
            <planeGeometry args={[1.6, 0.012]} />
            <meshBasicMaterial color={GLASS} transparent opacity={0.6} depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- organization

function signTexture(b: OrgBand) {
  const [c, ctx] = makeCanvas(512, 200);
  glassCard(ctx, 6, 6, 500, 188, 16);
  ctx.fillStyle = INK;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(fit(ctx, b.label, 460), 28, 66);
  ctx.fillStyle = SOFT;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(`${b.count} ${b.count === 1 ? "agent" : "agents"}`, 28, 112);
  ctx.fillStyle = b.activity ? "#ffe2a6" : SOFT;
  ctx.font = `500 26px ${FONT}`;
  ctx.fillText(fit(ctx, b.activity ?? "Nothing needs you", 460), 28, 158);
  return tex(c);
}

function BandSign({ band }: { band: OrgBand }) {
  const map = useMemo(() => signTexture(band), [band]);
  useEffect(() => () => map.dispose(), [map]);
  const face = useRef<THREE.Group>(null);
  useFaceCamera(face);
  const cz = (band.minZ + band.maxZ) / 2 + 0.3;
  return (
    <group position={[band.minX - 1.55, 0, cz]}>
      <mesh position={[0, 0.6, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.018, 0.018, 1.2, 8]} />
        <meshStandardMaterial color="#a8aea6" metalness={0.6} roughness={0.35} />
      </mesh>
      <group ref={face} position={[0, 1.42, 0]}>
        <mesh raycast={() => null}>
          <planeGeometry args={[1.3, 0.51]} />
          <meshBasicMaterial map={map} transparent depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

/** Each role tier's row: a glass outline on the floor and a sign at its head. */
export function OrgBands({ bands }: { bands: OrgBand[] }) {
  return (
    <group>
      {bands.map((b) => {
        const w = b.maxX - b.minX + 2.2;
        const d = b.maxZ - b.minZ + 2.35;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2 + 0.25;
        return (
          <group key={b.tier}>
            {[
              [cx, cz - d / 2, w, 0.03],
              [cx, cz + d / 2, w, 0.03],
              [cx - w / 2, cz, 0.03, d],
              [cx + w / 2, cz, 0.03, d],
            ].map(([x, z, sx, sz], i) => (
              <mesh key={i} position={[x, 0.03, z]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
                <planeGeometry args={[sx, sz]} />
                <meshBasicMaterial color={GLASS} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
              </mesh>
            ))}
            <BandSign band={b} />
          </group>
        );
      })}
    </group>
  );
}
