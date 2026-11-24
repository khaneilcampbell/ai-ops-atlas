// Prints the jsCode of the self-report workflow's Code nodes as JSON ({ nodeName: code }). Each
// engine-backed node is the engine (ops/self-reports/engine.cjs) without its export block, followed by
// that node's adapter in ops/self-reports/n8n/ (*.n8n: Code-node bodies with a top-level return, so not linted as modules). `node ops/self-reports/build-n8n.mjs > code.json`
import { readFileSync } from 'node:fs';
const here = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
export const engineForN8n = () => here('./engine.cjs').replace(/\/\/ @export-start[\s\S]*?\/\/ @export-end\n?/, '');
/** The same code without full-line comments and indentation (the file has no multi-line strings), to keep the node small. */
const compact = (src) => src.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('/**') && !l.startsWith('* ') && l !== '*/').join('\n');
const HEADER = '// Generated from ops/self-reports/engine.cjs and ops/self-reports/n8n/ in the Atlas repo (node ops/self-reports/build-n8n.mjs).\n// Edit there, not here: the tests run that code. No AI, no network calls in this node.\n';
export const NODES = { 'Build Reports': 'build-reports.n8n' };
export const PLAIN = { 'Library Entry': 'library-entry.n8n', 'Run Log Row': 'run-log.n8n' };
export function n8nCode() {
  const out = {};
  for (const [name, file] of Object.entries(NODES)) out[name] = HEADER + compact(engineForN8n() + '\n' + here('./n8n/' + file)) + '\n';
  for (const [name, file] of Object.entries(PLAIN)) out[name] = here('./n8n/' + file);
  return out;
}
/** Same fingerprint the Run Log row records for the Build Reports code in n8n. */
export const fingerprint = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return s.length + '-' + h.toString(16); };
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(process.argv[2] === '--fingerprint' ? fingerprint(n8nCode()['Build Reports']) + '\n' : JSON.stringify(n8nCode()));
