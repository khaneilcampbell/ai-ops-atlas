import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFragments, releaseNotes } from "./release-notes.mjs";

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

  it("keeps the changelog's own order for same-day entries", () => {
    const md = "- 2026-11-12 · Merged last (#386)\n- 2026-11-12 · Merged first (#388)\n";
    expect(releaseNotes(md)).toBe("• 2026-11-12 · Merged last (#386)\n• 2026-11-12 · Merged first (#388)");
  });

  it("puts fragment entries above changelog entries, newest date then highest PR first", () => {
    const md = "- 2026-11-12 · Old way (#388)\n- 2026-11-11 · Yesterday (#370)\n";
    const fragments = ["- 2026-11-12 · Fragment A (#396)\n", "- 2026-11-13 · Fragment B (#395)\n", "- 2026-11-12 · Fragment C (#397)\n"];
    expect(releaseNotes(md, 4, fragments)).toBe(
      [
        "• 2026-11-13 · Fragment B (#395)",
        "• 2026-11-12 · Fragment C (#397)",
        "• 2026-11-12 · Fragment A (#396)",
        "• 2026-11-12 · Old way (#388)",
      ].join("\n"),
    );
  });

  it("allows more than one line in a fragment and ignores text that is not a bullet", () => {
    const fragment = "Notes for the reviewer are fine here.\n\n- 2026-11-13 · First (#400)\n- 2026-11-13 · Second (#400)\n";
    expect(releaseNotes("", 5, [fragment])).toBe("• 2026-11-13 · First (#400)\n• 2026-11-13 · Second (#400)");
  });

  it("reads changelog.d next to the changelog and skips its README", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "- 2026-11-01 · Old (#1)\n");
    fs.mkdirSync(path.join(dir, "changelog.d"));
    fs.writeFileSync(path.join(dir, "changelog.d", "README.md"), "- 2099-01-01 · Example, not a real entry (#0)\n");
    fs.writeFileSync(path.join(dir, "changelog.d", "branch-a.md"), "- 2026-11-02 · New (#2)\n");
    fs.writeFileSync(path.join(dir, "changelog.d", "notes.txt"), "- 2099-01-01 · Not markdown (#0)\n");
    const file = path.join(dir, "CHANGELOG.md");
    expect(releaseNotes(fs.readFileSync(file, "utf8"), 5, readFragments(file))).toBe("• 2026-11-02 · New (#2)\n• 2026-11-01 · Old (#1)");
  });

  it("has no fragments when changelog.d is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
    expect(readFragments(path.join(dir, "CHANGELOG.md"))).toEqual([]);
  });

  it("reads the real changelog and fragments", () => {
    const notes = releaseNotes(fs.readFileSync("CHANGELOG.md", "utf8"), 5, readFragments("CHANGELOG.md"));
    expect(notes).toMatch(/^• \d{4}-\d{2}-\d{2} · /);
  });
});
