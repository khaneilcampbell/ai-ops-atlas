import { textWidth } from "./mapLayout";

export const SANS = "-apple-system, system-ui, sans-serif";
export const SERIF = "ui-serif, 'New York', Georgia, serif";
let ctx2d: CanvasRenderingContext2D | null | undefined;
/** Real text width from the browser's font metrics, so plaques fit their text exactly. */
export function measure(text: string, size: number, font: string, weight = 400) {
  if (ctx2d === undefined) ctx2d = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  if (!ctx2d) return textWidth(text, size, font === SERIF);
  ctx2d.font = `${weight} ${size}px ${font}`;
  return ctx2d.measureText(text).width;
}

/** Breaks a name into lines no wider than max, on word boundaries; never truncates. */
export function wrap(text: string, size: number, font: string, max: number, weight = 400) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && measure(`${last} ${word}`, size, font, weight) <= max) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  // Keep plaques short: anything past three lines joins the third, and the plaque grows wider instead.
  return lines.length > 3 ? [...lines.slice(0, 2), lines.slice(2).join(" ")] : lines;
}


/** Shorten text to fit a width, ending in an ellipsis when cut. */
export function clip(text: string, size: number, max: number, font = SANS, weight = 600) {
  if (measure(text, size, font, weight) <= max) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, size, font, weight) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
