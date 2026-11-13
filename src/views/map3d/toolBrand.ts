import * as THREE from "three";
/** Building accents per tool office or storefront; they identify the building, not runtime status. */
export interface ToolBrand {
  primary: string; secondary: string; wall: string; roof: string; rounded?: boolean; stepped?: boolean;
  /** Optional facade override: floor bands (alternating), corner columns and roof trim, and window glass; `garden` adds planted ledges, flowers and blue light strips like the Security Operations Center. Brand colours stay on the sign and accent fins. */
  facade?: { bands: [string, string]; trim: string; glass: [string, string]; garden?: boolean };
}
const BRANDS: Record<string, ToolBrand> = {
  "Design Studio": { primary: "#00c4cc", secondary: "#7d2ae7", wall: "#e0edee", roof: "#47346b", rounded: true },
  "Payments Office": { primary: "#635bff", secondary: "#9a8cff", wall: "#e1e4f2", roof: "#353958", stepped: true },
  "Edge Office": { primary: "#f48120", secondary: "#faae40", wall: "#eee8dc", roof: "#4e4941", rounded: true },
  // Sandstone and sky glass, matching the Security Operations Center beside it (Khaneil, 2026-11-13).
  "Log Analytics Lab": { primary: "#65a637", secondary: "#283b2a", wall: "#ebe1cc", roof: "#cbb994", stepped: true,
    facade: { bands: ["#f6efe1", "#c9b48a"], trim: "#d9ccb0", glass: ["#5f8aa6", "#7fa3ba"], garden: true } },
  "Automation Works": { primary: "#ea4b71", secondary: "#ff9a9d", wall: "#e5dfe4", roof: "#38313c" },
  "Search Desk": { primary: "#6366f1", secondary: "#38bdf8", wall: "#e0e6ee", roof: "#344257" },
  "Storefront Office": { primary: "#95bf47", secondary: "#5e8e3e", wall: "#e5eadb", roof: "#354c36", stepped: true },
};
export const TOOL_OFFICE_HEIGHT = 2.8;
export const TOOL_OFFICE_TOP = TOOL_OFFICE_HEIGHT + 0.4;
export function toolBrand(name: string): ToolBrand {
  return BRANDS[name] ?? { primary: "#839b91", secondary: "#51685f", wall: "#dfe5de", roof: "#3b5147" };
}


/** A tool's name sign: its brand colours with the name in white (a few have their own lettering). */
export function toolSignTexture(name: string): THREE.CanvasTexture {
  const tool = { name };
  const brand = toolBrand(name);
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 192);
  gradient.addColorStop(0, brand.primary); gradient.addColorStop(1, brand.secondary);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = "#ffffff";
  ctx.font = tool.name.length > 11 ? "600 72px system-ui, sans-serif" : "600 100px system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tool.name, 256, 100, 460);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
