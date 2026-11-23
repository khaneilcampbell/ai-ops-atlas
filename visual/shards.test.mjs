import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DEFAULT_SECONDS, filtersFor, planShards } from "./shards.mjs";

/** Must match the matrix in .github/workflows/visual.yml. */
const SHARDS = 12;
const dir = new URL(".", import.meta.url);
const specFiles = () => readdirSync(dir).filter((f) => f.endsWith(".visual.ts"));
const shardTimes = () => JSON.parse(readFileSync(new URL("shard-times.json", dir), "utf8"));

describe("visual CI shards", () => {
  it("puts every file in exactly one shard", () => {
    const files = ["a.visual.ts", "b.visual.ts", "c.visual.ts", "d.visual.ts", "e.visual.ts"];
    const plan = planShards(files, { "a.visual.ts": 50, "b.visual.ts": 40, "c.visual.ts": 30 }, 3);
    expect(plan.flatMap((s) => s.files).sort()).toEqual(files);
  });

  it("spreads slow files instead of keeping alphabetical neighbours together", () => {
    const times = { "ma.visual.ts": 900, "mb.visual.ts": 900, "mc.visual.ts": 900, "z1.visual.ts": 10, "z2.visual.ts": 10 };
    const plan = planShards(Object.keys(times), times, 3);
    expect(plan.map((s) => s.seconds).sort((a, b) => a - b)).toEqual([900, 910, 910]);
  });

  it("counts a file it has no time for as the default", () => {
    const [shard] = planShards(["new.visual.ts"], {}, 1);
    expect(shard.seconds).toBe(DEFAULT_SECONDS);
  });

  it("anchors filters so one file name does not match another", () => {
    const [filter] = filtersFor(["trackpad.visual.ts"]);
    const re = new RegExp(filter);
    expect(re.test("/repo/visual/trackpad.visual.ts")).toBe(true);
    expect(re.test("/repo/visual/interior-trackpad.visual.ts")).toBe(false);
  });

  it("has a measured time for every spec file and none for deleted ones", () => {
    // 23 spec files once counted as 90 seconds each while some took 18 minutes, so a shard planned
    // at 24 minutes ran past the 35 minute limit and was cancelled. Add the file's CI time here.
    const times = shardTimes();
    expect(specFiles().filter((f) => !(f in times))).toEqual([]);
    expect(Object.keys(times).filter((f) => !specFiles().includes(f))).toEqual([]);
  });

  it("plans for the same number of shards the CI workflow runs", () => {
    const workflow = readFileSync(new URL("../.github/workflows/visual.yml", dir), "utf8");
    const matrix = workflow.match(/\|\| '\[([\d, ]+)\]'/)?.[1].split(",") ?? [];
    expect(matrix).toHaveLength(SHARDS);
    expect(workflow).toContain(`shards.mjs \${{ matrix.shard }} ${SHARDS})`);
  });

  it("keeps the real suite's shards under the 35 minute CI limit", () => {
    const files = specFiles();
    const times = shardTimes();
    const longest = Math.max(...planShards(files, times, SHARDS).map((s) => s.seconds));
    // Runners vary by about 15% between runs; leave that plus install time inside the 35 minute limit.
    expect(longest).toBeLessThan(24 * 60);
  });
});

describe("visual CI shard filters", () => {
  it("escapes every regular expression character in a file name", () => {
    const [filter] = filtersFor(["a+b(c)\\d.visual.ts"]);
    expect(new RegExp(filter).test("/repo/visual/a+b(c)\\d.visual.ts")).toBe(true);
    expect(new RegExp(filter).test("/repo/visual/aab(c)\\d.visual.ts")).toBe(false);
  });
});
