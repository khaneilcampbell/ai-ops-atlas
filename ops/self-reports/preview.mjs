// Writes a synthetic report cycle to disk: no network, no keys, no n8n. `node ops/self-reports/preview.mjs [dir]`
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const E = require('./engine.cjs');
const { synthetic } = require('./fixtures/synthetic.cjs');
const out = process.argv[2] || 'self-reports-preview';
mkdirSync(out, { recursive: true });
const { agents, ctx } = synthetic();
const cycle = E.buildCycle(agents, ctx, { mode: 'Synthetic preview (made-up agents, nothing sent)' });
const pdf = E.buildPdf(cycle), xlsx = E.buildXlsx(E.workbookSheets(cycle));
writeFileSync(join(out, E.FILES.pdf.fileName), pdf.bytes);
writeFileSync(join(out, E.FILES.workbook.fileName), xlsx);
const perAgent = E.agentFiles(cycle);
for (const f of perAgent) writeFileSync(join(out, f.fileName), Buffer.from(f.base64, 'base64'));
console.log(`${perAgent.length / 2} agents, each with a PDF and an Excel work report (${perAgent.filter((f) => f.noData).length / 2} say "No data in window")`);
console.log(`${cycle.counts.agents} agents, ${cycle.counts.runs} runs, ${cycle.counts.recs} suggestions; PDF ${pdf.pages} pages, workbook ${xlsx.length} bytes -> ${out}/`);
