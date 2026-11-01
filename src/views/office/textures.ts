import * as THREE from "three";
import { SYMBOLS } from "../map3d/symbols";
import { RUNTIME_LABEL, type RuntimeState, type ToolIcon } from "./model";

/** Status colors, restrained: the office reads as calm unless something needs a person. */
export const STATE_COLOR: Record<RuntimeState, string> = {
  working: "#6fcf7c",
  awaiting: "#e7b04a",
  failed: "#d0614f",
  idle: "#a9c2b2",
  offline: "#6b716b",
  unknown: "#8d948c",
};

const REFRESH = ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16", "M8 16H3v5"];

/** Draws one of the icon set at (x, y) with size s, in the current stroke/fill color. */
export function drawIcon(ctx: CanvasRenderingContext2D, icon: ToolIcon | "atlas", x: number, y: number, s: number, color: string) {
  const def = icon === "refresh" ? { stroke: REFRESH, fill: [] as string[] } : SYMBOLS[icon];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const d of def.stroke) ctx.stroke(new Path2D(d));
  for (const d of def.fill) ctx.fill(new Path2D(d));
  ctx.restore();
}

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!] as const;
}

function texture(c: HTMLCanvasElement) {
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

const FONT = "Inter, -apple-system, 'Segoe UI', sans-serif";

/**
 * A monitor screen: the agent's icon and name, its state, and the task line from the execution
 * the state is based on. With no verified task it says so instead of inventing one.
 */
export function screenTexture(o: { name: string; icon: ToolIcon; accent: string; state: RuntimeState; task: string | null; when: string | null }) {
  const [c, ctx] = canvas(320, 200);
  const dim = o.state === "offline";
  const g = ctx.createLinearGradient(0, 0, 0, 200);
  g.addColorStop(0, dim ? "#121513" : "#16241d");
  g.addColorStop(1, dim ? "#0c0e0d" : "#0f1914");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 320, 200);
  if (dim) {
    ctx.fillStyle = "#3a403b";
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText("Offline", 20, 108);
    return texture(c);
  }
  ctx.fillStyle = o.accent;
  ctx.fillRect(0, 0, 320, 6);
  drawIcon(ctx, o.icon, 18, 20, 26, o.accent);
  ctx.fillStyle = "#e9ecdf";
  ctx.font = `600 17px ${FONT}`;
  ctx.fillText(fit(ctx, o.name, 250), 56, 39);
  const col = STATE_COLOR[o.state];
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(26, 82, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(RUNTIME_LABEL[o.state], 42, 88);
  ctx.fillStyle = "rgba(233,236,223,0.12)";
  ctx.fillRect(18, 104, 284, 1);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = o.task ? "#c8d2c4" : "#7f8b80";
  const task = o.task ?? (o.state === "unknown" ? "No live telemetry here" : "No verified task");
  ctx.fillText(fit(ctx, task, 284), 18, 132);
  if (o.when) {
    ctx.fillStyle = "#7f8b80";
    ctx.font = `13px ${FONT}`;
    ctx.fillText(fit(ctx, o.when, 284), 18, 156);
  }
  // A typing caret only while a run is observed in progress.
  if (o.state === "working") {
    ctx.fillStyle = col;
    ctx.fillRect(18, 172, 60, 4);
    ctx.globalAlpha = 0.45;
    ctx.fillRect(84, 172, 120, 4);
    ctx.globalAlpha = 1;
  }
  return texture(c);
}

/** The nameplate above a desk. */
export function plateTexture(name: string, accent: string, icon: ToolIcon) {
  const [c, ctx] = canvas(512, 96);
  ctx.fillStyle = "#f6f1e3";
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 96, 18);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.roundRect(0, 0, 96, 96, [18, 0, 0, 18]);
  ctx.fill();
  drawIcon(ctx, icon, 28, 28, 40, "#ffffff");
  ctx.fillStyle = "#1d2b22";
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(fit(ctx, name, 390), 116, 60);
  return texture(c);
}

/** The wall display: project name, repository and the verified CI line from the map. */
export function displayTexture(title: string, repo: string, line: string, agents: number) {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = "#14201a";
  ctx.fillRect(0, 0, 512, 256);
  drawIcon(ctx, "atlas", 30, 30, 34, "#c9a35a");
  ctx.fillStyle = "#c9a35a";
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText("ATLAS", 76, 54);
  ctx.fillStyle = "#e9ecdf";
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(fit(ctx, title, 450), 30, 120);
  ctx.fillStyle = "#9fb0a2";
  ctx.font = `18px ${FONT}`;
  ctx.fillText(fit(ctx, repo, 450), 30, 156);
  ctx.fillText(`${agents} registered ${agents === 1 ? "agent" : "agents"}`, 30, 190);
  ctx.fillText(fit(ctx, line, 450), 30, 222);
  return texture(c);
}
