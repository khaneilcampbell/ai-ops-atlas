import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { releaseNotes } from "./release-notes.mjs";

describe("releaseNotes", () => {
  it("takes the newest bullet entries in order", () => {
    const md = "# Changelog\n\nIntro text.\n\n- 2026-10-31 · Newest (#150)\n- 2026-10-30 · Older (#149)\n- 2026-10-29 · Oldest (#148)\n";
    expect(releaseNotes(md, 2)).toBe("• 2026-10-31 · Newest (#150)\n• 2026-10-30 · Older (#149)");
  });

  it("returns empty text when there are no entries", () => {
    expect(releaseNotes("# Changelog\n")).toBe("");
  });

  it("caps long notes", () => {
    const md = Array.from({ length: 5 }, () => `- ${"x".repeat(400)}`).join("\n");
    expect(releaseNotes(md).length).toBe(1000);
  });

  it("reads the real changelog", () => {
    expect(releaseNotes(fs.readFileSync("CHANGELOG.md", "utf8"))).toMatch(/^• \d{4}-\d{2}-\d{2} · /);
  });
});
