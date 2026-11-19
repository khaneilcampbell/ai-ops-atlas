// Splits the visual specs into CI shards of about equal running time.
// Playwright's own --shard cuts the alphabetical file list by test count, so slow map files that
// sit next to each other (marketing-agency, marketplace-*, module-*) landed in one shard and hit
// the 35 minute job limit. This uses the measured seconds per spec file in shard-times.json.
//   node visual/shards.mjs <shard> <total>   prints that shard's Playwright file filters
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A spec file missing from shard-times.json (a new one) counts as this many seconds. */
export const DEFAULT_SECONDS = 90;

/** Longest files first, each to the shard with the least time so far. Same input, same plan. */
export function planShards(files, times, total) {
  const shards = Array.from({ length: total }, () => ({ seconds: 0, files: [] }));
  const weighted = files
    .map((file) => ({ file, seconds: times[file] ?? DEFAULT_SECONDS }))
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  for (const { file, seconds } of weighted) {
    const target = shards.reduce((best, s) => (s.seconds < best.seconds ? s : best), shards[0]);
    target.files.push(file);
    target.seconds += seconds;
  }
  for (const s of shards) s.files.sort();
  return shards;
}

/** Anchored filters, so "trackpad" does not also pick up "interior-trackpad". */
export function filtersFor(files) {
  return files.map((f) => `/${f.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}$`);
}

const dir = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [shard, total] = process.argv.slice(2).map(Number);
  if (!(total >= 1 && shard >= 1 && shard <= total)) {
    console.error("usage: node visual/shards.mjs <shard> <total>");
    process.exit(2);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".visual.ts"));
  const times = JSON.parse(readFileSync(join(dir, "shard-times.json"), "utf8"));
  const plan = planShards(files, times, total);
  console.error(`shard ${shard}/${total}: about ${Math.round(plan[shard - 1].seconds / 60)} min of tests`);
  console.log(filtersFor(plan[shard - 1].files).join(" "));
}
