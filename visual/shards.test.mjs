import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { DEFAULT_SECONDS, filtersFor, planShards } from "./shards.mjs";

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

  it("keeps the real suite's shards under the 35 minute CI limit", () => {
    const dir = new URL(".", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".visual.ts"));
    const times = JSON.parse(readFileSync(new URL("shard-times.json", dir), "utf8"));
    const longest = Math.max(...planShards(files, times, 8).map((s) => s.seconds));
    // Leave room for install and start-up inside the 35 minute job limit.
    expect(longest).toBeLessThan(28 * 60);
  });
});
