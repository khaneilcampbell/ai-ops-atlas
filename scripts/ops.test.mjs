import { describe, expect, it } from "vitest";
import { area, changelogProblem, handoff, list, plan, previewUrl, tail } from "./ops.mjs";

describe("plan", () => {
  it("asks docs-only changes for nothing", () => {
    expect(plan(["docs/x.md", "README.md"])).toEqual({ checks: [], notes: [] });
  });

  it("follows CLAUDE.md for Rust, screen, map and high-risk paths", () => {
    const p = plan(["src-tauri/src/lib.rs", "src/views/map3d/roads.ts", "src/views/Usage.tsx", ".github/workflows/ci.yml"]);
    expect(p.checks).toEqual(["npm run lint", "npm run typecheck", "npm test", "cargo test --manifest-path src-tauri/Cargo.toml"]);
    expect(p.notes.join("\n")).toMatch(/macOS app/);
    expect(p.notes.join("\n")).toMatch(/npm run visual/);
    expect(p.notes.join("\n")).toMatch(/measure:perf/);
    expect(p.notes.join("\n")).toMatch(/High risk.*\.github\/workflows\/ci\.yml/);
    expect(p.notes.join("\n")).toMatch(/CHANGELOG/);
  });

  it("stops asking for a changelog line once one is added", () => {
    expect(plan(["src/usage/model.ts", "CHANGELOG.md"]).notes).toEqual([]);
  });
});

describe("area", () => {
  it("groups paths", () => {
    expect(area("src/actions/merge.ts")).toBe("high risk");
    expect(area("src-tauri/src/lib.rs")).toBe("rust");
    expect(area("src/views/Map.tsx")).toBe("map");
    expect(area("src/usage/model.test.ts")).toBe("tests");
    expect(area("src/views/Usage.tsx")).toBe("app");
    expect(area("docs/api-usage.md")).toBe("docs");
  });
});

describe("changelogProblem", () => {
  it("accepts the house format", () => {
    expect(changelogProblem("# Changelog\n\nIntro.\n\n- 2026-11-09 · Something changed (#310)\n")).toBeNull();
    expect(changelogProblem("- 2026-11-09 · Something changed (#PR)\n")).toBeNull();
  });
  it("flags a line without a date or PR number", () => {
    expect(changelogProblem("- Something changed\n")).toMatch(/doesn't match/);
    expect(changelogProblem("# Changelog\n")).toMatch(/no entries/);
  });
});

describe("previewUrl", () => {
  it("matches Cloudflare's branch alias", () => {
    expect(previewUrl("claude/project-thread-k59ee5")).toBe("https://claude-project-thread-k59ee5.ai-ops-atlas.pages.dev");
  });
});

describe("tail", () => {
  it("keeps only the last lines", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const t = tail(text, 3).split("\n");
    expect(t).toEqual(["… 37 lines above", "line 37", "line 38", "line 39"]);
  });
});

describe("handoff", () => {
  it("stays short and names files, checks and the preview", () => {
    const files = Array.from({ length: 35 }, (_, i) => ({ path: `src/a${i}.ts`, added: 1, removed: 0, lines: 10 }));
    files[0] = { path: "src/views/Map.tsx", added: 5, removed: 2, lines: 2400 };
    const text = handoff({ task: "Finish the card", branch: "claude/x", base: "origin/main", ahead: 2, behind: 0, dirty: 1, commits: ["abc Add card"], files, plan: plan(files.map((f) => f.path)), date: "2026-11-09" });
    expect(text).toMatch(/^# Handoff · claude\/x · 2026-11-09/);
    expect(text).toMatch(/Task: Finish the card/);
    expect(text).toMatch(/1 uncommitted file\b/);
    expect(text).toMatch(/2400 lines, read in ranges/);
    expect(text).toMatch(/… 5 more/);
    expect(text).toMatch(/npm run lint && npm run typecheck && npm test/);
    expect(text.split("\n").length).toBeLessThan(60);
  });
});

describe("list", () => {
  it("caps long lists", () => {
    expect(list(["a", "b"], 5)).toBe("a, b");
    expect(list(["a", "b", "c", "d"], 2)).toBe("a, b +2 more");
  });
});
