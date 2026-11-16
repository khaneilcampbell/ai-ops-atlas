#!/usr/bin/env node
// Fails CI when a tracked file contains something shaped like a live credential. Prints the file,
// line and kind only, never the matched text. Obvious test fixtures (alphabet runs, one repeated
// character) are allowed. GitHub secret scanning still runs on the repository; this catches a key
// before it is merged. Usage: node scripts/secret-scan.mjs [files...] (default: all tracked files).
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const RULES = [
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/g],
  ["GitHub fine-grained token", /github_pat_[A-Za-z0-9_]{60,}/g],
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{40,}/g],
  ["OpenAI key", /sk-(proj-)?[A-Za-z0-9]{40,}/g],
  ["Resend key", /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g],
  ["Slack token", /xox[abprs]-[0-9]{6,}-[A-Za-z0-9-]{10,}/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Stripe live key", /\b[rs]k_live_[A-Za-z0-9]{20,}/g],
  ["Private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/=]{40,}/g],
];
const SKIP = /(^|\/)(package-lock\.json|Cargo\.lock)$|\.(png|jpe?g|gif|webp|ico|icns|pdf|woff2?|ttf|glb|gltf|bin|zip|xlsx|mp4|mov)$/i;
const MAX = 2_000_000;
const fixture = (s) => /abcdefghij|ABCDEFGHIJ|0123456789abcdef|(.)\1{7,}|EXAMPLE|REPLACE/i.test(s);

const files = process.argv.length > 2 ? process.argv.slice(2) : execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const found = [];
for (const f of files) {
  if (SKIP.test(f)) continue;
  let text;
  try {
    if (statSync(f).size > MAX) continue;
    text = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\u0000")) continue;
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    for (const [kind, re] of RULES) {
      for (const m of line.matchAll(re)) if (!fixture(m[0])) found.push(`${f}:${i + 1}: possible ${kind}`);
    }
  });
}
if (found.length) {
  console.error(`Secret scan: ${found.length} possible credential(s). Remove them, rotate any real key, and use a secret store instead.`);
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Secret scan: ${files.length} tracked files, nothing credential-shaped.`);
