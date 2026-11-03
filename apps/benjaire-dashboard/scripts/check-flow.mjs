// Checks the n8n workflow exports under products/flow before they are committed
// or shipped: valid JSON, no pinned or static run data (it can hold customer
// inquiries), HTTP nodes authenticate through an n8n credential rather than a
// header typed into the node, and the kit sold to buyers carries no Benjaire
// credential ids. Usage: node scripts/check-flow.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SETS = [
  { dir: 'products/flow/kit/3-workflows', shipped: true },
  { dir: 'products/flow/live-ops/workflows', shipped: false },
];
const AUTH_HEADER = /^(authorization|x-api-key|x-flow-key|api-key)$/i;

const problems = [];
let checked = 0;
for (const { dir, shipped } of SETS) {
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const file = join(dir, name);
    const fail = (msg) => problems.push(`${file}: ${msg}`);
    let wf;
    try {
      wf = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      fail(`not valid JSON (${e.message})`);
      continue;
    }
    checked++;
    if (!Array.isArray(wf.nodes)) fail('no nodes array');
    if (wf.pinData && Object.keys(wf.pinData).length) fail('has pinned data; clear it before exporting');
    if (wf.staticData) fail('has static data; clear it before exporting');
    for (const node of wf.nodes ?? []) {
      const where = `node "${node.name}"`;
      if (shipped && node.credentials) fail(`${where} references a Benjaire credential; buyers attach their own`);
      for (const [type, cred] of Object.entries(node.credentials ?? {})) {
        const extra = Object.keys(cred).filter((k) => k !== 'id' && k !== 'name');
        if (extra.length) fail(`${where} credential ${type} has inline fields: ${extra.join(', ')}`);
      }
      for (const h of node.parameters?.headerParameters?.parameters ?? []) {
        if (AUTH_HEADER.test(h.name ?? '') && h.value && !String(h.value).startsWith('=')) {
          fail(`${where} sets ${h.name} to a literal value; use an n8n credential or a settings lookup`);
        }
      }
    }
  }
}

if (problems.length) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`Flow exports OK (${checked} workflows).`);
