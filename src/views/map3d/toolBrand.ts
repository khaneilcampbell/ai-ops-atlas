import * as THREE from "three";
/** Building accents per tool office or storefront; they identify the building, not runtime status. */
export interface ToolBrand { primary: string; secondary: string; wall: string; roof: string; rounded?: boolean; stepped?: boolean }
const BRANDS: Record<string, ToolBrand> = {
  "Reasoning Lab": { primary: "#d97757", secondary: "#b96145", wall: "#f0e7da", roof: "#342b27", stepped: true },
  "Model Lab": { primary: "#10a37f", secondary: "#202927", wall: "#e8eeeb", roof: "#172b25", rounded: true },
  "Halden Branch": {primary:"#1f3b4d",secondary:"#16303f",wall:"#e7ddc7",roof:"#3b4a52"},
  Chipotle: {primary:"#a33d2d",secondary:"#633224",wall:"#e6ddd0",roof:"#382f2a"},
  Starbucks: {primary:"#00754a",secondary:"#174b37",wall:"#e8e2d5",roof:"#263a30",rounded:true},
  Zara: {primary:"#151515",secondary:"#49443c",wall:"#eeeae0",roof:"#2c2b29"},
  Smashburger: {primary:"#c62828",secondary:"#ea7738",wall:"#eee1d4",roof:"#40332d"},
  "Design Studio": { primary: "#00c4cc", secondary: "#7d2ae7", wall: "#e0edee", roof: "#47346b", rounded: true },
  "Payments Office": { primary: "#635bff", secondary: "#9a8cff", wall: "#e1e4f2", roof: "#353958", stepped: true },
  "Edge Office": { primary: "#f48120", secondary: "#faae40", wall: "#eee8dc", roof: "#4e4941", rounded: true },
  "Log Analytics Lab": { primary: "#65a637", secondary: "#283b2a", wall: "#d9dfd8", roof: "#24302b", stepped: true },
  "Automation Works": { primary: "#ea4b71", secondary: "#ff9a9d", wall: "#e5dfe4", roof: "#38313c" },
  "Search Desk": { primary: "#6366f1", secondary: "#38bdf8", wall: "#e0e6ee", roof: "#344257" },
  "Storefront Office": { primary: "#95bf47", secondary: "#5e8e3e", wall: "#e5eadb", roof: "#354c36", stepped: true },
};
export const TOOL_OFFICE_HEIGHT = 2.8;
export const TOOL_OFFICE_TOP = TOOL_OFFICE_HEIGHT + 0.4;
export function toolBrand(name: string): ToolBrand {
  return BRANDS[name] ?? { primary: "#839b91", secondary: "#51685f", wall: "#dfe5de", roof: "#3b5147" };
}

export function toolOfficeHeight(name: string): number { if(name === "Reasoning Lab") return 2.9; if(name === "Halden Branch") return 1.6; return ["Starbucks", "Smashburger", "Chipotle", "Halden Branch"].includes(name) ? TOOL_OFFICE_HEIGHT / 2 : TOOL_OFFICE_HEIGHT; }

/** A tool's name sign: its brand colours with the name in white (a few have their own lettering). */
export function toolSignTexture(name: string): THREE.CanvasTexture {
  const tool = { name };
  const brand = toolBrand(name);
  const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 192);
  gradient.addColorStop(0, brand.primary); gradient.addColorStop(1, brand.secondary);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = tool.name === "Zara" ? "#171717" : "#ffffff";
  if(tool.name==="Zara") {ctx.fillStyle="#f5f0e6";ctx.fillRect(0,0,512,192);ctx.fillStyle="#171717";}
  ctx.font = tool.name.length > 11 ? "600 72px system-ui, sans-serif" : "600 100px system-ui, sans-serif";
  if(tool.name==="Halden Branch") {ctx.fillStyle="#e8d9a8";ctx.font="600 80px Georgia,serif";}
  if(tool.name==="Zara")ctx.font="110px Georgia,serif";
  if(tool.name==="Starbucks")ctx.font="bold 66px system-ui,sans-serif";
  if(tool.name==="Chipotle")ctx.font="bold 78px system-ui,sans-serif";
  if(tool.name==="Smashburger")ctx.font="bold 68px system-ui,sans-serif";
  if(tool.name==="Reasoning Lab")ctx.font="600 82px Georgia,serif";
  if(tool.name==="Model Lab")ctx.font="600 96px system-ui,sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(tool.name==="Zara"?"ZARA":tool.name==="Starbucks"?"STARBUCKS":tool.name==="Chipotle"?"CHIPOTLE":tool.name, 256, 100, 460);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace;
  return map;
}
