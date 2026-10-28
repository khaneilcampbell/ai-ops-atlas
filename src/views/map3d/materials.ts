import * as THREE from "three";
import type { BuildingIdentity, BuildingStyle } from "./identity";
import { SYMBOLS, type SymbolName } from "./symbols";

/** Shared clock for animated surfaces (water, waterfalls). */
export const time = { value: 0 };
/** 0 by day, 1 at night; eased between the two by the map's lighting. Shaders read it directly. */
export const night = { value: 0 };

/**
 * Focus mode: 0 shows the map as is; toward 1, everything outside `focusRects` (x0, z0, x1, z1
 * in world units) fades to a muted grey, so the buildings in hand stand out.
 */
export const focus = { value: 0 };
export const FOCUS_MAX = 24;
export const focusRects = { value: Array.from({ length: FOCUS_MAX }, () => new THREE.Vector4()) };
export const focusCount = { value: 0 };

/** Lets any material take part in focus mode. Keeps whatever patch the material already has. */
export function focusable<T extends THREE.Material>(m: T): T {
  if (m.userData.focusable) return m;
  m.userData.focusable = true;
  const prev = m.onBeforeCompile.bind(m);
  const key = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.uFocus = focus;
    sh.uniforms.uFocusRects = focusRects;
    sh.uniforms.uFocusN = focusCount;
    sh.vertexShader = `varying vec3 vFocusW;\n${sh.vertexShader}`.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec4 fw4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fw4 = instanceMatrix * fw4;
      #endif
      vFocusW = (modelMatrix * fw4).xyz;`,
    );
    sh.fragmentShader = `varying vec3 vFocusW;\nuniform float uFocus;\nuniform vec4 uFocusRects[${FOCUS_MAX}];\nuniform int uFocusN;\n${sh.fragmentShader}`.replace(
      "#include <dithering_fragment>",
      `#include <dithering_fragment>
      if (uFocus > 0.001) {
        float inside = 0.0;
        for (int i = 0; i < ${FOCUS_MAX}; i++) {
          if (i >= uFocusN) break;
          vec4 r = uFocusRects[i];
          inside = max(inside, step(r.x, vFocusW.x) * step(vFocusW.x, r.z) * step(r.y, vFocusW.z) * step(vFocusW.z, r.w));
        }
        float l = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(l) * vec3(0.5, 0.53, 0.56), 0.62 * uFocus * (1.0 - inside));
      }`,
    );
  };
  m.customProgramCacheKey = () => `${key()}|focus`;
  return m;
}

const NOISE = /* glsl */ `
varying vec3 vWPos;
uniform float uTime;
uniform float uNight;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Each pattern tints the material's base color from world position, so any box can be any size
// (and instanced) without UV stretching.
const PATTERNS = {
  grass: /* glsl */ `
    float n = fbm(vWPos.xz * 0.9);
    float d = fbm(vWPos.xz * 5.0);
    diffuseColor.rgb *= 0.84 + 0.3 * n;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.1, 1.12, 0.86), smoothstep(0.55, 0.8, d));
    diffuseColor.rgb *= 1.0 - step(0.9, h21(floor(vWPos.xz * 18.0))) * 0.1;`,
  cliff: /* glsl */ `
    float n = fbm(vec2(vWPos.x + vWPos.z, vWPos.y * 4.0) * 2.2);
    float band = fract(vWPos.y * 2.6 + n * 0.9);
    diffuseColor.rgb *= 0.74 + 0.36 * n;
    diffuseColor.rgb *= 0.88 + 0.14 * smoothstep(0.0, 0.25, band);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.55, 0.3), smoothstep(-0.12, -0.02, vWPos.y) * 0.85);`,
  wall: /* glsl */ `
    vec2 q = vec2((vWPos.x + vWPos.z) * 3.2, vWPos.y * 7.0);
    q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
    vec2 f = fract(q);
    float mortar = clamp(step(f.x, 0.05) + step(f.y, 0.09), 0.0, 1.0);
    diffuseColor.rgb *= (0.9 + 0.14 * h21(floor(q))) * (1.0 - 0.16 * mortar);`,
  stone: /* glsl */ `
    vec2 q = vWPos.xz * 4.5;
    vec2 f = fract(q);
    float m = clamp(step(f.x, 0.06) + step(f.y, 0.06), 0.0, 1.0);
    diffuseColor.rgb *= (0.93 + 0.1 * h21(floor(q))) * (1.0 - 0.1 * m);`,
  sand: /* glsl */ `
    diffuseColor.rgb *= 0.93 + 0.12 * fbm(vWPos.xz * 3.0);`,
  water: /* glsl */ `
    float w = fbm(vWPos.xz * 0.18 + vec2(uTime * 0.02, uTime * 0.015));
    float c = smoothstep(0.66, 0.82, fbm(vWPos.xz * 0.9 - vec2(uTime * 0.06, uTime * 0.03)));
    // Fine glints drifting the other way: sunlight by day, a cool moonlit shimmer at night.
    float g = smoothstep(0.78, 0.9, fbm(vWPos.xz * 2.6 + vec2(uTime * 0.05, -uTime * 0.07)));
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.88, diffuseColor.rgb * 1.08, w) + c * 0.05 + g * 0.06;
    #define ATLAS_GLINT g`,
  falls: /* glsl */ `
    float s = fbm(vec2((vWPos.x + vWPos.z) * 9.0, vWPos.y * 2.5 + uTime * 2.2));
    diffuseColor.rgb = mix(vec3(0.5, 0.74, 0.82), vec3(0.96, 0.99, 1.0), smoothstep(0.35, 0.72, s));`,
  none: "",
} as const;

export type Pattern = keyof typeof PATTERNS;

/** Passes world position (and a per-instance seed) to the fragment shader. */
function worldPos(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.uniforms.uTime = time;
  sh.uniforms.uNight = night;
  sh.vertexShader = `varying vec3 vWPos;\nvarying vec3 vSeed;\n${sh.vertexShader}`.replace(
    "#include <project_vertex>",
    `#include <project_vertex>
    vec4 wp4 = vec4(transformed, 1.0);
    vSeed = vec3(dot(objectNormal, vec3(3.1, 5.7, 7.3)), 0.0, 0.0);
    #ifdef USE_INSTANCING
      wp4 = instanceMatrix * wp4;
      vSeed += instanceMatrix[3].xyz;
    #endif
    vWPos = (modelMatrix * wp4).xyz;`,
  );
}

/**
 * A world-patterned material. `nightGlow` adds a faint warm light at night, for paths that
 * should read as lit without real light sources.
 */
export function patterned(color: string, pattern: Pattern, opts: THREE.MeshStandardMaterialParameters = {}, nightGlow = 0) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...opts });
  if (pattern === "none") return m;
  m.onBeforeCompile = (sh) => {
    worldPos(sh);
    let frag = sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n${PATTERNS[pattern]}`);
    if (pattern === "water") frag = frag.replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(0.55, 0.7, 0.95) * ATLAS_GLINT * uNight * 0.35;");
    if (nightGlow) frag = frag.replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.48) * uNight * ${nightGlow.toFixed(3)};`);
    sh.fragmentShader = `varying vec3 vSeed;\n${NOISE}${frag}`;
  };
  m.customProgramCacheKey = () => `atlas-${pattern}-${color}-${nightGlow}`;
  return m;
}

/**
 * Lights a facade's windows at night. `glow` marks where windows are; each window is lit or
 * dark at random per floor and face, so towers don't show identical stripes. Purely
 * decorative: it says nothing about the project.
 */
export function windowLights(m: THREE.MeshStandardMaterial, glow: THREE.Texture, offset: number, spacing: number, share = 0.5) {
  m.emissiveMap = glow;
  m.emissive = new THREE.Color("#ffd9a1");
  m.emissiveIntensity = 1;
  m.onBeforeCompile = (sh) => {
    worldPos(sh);
    sh.fragmentShader = `varying vec3 vWPos;\nvarying vec3 vSeed;\nuniform float uNight;\nfloat litHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\n${sh.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      float win = floor((vEmissiveMapUv.x * 512.0 - ${offset.toFixed(1)}) / ${spacing.toFixed(1)});
      float lit = step(${(1 - share).toFixed(2)}, litHash(vec3(win, vSeed.y * 3.13 + vSeed.x, vSeed.z * 1.7 + vSeed.x * 0.37)));
      totalEmissiveRadiance *= uNight * (0.06 + 0.8 * lit);`,
    );
  };
  m.customProgramCacheKey = () => `atlas-windows-${offset}-${spacing}-${share}`;
  return m;
}

/** A black canvas with the windows of a facade texture in white, for `windowLights`. */
export function glowTexture(source: THREE.Texture) {
  const rects = (source.userData.windows ?? []) as [number, number, number, number, boolean][];
  const { width, height } = source.image as HTMLCanvasElement;
  return canvas(width, height, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, width, height);
    g.fillStyle = "#fff";
    for (const [x, y, w, h, arch] of rects) {
      g.beginPath();
      if (arch) {
        g.moveTo(x, y + h);
        g.lineTo(x, y + w / 2);
        g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        g.lineTo(x + w, y + h);
        g.closePath();
      } else g.rect(x + 2, y + 2, w - 4, h - 4);
      g.fill();
    }
  });
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const rand = (seed: number, i: number) => ((seed * 9301 + i * 49297) % 233280) / 233280;

/** One storey of a headquarters facade, in the building's architectural style. */
export function facadeTexture(style: BuildingStyle = "glass", seed = 7) {
  const windows: [number, number, number, number, boolean][] = [];
  const tex = canvas(512, 96, (g) => {
    const window = (x: number, y: number, w: number, h: number, dark: [string, string], lit: [string, string] | null) => {
      windows.push([x, y, w, h, false]);
      const grad = g.createLinearGradient(0, y, 0, y + h);
      const [a, b] = lit ?? dark;
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
      g.fillStyle = grad;
      g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(x, y, w, Math.max(3, h * 0.08));
    };
    if (style === "tech") {
      // Dark slate frame, deep glass, a few windows glowing teal.
      g.fillStyle = "#3b444d";
      g.fillRect(0, 0, 512, 96);
      for (let i = 0; i < 8; i++) {
        const x = 8 + i * 63;
        window(x, 12, 55, 70, ["#5b7486", "#2c3d4b"], rand(seed, i) > 0.6 ? ["#b9f1e6", "#5fc9b6"] : null);
      }
      g.fillStyle = "#59636c";
      g.fillRect(0, 86, 512, 10);
    } else if (style === "secure") {
      // Cream stone with tall, narrow windows between pilasters.
      g.fillStyle = "#ece4d2";
      g.fillRect(0, 0, 512, 96);
      for (let i = 0; i < 7; i++) {
        const x = 22 + i * 70;
        g.fillStyle = "#ddd2bb";
        g.fillRect(x - 12, 0, 6, 96);
        window(x, 10, 38, 74, ["#5a7593", "#2f4560"], rand(seed, i) > 0.75 ? ["#f6e3a6", "#e2bf6e"] : null);
      }
      g.fillStyle = "#d8ccb3";
      g.fillRect(0, 88, 512, 8);
    } else if (style === "timber") {
      // Warm timber frame, clear glass, and lattice screens at both ends.
      g.fillStyle = "#b8895a";
      g.fillRect(0, 0, 512, 96);
      for (let i = 1; i < 5; i++) window(16 + i * 80, 8, 72, 80, ["#cfe1e3", "#93b3ba"], rand(seed, i) > 0.7 ? ["#f8ecc4", "#e8cf8c"] : null);
      for (const x0 of [6, 422]) {
        g.fillStyle = "#c99b69";
        g.fillRect(x0, 6, 84, 84);
        g.strokeStyle = "#8f6640";
        g.lineWidth = 4;
        g.save();
        g.beginPath();
        g.rect(x0, 6, 84, 84);
        g.clip();
        g.beginPath();
        for (let k = -84; k < 168; k += 16) {
          g.moveTo(x0 + k, 6);
          g.lineTo(x0 + k - 84, 90);
          g.moveTo(x0 + k - 84, 6);
          g.lineTo(x0 + k, 90);
        }
        g.stroke();
        g.restore();
      }
      g.fillStyle = "#94683f";
      g.fillRect(0, 0, 512, 6);
      g.fillRect(0, 90, 512, 6);
    } else if (style === "classic") {
      // Limestone with arched, warmly lit windows.
      g.fillStyle = "#efe7d5";
      g.fillRect(0, 0, 512, 96);
      for (let i = 0; i < 6; i++) {
        const x = 20 + i * 82;
        const lit = rand(seed, i) > 0.45;
        windows.push([x, 9, 50, 75, true]);
        g.fillStyle = lit ? "#f1d58f" : "#6e8596";
        g.beginPath();
        g.moveTo(x, 84);
        g.lineTo(x, 34);
        g.arc(x + 25, 34, 25, Math.PI, 0);
        g.lineTo(x + 50, 84);
        g.closePath();
        g.fill();
        g.strokeStyle = "#d9caa8";
        g.lineWidth = 5;
        g.stroke();
      }
      g.fillStyle = "#dccfb2";
      g.fillRect(0, 86, 512, 10);
    } else {
      g.fillStyle = "#eef0ec";
      g.fillRect(0, 0, 512, 96);
      g.fillStyle = "#d9ddd6";
      g.fillRect(0, 84, 512, 12);
      const cols = 6;
      for (let i = 0; i < cols; i++) {
        const x = 12 + i * (488 / cols);
        window(x, 14, 488 / cols - 16, 62, ["#c3d5df", "#87a5ba"], rand(seed, i) > 0.72 ? ["#f6e3a6", "#e9c879"] : null);
        g.fillStyle = "#4c5a60";
        g.fillRect(x + (488 / cols - 16) / 2 - 1, 14, 2, 62);
      }
    }
  });
  tex.userData.windows = windows;
  return tex;
}

/** House wall: two shuttered windows. */
export function houseWallTexture() {
  const tex = houseWall();
  tex.userData.windows = [38, 162].map((x) => [x, 40, 56, 50, false]);
  return tex;
}

function houseWall() {
  return canvas(256, 128, (g) => {
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, 256, 128);
    for (const x of [38, 162]) {
      g.fillStyle = "#6d8597";
      g.fillRect(x, 40, 56, 50);
      g.fillStyle = "rgba(255,255,255,0.4)";
      g.fillRect(x, 40, 56, 8);
      g.strokeStyle = "#f8f4ea";
      g.lineWidth = 5;
      g.strokeRect(x, 40, 56, 50);
      g.beginPath();
      g.moveTo(x + 28, 40);
      g.lineTo(x + 28, 90);
      g.stroke();
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 118, 256, 10);
  });
}

function drawSymbol(g: CanvasRenderingContext2D, symbol: SymbolName, name: string, cx: number, cy: number, size: number, color: string) {
  g.save();
  if (symbol === "monogram") {
    g.fillStyle = color;
    g.font = `600 ${Math.round(size * 0.82)}px ui-serif, 'New York', Georgia, serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(initials(name).slice(0, 1), cx, cy + size * 0.05);
    g.restore();
    return;
  }
  const def = SYMBOLS[symbol];
  const k = size / 24;
  g.translate(cx - size / 2, cy - size / 2);
  g.scale(k, k);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const d of def.stroke) g.stroke(new Path2D(d));
  for (const d of def.fill) g.fill(new Path2D(d));
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

const cache = new Map<string, THREE.CanvasTexture>();
const cached = (key: string, make: () => THREE.CanvasTexture) => {
  let t = cache.get(key);
  if (!t) cache.set(key, (t = make()));
  return t;
};

/**
 * The facade sign of a headquarters: the project's symbol, lit, on a badge in the building's
 * accent color. Security buildings get a shield-shaped sign instead of a badge.
 */
export function signTexture(id: BuildingIdentity, name: string) {
  return cached(`sign:${id.symbol}:${id.style}:${id.accent}:${id.symbol === "monogram" ? name : ""}`, () =>
    canvas(256, 256, (g) => {
      if (id.style === "secure") {
        const shield = new Path2D("M128 14 C 170 44 205 50 232 50 L 232 120 C 232 188 186 224 128 246 C 70 224 24 188 24 120 L 24 50 C 51 50 86 44 128 14 Z");
        const grad = g.createLinearGradient(0, 14, 0, 246);
        grad.addColorStop(0, "#3d64ad");
        grad.addColorStop(1, id.accent);
        g.fillStyle = grad;
        g.fill(shield);
        g.strokeStyle = "#d9b25f";
        g.lineWidth = 12;
        g.stroke(shield);
        g.fillStyle = "rgba(255,255,255,0.12)";
        g.fill(new Path2D("M128 26 C 166 52 196 60 220 60 L 220 120 C 220 140 216 150 210 160 L 128 160 Z"));
        g.strokeStyle = "#f6f1e3";
        g.lineWidth = 16;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        g.moveTo(88, 128);
        g.lineTo(116, 156);
        g.lineTo(168, 104);
        g.stroke();
        return;
      }
      const dark = id.style === "classic" ? "#2c2a24" : id.style === "timber" ? "#2e2418" : "#16212a";
      roundRect(g, 8, 8, 240, 240, 40);
      g.fillStyle = dark;
      g.fill();
      g.lineWidth = 10;
      g.strokeStyle = id.accent;
      g.stroke();
      g.shadowColor = id.accent;
      g.shadowBlur = 22;
      drawSymbol(g, id.symbol, name, 128, 128, 150, id.symbol === "monogram" ? "#e9cf8f" : "#f4f6f0");
    }),
  );
}

/** A profile billboard: the GitHub mark, the project's name and the account it belongs to. */
export function billboardTexture(title: string, handle: string, accent: string) {
  return cached(`board:${title}:${handle}:${accent}`, () =>
    canvas(512, 256, (g) => {
      roundRect(g, 6, 6, 500, 244, 22);
      g.fillStyle = "#121a21";
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = accent;
      g.stroke();
      g.shadowColor = accent;
      g.shadowBlur = 18;
      drawSymbol(g, "github", title, 120, 128, 150, "#f4f6f0");
      g.shadowBlur = 0;
      g.fillStyle = "#f4f6f0";
      g.font = "600 44px ui-sans-serif, -apple-system, 'Helvetica Neue', sans-serif";
      g.textBaseline = "alphabetic";
      g.fillText(title, 216, 118, 270);
      g.fillStyle = accent;
      g.font = "500 30px ui-monospace, Menlo, monospace";
      g.fillText(`@${handle}`, 216, 166, 270);
    }),
  );
}

/** A timber name board for a rooftop sign: the symbol and the project's name. */
export function nameBoardTexture(id: BuildingIdentity, name: string) {
  return cached(`board:${id.symbol}:${name}`, () =>
    canvas(1024, 256, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#e2c194");
      grad.addColorStop(1, "#c9a06d");
      roundRect(g, 4, 4, 1016, 248, 28);
      g.fillStyle = grad;
      g.fill();
      g.lineWidth = 8;
      g.strokeStyle = "#8f6640";
      g.stroke();
      drawSymbol(g, id.symbol, name, 128, 128, 150, "#4a3420");
      g.fillStyle = "#4a3420";
      g.font = "600 92px ui-serif, 'New York', Georgia, serif";
      g.textBaseline = "middle";
      g.fillText(name.toUpperCase(), 236, 134, 760);
    }),
  );
}

export function initials(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(and|of|the|a)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
