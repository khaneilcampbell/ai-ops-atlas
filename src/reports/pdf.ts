import { formatDate } from "../lib/time";
import { MECHANISM_LABEL, type OpportunityReport } from "./model";

// A small, dependency-free PDF writer for agent reports: A4 pages of wrapped text in the two
// built-in Helvetica faces, so nothing is downloaded or embedded. Text is WinAnsi; characters
// outside it fall back to close ASCII.

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 54;
const WIDTH = PAGE_W - 2 * MARGIN;

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
// prettier-ignore
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

const FALLBACK: Record<string, string> = {
  "—": "-", "–": "-", "−": "-", "≈": "~", "≤": "<=", "≥": ">=", "→": "->",
  "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "•": "-", " ": " ",
};

/** Text as WinAnsi-safe characters (Latin-1 range; anything else gets an ASCII stand-in or "?"). */
export function winAnsi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const code = ch.codePointAt(0)!;
    if (FALLBACK[ch] !== undefined) out += FALLBACK[ch];
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch;
    else if (code === 9 || code === 10) out += " ";
    else out += "?";
  }
  return out;
}

function width(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    w += c >= 32 && c <= 126 ? HELVETICA[c - 32] : 556;
  }
  // Bold Helvetica runs a little wider; err on the side of an earlier wrap.
  return (w * size * (bold ? 1.07 : 1)) / 1000;
}

/** Splits text into lines that fit `max` points. A word longer than a line is cut. */
export function wrap(text: string, size: number, bold: boolean, max = WIDTH): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of winAnsi(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (width(next, size, bold) <= max) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (width(line, size, bold) > max) {
      let cut = line.length - 1;
      while (cut > 1 && width(line.slice(0, cut), size, bold) > max) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

interface Block {
  text: string;
  size?: number;
  bold?: boolean;
  gray?: boolean;
  /** Extra space above, in points. */
  before?: number;
  indent?: number;
}

/** Lays blocks out on as many pages as they need and returns the content stream of each page. */
function paginate(blocks: Block[]): string[] {
  const pages: string[][] = [[]];
  let y = PAGE_H - MARGIN;
  for (const b of blocks) {
    const size = b.size ?? 10;
    const lead = size * 1.35;
    const indent = b.indent ?? 0;
    const lines = wrap(b.text, size, !!b.bold, WIDTH - indent);
    y -= b.before ?? 0;
    for (const line of lines) {
      if (y - lead < MARGIN) {
        pages.push([]);
        y = PAGE_H - MARGIN;
      }
      y -= lead;
      const color = b.gray ? "0.4 0.42 0.4 rg" : "0.09 0.16 0.13 rg";
      pages[pages.length - 1].push(`BT ${color} /${b.bold ? "F2" : "F1"} ${size} Tf ${MARGIN + indent} ${y.toFixed(1)} Td (${esc(line)}) Tj ET`);
    }
  }
  return pages.map((ops, i) => [...ops, `BT 0.4 0.42 0.4 rg /F1 8 Tf ${MARGIN} 30 Td (Page ${i + 1} of ${pages.length}) Tj ET`].join("\n"));
}

/** Assembles the PDF file. Every character is one byte (WinAnsi), so string offsets are byte offsets. */
function assemble(streams: string[], title: string): Uint8Array {
  const objects: string[] = [];
  const add = (body: string) => objects.push(body); // the new length is the 1-based object number
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const s of streams) {
    const content = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const info = add(`<< /Title (${esc(winAnsi(title))}) /Producer (AI Ops Atlas) >>`);
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The whole report as a PDF: ranked ideas, the agent spec and the checks. */
export function opportunityPdf(r: OpportunityReport, storedAt: string): Uint8Array {
  const b: Block[] = [
    { text: "Opportunity Scout report", size: 20, bold: true },
    { text: `${formatDate(storedAt)} - read ${r.registry.projects} projects and ${r.registry.agents} agents - ${r.model}, about ${usd(r.cost_usd)}`, gray: true, before: 4 },
  ];
  if (!r.ideas.length) b.push({ text: "This run had no ideas.", before: 14 });
  else {
    b.push({ text: "Ranked ideas", size: 14, bold: true, before: 16 });
    r.ideas.forEach((i, n) => {
      b.push({ text: `${n + 1}. ${i.title}  (score ${i.score.toFixed(1)} of 5)`, size: 11.5, bold: true, before: 10 });
      b.push({ text: `How it earns: ${MECHANISM_LABEL[i.mechanism]}. Customer: ${i.customer}`, indent: 14, before: 2 });
      b.push({ text: `First dollar in about ${i.days_to_first_dollar} days. Running cost about ${usd(i.monthly_cost_usd)} a month.`, indent: 14 });
      b.push({ text: `Revenue ${i.scores.revenue}, effort ${i.scores.effort}, cost ${i.scores.cost}, risk ${i.scores.risk} (5 is always best).`, indent: 14 });
      b.push({ text: `Reuses: ${i.reuses.length ? i.reuses.join(", ") : "nothing listed"}`, indent: 14 });
      b.push({ text: `Risks: ${i.risks || "none given"}`, indent: 14 });
    });
    b.push({ text: "Score = (2 x revenue + effort + cost + risk) / 5. Revenue, timing and cost are the model's estimates, not market data.", gray: true, size: 9, before: 10 });
  }
  if (r.spec) {
    const s = r.spec;
    b.push({ text: `Agent spec: ${s.name}`, size: 14, bold: true, before: 18 });
    for (const [k, v] of [
      ["For the idea", s.idea],
      ["Purpose", s.purpose],
      ["Trigger", s.trigger],
      ["Schedule", s.schedule],
      ["Inputs", s.inputs.join("; ")],
      ["Outputs", s.outputs.join("; ")],
      ["Monthly cap", usd(s.monthly_cap_usd)],
      ["Building", s.building],
      ["Human approval", s.approval_point || "None given: don't build it until one is added."],
    ] as const) {
      b.push({ text: k, bold: true, size: 9.5, before: 6 });
      b.push({ text: v, indent: 14 });
    }
  }
  if (r.notes.length) {
    b.push({ text: "Checks", size: 14, bold: true, before: 18 });
    for (const n of r.notes) b.push({ text: `- ${n}`, before: 3 });
  }
  b.push({ text: "Recommend-only: nothing in this report has been built, spent, sent or published.", gray: true, size: 9, before: 18 });
  if (r.run_url) b.push({ text: `Run: ${r.run_url}`, gray: true, size: 9 });
  return assemble(paginate(b), `Opportunity Scout report ${storedAt.slice(0, 10)}`);
}

/** Hands the PDF to the browser's download, or to the Mac app's save dialog. False when cancelled. */
export async function savePdf(name: string, bytes: Uint8Array): Promise<boolean> {
  const { isTauri } = await import("../lib/env");
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("save_pdf", { name, bytes: Array.from(bytes) });
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
