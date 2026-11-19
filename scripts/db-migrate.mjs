#!/usr/bin/env node
// Applies the Atlas database migrations in db/migrations, in order, each in its own transaction,
// and records them in atlas.schema_migrations. Run it from your own machine with the database
// OWNER's connection string (not the atlas_app role the site uses):
//
//   ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs           apply new ones
//   ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs --status  list
//   ATLAS_MIGRATE_DATABASE_URL='postgres://…' node scripts/db-migrate.mjs --down    undo the newest
//
// The connection string is read from the environment only and never printed.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");
const FILE = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function migrations(dir = DIR) {
  return readdirSync(dir)
    .map((f) => ({ f, m: FILE.exec(f) }))
    .filter((x) => x.m && !x.f.endsWith(".down.sql"))
    .map(({ f, m }) => ({ version: Number(m[1]), name: m[2], up: join(dir, f), down: join(dir, f.replace(/\.sql$/, ".down.sql")) }))
    .sort((a, b) => a.version - b.version);
}

async function main() {
  const url = process.env.ATLAS_MIGRATE_DATABASE_URL;
  if (!url) {
    console.error("Set ATLAS_MIGRATE_DATABASE_URL to the database owner's postgres:// connection string.");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`CREATE SCHEMA IF NOT EXISTS atlas`;
    await sql`CREATE TABLE IF NOT EXISTS atlas.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await sql`SELECT version FROM atlas.schema_migrations`).map((r) => r.version));
    const all = migrations();
    const arg = process.argv[2];
    if (arg === "--status") {
      for (const m of all) console.log(`${done.has(m.version) ? "applied" : "pending"}  ${String(m.version).padStart(4, "0")}_${m.name}`);
      return;
    }
    if (arg === "--down") {
      const last = all.filter((m) => done.has(m.version)).pop();
      if (!last) return console.log("Nothing to undo.");
      await sql.begin((t) => t.unsafe(readFileSync(last.down, "utf8")));
      console.log(`Undid ${last.version}_${last.name}.`);
      return;
    }
    let applied = 0;
    for (const m of all) {
      if (done.has(m.version)) continue;
      await sql.begin(async (t) => {
        await t.unsafe(readFileSync(m.up, "utf8"));
        await t`INSERT INTO atlas.schema_migrations (version, name) VALUES (${m.version}, ${m.name})`;
      });
      console.log(`Applied ${m.version}_${m.name}.`);
      applied++;
    }
    if (!applied) console.log("Already up to date.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    // Postgres errors carry the failing statement's position, not the connection string.
    console.error(`Migration failed: ${e.message}`);
    process.exit(1);
  });
}
