import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { NOW } from "./github";
import { sampleGithub } from "./propertiesFixtures";

// Editing an agent's profile text on the hosted page, with the site's /api/data/profile-edits
// answered by a small in-memory stand-in for the database: open the editor, rename the persona and
// change the job title, see it on the profile and in the agent list, then put the title back.
// Screenshots go to SHOT_DIR when set. BEFORE=1 only takes the opening shots (for main).
const out = process.env.SHOT_DIR ?? "";
const AGENT = "repo-intelligence";

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  type Edit = { entity_id: string; field: string; value: string; updated_by: string; updated_at: string; version: number };
  const edits = new Map<string, Edit>();
  const log: unknown[] = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === "/api/data/profile-edits") {
      if (req.method() === "GET") return route.fulfill({ json: { edits: [...edits.values()], log } });
      const w = req.postDataJSON() as { entityId: string; field: string; value: string | null };
      const k = `${w.entityId}/${w.field}`;
      const before = edits.get(k);
      if (w.value === null) edits.delete(k);
      else edits.set(k, { entity_id: w.entityId, field: w.field, value: w.value, updated_by: "khaneil@example.com", updated_at: new Date(NOW).toISOString(), version: (before?.version ?? 0) + 1 });
      log.unshift({ entity_id: w.entityId, field: w.field, before: before?.value ?? null, after: w.value, actor: "khaneil@example.com", at: new Date(NOW).toISOString() });
      return route.fulfill({ status: before ? 200 : 201, json: { edit: edits.get(k) ?? null, changed: true } });
    }
    if (u.pathname.startsWith("/api/github")) {
      const body = sampleGithub(u.pathname.slice("/api/github".length) + u.search, NOW);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page, { storage: { "registry-prefs-agents": { view: "all" } } });
  await settle(page, 4);
  await goTo(page, "Agents");
  await page.getByRole("textbox", { name: "Search agents", exact: true }).fill(AGENT);
  await settle(page, 1);
  await page.locator(`.reg-row[data-id="${AGENT}"]`).click();
  await settle(page, 1);
}

const save = async (page: Page, name: string) => {
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/${name}.png` });
};
// Desktop shows the agent in the registry inspector; a phone shows it in the Details sheet.
const head = (page: Page) => (page.viewportSize()!.width < 700 ? page.getByRole("dialog", { name: "Details" }).locator(".panel-head") : page.locator(".reg-inspector .ap-head"));

for (const width of [1512, 390]) {
  test(`edit an agent's name and title, then undo the title, ${width}`, async ({ page }) => {
    await open(page, width);
    await head(page).scrollIntoViewIfNeeded();
    await save(page, `profile-${width}`);
    if (process.env.BEFORE) return;

    await head(page).getByRole("button", { name: "Edit profile text" }).click();
    await settle(page, 1);
    const form = page.getByRole("form", { name: /profile text/ });
    await form.getByLabel("Name", { exact: true }).fill("Kwame Asante");
    await form.getByLabel("Job title", { exact: true }).fill("Repository Health Analyst");
    await form.scrollIntoViewIfNeeded();
    await save(page, `editor-${width}`);
    await form.getByRole("button", { name: "Save 2 changes" }).click();
    await settle(page, 1);

    // The phone sheet heads with the job title; the desktop profile heads with the persona name.
    if (width >= 700) await expect(head(page).locator("h2")).toContainText("Kwame Asante");
    await expect(head(page)).toContainText("Repository Health Analyst");
    await expect(head(page).getByText("Edited in Atlas")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Every tab shows the new text" })).toBeVisible();
    await head(page).scrollIntoViewIfNeeded();
    await save(page, `saved-${width}`);

    await head(page).getByRole("button", { name: "Edit profile text" }).click();
    await page.getByRole("form", { name: /profile text/ }).getByRole("button", { name: "Use repository text" }).last().click();
    await settle(page, 1);
    await expect(page.getByRole("form", { name: /profile text/ }).getByLabel("Job title", { exact: true })).toHaveValue("Repository Intelligence Analyst");
    if (width >= 700) await expect(head(page).locator("h2")).toContainText("Kwame Asante");
    else await expect(head(page).locator("h2")).toContainText("Repository Intelligence Analyst");
    await page.getByRole("form", { name: /profile text/ }).locator(".profile-history summary").click();
    await page.getByRole("form", { name: /profile text/ }).scrollIntoViewIfNeeded();
    await save(page, `undo-${width}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
