import { deflateSync } from "node:zlib";
import type { IngestBody } from "../src/library/model";

// Development examples for the Output Library preview (library.preview.config.ts) and its
// screenshot check. They go through the real ingest code but are marked as examples, and the
// drawer labels them; the hosted site never returns example records.

export const LIBRARY_DEV_TOKEN = "dev-preview-token-not-a-secret-0000000000";

/** A real PNG (a small gold-on-green badge), built here so no binary sits in the repository. */
function png(w = 48, h = 32): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < h; y++) {
    rows.push(0);
    for (let x = 0; x < w; x++) {
      const ring = Math.hypot(x - w / 2, y - h / 2) < h / 3;
      rows.push(...(ring ? [208, 173, 105] : [41, 66, 55]));
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

/** A minimal one-page PDF that says what it is. */
function pdf(): string {
  const text = "BT /F1 18 Tf 60 720 Td (Development example: Weekly operations summary) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1").toString("base64");
}

export interface LibrarySample {
  body: IngestBody;
  /** Store it while the preview bucket refuses writes, to show a missing deliverable. */
  failStorage?: boolean;
}

export function librarySamples(now: number): LibrarySample[] {
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000).toISOString();
  const src = (agent: string, execution: string, hoursAgo: number, extra: Partial<IngestBody["source"]> = {}): IngestBody["source"] => ({ agent, execution, producedAt: at(hoursAgo), via: "n8n", ...extra });
  return [
    {
      body: {
        source: src("github-opportunity-scout", "dev-scout-run-1", 170, { via: "github-actions", workflow: "opportunity-scout", runUrl: "https://github.com/khaneilcampbell/ai-ops-atlas/actions" }),
        artifacts: [{ id: "report.json", title: "Opportunity Scout report (example)", mime: "application/json", kind: "report", outputKey: "github-opportunity-scout:report", summary: "Example: three service ideas ranked by days to first dollar.", text: JSON.stringify({ example: true, ideas: [{ title: "Website care plan", days_to_first_dollar: 14 }] }, null, 2) }],
      },
    },
    {
      body: {
        source: src("github-opportunity-scout", "dev-scout-run-2", 3, { via: "github-actions", workflow: "opportunity-scout", runUrl: "https://github.com/khaneilcampbell/ai-ops-atlas/actions" }),
        artifacts: [{ id: "report.json", title: "Opportunity Scout report (example)", mime: "application/json", kind: "report", outputKey: "github-opportunity-scout:report", summary: "Example: four ideas; the top one reuses the Inquiry Manager.", text: JSON.stringify({ example: true, ideas: [{ title: "Inquiry triage for agencies", days_to_first_dollar: 10 }, { title: "Website care plan", days_to_first_dollar: 14 }] }, null, 2) }],
      },
    },
    {
      body: {
        source: src("benjaire-product-lab", "dev-n8n-exec-501", 6, { workflow: "product-lab-weekly", task: "task_dev_example_1" }),
        artifacts: [
          { id: "brief.md", title: "Product research brief (example)", mime: "text/markdown", requiresApproval: true, summary: "Example brief: two candidate products for the shop, awaiting your approval.", text: "# Product research brief\n\n_Development example._\n\n## Candidates\n- **Linen tote**: low cost, steady search demand\n- **Desk planner**: seasonal peak in January\n\n<script>alert('this stays text')</script>\n" },
          { id: "scores.csv", title: "Candidate scores (example)", mime: "text/csv", requiresApproval: true, summary: "Example scores behind the brief.", text: "product,demand,margin,score\nLinen tote,72,0.41,8.1\nDesk planner,64,0.38,7.4\n\"Card set, 12\",40,0.52,6.2\n" },
          { id: "cover.png", title: "Brief cover image (example)", mime: "image/png", base64: png() },
        ],
      },
    },
    {
      body: {
        source: src("atlas-health-monitor", "dev-health-run-88", 26, { via: "github-actions", workflow: "atlas-health" }),
        artifacts: [{ id: "summary.pdf", title: "Weekly operations summary (example)", mime: "application/pdf", summary: "Example PDF deliverable.", base64: pdf() }],
      },
    },
    {
      body: {
        source: src("commerce-operations-manager", "dev-n8n-exec-733", 50, { workflow: "commerce-orders-export" }),
        artifacts: [{ id: "orders.xlsx", title: "Orders export (example)", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", summary: "Example spreadsheet: downloads, no in-browser preview.", base64: Buffer.from("PK example bytes, not a real workbook").toString("base64") }],
      },
    },
    {
      failStorage: true,
      body: {
        source: src("site-builder", "dev-n8n-exec-902", 1, { workflow: "homepage-copy", task: "task_dev_example_2" }),
        artifacts: [{ id: "hero.txt", title: "Homepage hero copy (example)", mime: "text/plain", requiresApproval: true, summary: "Example of a deliverable whose file couldn't be saved.", text: "Atlas keeps your work in one place." }],
      },
    },
  ];
}
