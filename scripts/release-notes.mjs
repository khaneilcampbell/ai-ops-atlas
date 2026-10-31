// Prints the newest CHANGELOG.md entries as plain text for the in-app update notes.
// CI runs it in the read-only macOS build job; the publish job only reads the text file.
//   node scripts/release-notes.mjs [CHANGELOG.md] [count]
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** The first `count` bullet entries of the changelog, one per line, capped at 1000 characters. */
export function releaseNotes(markdown, count = 5) {
  const entries = [];
  for (const line of markdown.split("\n")) {
    const m = /^- (.+)$/.exec(line.trim());
    if (m) entries.push(m[1].trim());
    if (entries.length === count) break;
  }
  const text = entries.map((e) => `• ${e}`).join("\n");
  return text.length > 1000 ? `${text.slice(0, 999)}…` : text;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2] ?? "CHANGELOG.md";
  const count = Number(process.argv[3] ?? 5);
  const md = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  process.stdout.write(releaseNotes(md, count));
}
