// Fails if anything that looks like a credential ends up in the built UI or
// the repository's tracked source. Usage: node scripts/check-secrets.mjs dist worker src
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS = [
  [/rk_(live|test)_[A-Za-z0-9]{10,}/, 'Stripe restricted key'],
  [/sk_(live|test)_[A-Za-z0-9]{10,}/, 'Stripe secret key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/, 'GitHub token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'Private key'],
  [/\bBearer [A-Za-z0-9._-]{30,}/, 'Bearer token'],
];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|mjs|ts|tsx|css|html|json|jsonc|sql|md)$/.test(name)) yield p;
  }
}

let found = 0;
for (const root of process.argv.slice(2)) {
  for (const f of files(root)) {
    const text = readFileSync(f, 'utf8');
    for (const [re, what] of PATTERNS) {
      if (re.test(text)) {
        found++;
        console.error(`${f}: looks like a ${what}`);
      }
    }
  }
}
if (found) process.exit(1);
console.log('No credentials found.');
