import * as THREE from "three";

/** Shared clock for animated surfaces (water, waterfalls). */
export const time = { value: 0 };

const NOISE = /* glsl */ `
varying vec3 vWPos;
uniform float uTime;
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
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.88, diffuseColor.rgb * 1.08, w) + c * 0.05;`,
  falls: /* glsl */ `
    float s = fbm(vec2((vWPos.x + vWPos.z) * 9.0, vWPos.y * 2.5 + uTime * 2.2));
    diffuseColor.rgb = mix(vec3(0.5, 0.74, 0.82), vec3(0.96, 0.99, 1.0), smoothstep(0.35, 0.72, s));`,
  none: "",
} as const;

export type Pattern = keyof typeof PATTERNS;

export function patterned(color: string, pattern: Pattern, opts: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, ...opts });
  if (pattern === "none") return m;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = `varying vec3 vWPos;\n${sh.vertexShader}`.replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4;
      #endif
      vWPos = (modelMatrix * wp4).xyz;`,
    );
    sh.fragmentShader = NOISE + sh.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>\n${PATTERNS[pattern]}`);
  };
  m.customProgramCacheKey = () => `atlas-${pattern}-${color}`;
  return m;
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

/** One storey of an office facade: a row of glazed windows between cream piers. */
export function facadeTexture(seed: number) {
  return canvas(512, 96, (g) => {
    g.fillStyle = "#eef0ec";
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = "#d9ddd6";
    g.fillRect(0, 84, 512, 12);
    const cols = 6;
    for (let i = 0; i < cols; i++) {
      const x = 12 + i * (488 / cols);
      const lit = ((seed * 9301 + i * 49297) % 233280) / 233280 > 0.72;
      const grad = g.createLinearGradient(0, 14, 0, 76);
      grad.addColorStop(0, lit ? "#f6e3a6" : "#c3d5df");
      grad.addColorStop(1, lit ? "#e9c879" : "#87a5ba");
      g.fillStyle = grad;
      g.fillRect(x, 14, 488 / cols - 16, 62);
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(x, 14, 488 / cols - 16, 6);
      g.fillStyle = "#4c5a60";
      g.fillRect(x + (488 / cols - 16) / 2 - 1, 14, 2, 62);
    }
  });
}

/** House wall: two shuttered windows. */
export function houseWallTexture() {
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

/** Square sign on a tower: the project's initials, white on forest green. */
export function signTexture(text: string) {
  return canvas(128, 128, (g) => {
    g.fillStyle = "#1d2b22";
    g.beginPath();
    g.roundRect(4, 4, 120, 120, 16);
    g.fill();
    g.strokeStyle = "#c9a35a";
    g.lineWidth = 4;
    g.stroke();
    g.fillStyle = "#f1f2ea";
    g.font = "600 52px ui-serif, 'New York', Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 64, 68);
  });
}

export function initials(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w && !/^(and|of|the|a)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}
