#!/usr/bin/env node
// Compares a screenshot with a reference image and writes one PNG to look at:
// reference | screenshot | differences (changed pixels in red). Prints the share of pixels
// that differ. Images of different sizes are shown side by side without a diff.
//
//   npm run visual:compare -- <reference.png> <screenshot.png> [out.png]
import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [refPath, shotPath, outPath = "visual/out/compare.png"] = process.argv.slice(2);
if (!refPath || !shotPath) {
  console.error("Usage: npm run visual:compare -- <reference.png> <screenshot.png> [out.png]");
  process.exit(2);
}

const ref = PNG.sync.read(readFileSync(refPath));
const shot = PNG.sync.read(readFileSync(shotPath));
const same = ref.width === shot.width && ref.height === shot.height;
const panels = [ref, shot];
let ratio = null;

if (same) {
  const diff = new PNG({ width: ref.width, height: ref.height });
  const changed = pixelmatch(ref.data, shot.data, diff.data, ref.width, ref.height, { threshold: 0.2, alpha: 0.25 });
  ratio = changed / (ref.width * ref.height);
  panels.push(diff);
}

const gap = 16;
const width = panels.reduce((w, p) => w + p.width, 0) + gap * (panels.length - 1);
const height = Math.max(...panels.map((p) => p.height));
const out = new PNG({ width, height, fill: true });
out.data.fill(255);
let x = 0;
for (const p of panels) {
  PNG.bitblt(p, out, 0, 0, p.width, p.height, x, 0);
  x += p.width + gap;
}
writeFileSync(outPath, PNG.sync.write(out));

console.log(`Wrote ${outPath} (reference | screenshot${same ? " | diff" : ""}).`);
console.log(same ? `${(ratio * 100).toFixed(2)}% of pixels differ.` : `Sizes differ (${ref.width}x${ref.height} vs ${shot.width}x${shot.height}); no pixel diff.`);
