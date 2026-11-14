// Prints the newest changelog entries as plain text for the in-app update notes.
// CI runs it in the read-only macOS build job; the publish job only reads the text file.
//   node scripts/release-notes.mjs [CHANGELOG.md] [count]
//
// Entries come from two places:
//  - changelog.d/*.md next to the changelog: one small file per pull request. New pull requests
//    add a file here instead of editing CHANGELOG.md, so two open pull requests never conflict
//    on the same line at the top of CHANGELOG.md.
//  - CHANGELOG.md itself: the older entries, already newest first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENTRY = /^- (.+)$/;
const DATE = /^(\d{4}-\d{2}-\d{2})\b/;
const PR = /\(#(\d+)\)\s*$/;

function bullets(markdown) {
  const out = [];
  for (const line of markdown.split("\n")) {
    const m = ENTRY.exec(line.trim());
    if (m) out.push(m[1].trim());
  }
  return out;
}

/**
 * The newest `count` entries, one per line, capped at 1000 characters.
 * `fragments` are the texts of changelog.d files. Their entries are sorted newest date first, then
 * highest pull request number, and go above changelog entries of the same date (fragments are the
 * newer way of adding a line, so a same-day changelog entry merged before them).
 */
export function releaseNotes(markdown, count = 5, fragments = []) {
  const fromChangelog = bullets(markdown).map((text, i) => ({ text, fragment: 0, order: i }));
  const fromFragments = fragments.flatMap(bullets).map((text) => ({ text, fragment: 1, order: 0 }));
  const date = (e) => DATE.exec(e.text)?.[1] ?? "";
  const pr = (e) => Number(PR.exec(e.text)?.[1] ?? 0);
  const entries = [...fromFragments, ...fromChangelog].sort(
    (a, b) =>
      date(b).localeCompare(date(a)) ||
      b.fragment - a.fragment ||
      (a.fragment && b.fragment ? pr(b) - pr(a) : 0) ||
      a.order - b.order,
  );
  const text = entries
    .slice(0, count)
    .map((e) => `• ${e.text}`)
    .join("\n");
  return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

/** Texts of the changelog.d/*.md files next to `file` (README.md skipped), or none. */
export function readFragments(file) {
  const dir = path.join(path.dirname(file), "changelog.d");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name.toLowerCase() !== "readme.md")
    .sort()
    .map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? "CHANGELOG.md";
  const count = Number(process.argv[3] ?? 5);
  const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  process.stdout.write(releaseNotes(md, count, readFragments(file)));
}
