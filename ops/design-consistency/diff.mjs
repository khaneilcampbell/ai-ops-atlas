#!/usr/bin/env node
// Compares Design Consistency's before and after screenshots and writes shots.json for the pull
// request: one row per view with image links and the share of pixels that changed.
//
//   node ops/design-consistency/diff.mjs <before-dir> <after-dir> <base-url> <out.json>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [beforeDir, afterDir, baseUrl, out] = process.argv.slice(2);
const rows = [];
for (const file of readdirSync(beforeDir).filter((f) => f.endsWith(".png")).sort()) {
  const a = PNG.sync.read(readFileSync(join(beforeDir, file)));
  let changed = "missing after";
  try {
    const b = PNG.sync.read(readFileSync(join(afterDir, file)));
    if (a.width !== b.width || a.height !== b.height) changed = "size changed";
    else {
      const n = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
      changed = n === 0 ? "none" : `${((100 * n) / (a.width * a.height)).toFixed(2)}%`;
    }
  } catch {}
  const name = file.replace(/\.png$/, "");
  rows.push({ name, before: `${baseUrl}/before/${file}`, after: `${baseUrl}/after/${file}`, changed });
}
writeFileSync(out, JSON.stringify(rows, null, 1));
console.log(rows.map((r) => `${r.name}: ${r.changed}`).join("\n"));
