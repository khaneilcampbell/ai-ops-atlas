import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { opportunityPdf, winAnsi, wrap } from "./pdf";
import type { OpportunityReport } from "./model";

const report = (): OpportunityReport => JSON.parse(readFileSync(new URL("../../ops/opportunity-scout/fixtures/report.json", import.meta.url), "utf8"));
const text = (b: Uint8Array) => String.fromCharCode(...b);

describe("report PDF", () => {
  it("is a well-formed PDF whose cross-reference table points at each object", () => {
    const pdf = text(opportunityPdf(report(), "2026-10-30T12:00:05.000Z"));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
    expect(pdf.slice(xref, xref + 4)).toBe("xref");
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(pdf.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    for (const m of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const start = m.index! + m[0].length;
      expect(pdf.slice(start + Number(m[1]), start + Number(m[1]) + 10)).toBe("\nendstream");
    }
  });

  it("carries the ideas, the spec and the checks", () => {
    const pdf = text(opportunityPdf(report(), "2026-10-30T12:00:05.000Z"));
    expect(pdf).toContain("(1. Audit service \\(score 4.2 of 5\\)) Tj");
    expect(pdf).toContain("Agent spec: Audit Seller");
    expect(pdf).toContain("KC approves every offer before it is sent");
    expect(pdf).toContain("Checks");
  });

  it("flows long reports onto more pages", () => {
    const r = report();
    r.notes = Array.from({ length: 12 }, () => "A long check note ".repeat(20).trim());
    r.ideas = r.ideas.map((i) => ({ ...i, risks: "Risk ".repeat(110).trim() }));
    const pdf = text(opportunityPdf(r, "2026-10-30T12:00:05.000Z"));
    expect(Number(pdf.match(/\/Count (\d+)/)![1])).toBeGreaterThan(1);
    expect(pdf).toContain("Page 2 of");
  });

  it("keeps text inside WinAnsi and inside the margins", () => {
    expect(winAnsi("Score ≈ 4 — café “ok” 🚀")).toBe('Score ~ 4 - café "ok" ?');
    for (const line of wrap("word ".repeat(200), 10, false)) expect(line.length).toBeLessThan(120);
    expect(wrap("x".repeat(400), 10, true).length).toBeGreaterThan(1);
  });
});
