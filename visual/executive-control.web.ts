import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { answer } from "./github";
import type { Db } from "../server/data/db";
import { advance, overview, receiveResult, submitGoal, type Deps } from "../server/executive/engine";
import { mockAdapter, resultFor } from "../server/executive/mockAdapter";
import { rosterFromFiles } from "../server/executive/roster";

// Mission Control > Atlas Executive as the hosted page shows it. The overview is not hand-written:
// the real engine runs on an in-memory PostgreSQL (PGlite) with the test-only mock n8n, so the
// screenshot shows exactly what the engine stores. The report is the labelled development example.
// Screenshots go to visual/out/executive-control/ (not baselines).
// Run with: npx playwright test -c visual/executive-control.config.ts
const OUT = process.env.EXEC_CONTROL_SHOTS ?? join(import.meta.dirname, "out", "executive-control");
const OBJECTIVE = "Research one potential Benjaire AI automation product and prepare a structured opportunity report.";

function pgliteDb(p: Pick<PGlite, "query">, top?: PGlite): Db {
  const self: Db = {
    query: async <T,>(text: string, params: unknown[] = []) => (await p.query<T>(text, params)).rows,
    tx: async <T,>(fn: (d: Db) => Promise<T>) => (top ? top.transaction((t) => fn(pgliteDb(t))) : fn(self)),
  };
  return self;
}

async function engineOverview() {
  const pg = new PGlite();
  const mig = (f: string) => readFileSync(join(import.meta.dirname, "..", "db", "migrations", f), "utf8");
  await pg.exec(mig("0001_atlas_core.sql"));
  await pg.exec(mig("0002_executive.sql"));
  const dir = join(import.meta.dirname, "..", "catalog");
  const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".yaml")).map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  // As it will be once the n8n workflows are published and the catalog says active.
  const roster = rosterFromFiles(files).map((a) => (a.id === "atlas-executive" ? { ...a, status: "active" } : a));
  const adapter = mockAdapter();
  const d: Deps = { db: pgliteDb(pg, pg), adapter, roster: async () => roster, stop: async () => null };
  const done = await submitGoal(d, { objective: OBJECTIVE }, "khaneil@example.com");
  await receiveResult(d, resultFor(adapter.sent[0]));
  await submitGoal(d, { objective: "Research a second Benjaire automation product idea for small agencies.", autonomy: 1 }, "khaneil@example.com");
  await submitGoal(d, { objective: "Maintain the Benjaire website and keep it healthy every week." }, "khaneil@example.com");
  await advance(d, done.id, "visual");
  const o = await overview(d, { database: true, n8n: true, schedule: true }, new Map(roster.map((a) => [a.id, a.name])));
  await pg.close();
  return o;
}

async function open(page: Page, data: unknown) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/executive/overview") return route.fulfill({ status: 200, json: data });
    if (u.pathname.startsWith("/api/github")) {
      const body = answer(u.pathname.slice("/api/github".length) + u.search);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page);
  await goTo(page, "Mission");
  const card = page.locator(".exec-ctl");
  await card.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await settle(page, 1);
  return card;
}

test.use({ deviceScaleFactor: 2 });

for (const width of [1512, 390]) {
  test(`Atlas Executive ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 1100 });
    const data = await engineOverview();
    const card = await open(page, data);
    await expect(card).toContainText("Atlas Executive");
    await expect(card).toContainText("Waiting for your approval");
    await expect(card).toContainText("Blocked");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await card.screenshot({ path: join(OUT, `overview-${width}.png`) });
    await card.locator(".exec-goal-top", { hasText: "Research one potential Benjaire" }).click();
    await settle(page, 1);
    await expect(card).toContainText("Verified report: Development example (not research)");
    await card.locator(".exec-goal").filter({ hasText: "Verified report" }).screenshot({ path: join(OUT, `completed-goal-${width}.png`) });
  });

  test(`Atlas Executive not set up ${width}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/executive/overview", (r) => r.fulfill({ status: 503, json: { message: "The Executive's tables aren't in the database yet: apply db/migrations/0002_executive.sql." } }));
    await openAtlas(page);
    await goTo(page, "Mission");
    const card = page.locator(".exec-ctl");
    await expect(card).toContainText("apply db/migrations/0002_executive.sql");
    await card.screenshot({ path: join(OUT, `not-set-up-${width}.png`) });
  });
}
