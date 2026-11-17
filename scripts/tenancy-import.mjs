#!/usr/bin/env node
// Turns an Atlas device backup into SQL for the separate tenant database. Writes files only; it
// never connects to Cloudflare. Review the output, then apply it by hand (docs/multi-tenancy.md).
//
//   OWNER_EMAIL=<your Access email> node scripts/tenancy-import.mjs <backup.json> [out-dir]
//
// Writes <out-dir>/import.sql, verify.sql, rollback.sql and summary.json (default out-dir:
// tenancy-import/, which .gitignore keeps out of the repository because it holds private data).

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const [backupPath, outDir = "tenancy-import"] = process.argv.slice(2);
const owner = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
if (!backupPath || !owner.includes("@")) {
  console.error("Usage: OWNER_EMAIL=<access email> node scripts/tenancy-import.mjs <backup.json> [out-dir]");
  process.exit(2);
}

// Load src/tenancy/legacyImport.ts and its one dependency without a build step.
const tmp = mkdtempSync(join(tmpdir(), "atlas-import-"));
for (const name of ["model", "legacyImport"]) {
  const src = readFileSync(new URL(`../src/tenancy/${name}.ts`, import.meta.url), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/from "\.\/model"/g, 'from "./model.mjs"');
  writeFileSync(join(tmp, `${name}.mjs`), js);
}
const { planImport, importSql, verificationSql, rollbackSql } = await import(pathToFileURL(join(tmp, "legacyImport.mjs")).href);

const backup = JSON.parse(readFileSync(backupPath, "utf8"));
const opts = { orgId: process.env.ORG_ID ?? "org_benjaire", slug: process.env.ORG_SLUG ?? "benjaire", name: process.env.ORG_NAME ?? "Benjaire", ownerUserId: owner, at: new Date().toISOString() };
const plan = planImport(backup, opts);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "import.sql"), importSql(plan, opts));
writeFileSync(join(outDir, "verify.sql"), verificationSql(opts.orgId));
writeFileSync(join(outDir, "rollback.sql"), rollbackSql(opts.orgId));
writeFileSync(join(outDir, "summary.json"), JSON.stringify({ orgId: opts.orgId, expected: plan.expected, refs: plan.refs.length, workspaces: plan.workspaces, leftOnDevice: plan.leftOnDevice, warnings: plan.warnings }, null, 2));
console.log(JSON.stringify({ out: outDir, expected: plan.expected, refs: plan.refs.length, warnings: plan.warnings.length }, null, 2));
