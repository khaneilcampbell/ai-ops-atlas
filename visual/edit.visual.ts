import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas, settle } from "./atlas";
import { answer } from "./github";

// The in-app editor, end to end, in the desktop app's shape: a stand-in for the Tauri bridge
// answers GitHub reads from the fixtures and records the one edit the page sends, so the test
// sees exactly what would reach the Rust side. No screenshot baselines: it checks behaviour,
// and SHOTS=1 writes pictures of each step to visual/out/ for looking at.

const SHOTS = !!process.env.SHOTS;
const OUT = join(import.meta.dirname, "out");
const ATLAS = "khaneilcampbell/ai-ops-atlas";
const SITE = "khaneilcampbell/benjaire.com";

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `edit-${name}.png`), animations: "disabled", caret: "hide" });
}

/** Pretends to be the Mac app: editing switched on for two repositories, and every command answered. */
async function desktop(page: Page, sent: unknown[]) {
  await page.exposeFunction("__github", (path: string) => answer(path));
  await page.exposeFunction("__sent", (req: unknown) => sent.push(req));
  await page.addInitScript(
    ({ repos }) => {
      let cb = 0;
      const status = {
        config: { rerun_failed_jobs: { enabled: false, repos: [] }, token_login: null, merge_pull_requests: { enabled: true, repos, token_logins: {} }, edit_files: { enabled: true, repos } },
        token: false,
        merge_tokens: repos.map((r: string) => r.toLowerCase()),
      };
      const w = window as unknown as Record<string, unknown>;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => ++cb,
        unregisterCallback: () => undefined,
        invoke: async (cmd: string, args: Record<string, unknown>) => {
          if (cmd === "github_get") {
            const body = await (w.__github as (p: string) => Promise<unknown>)(String(args.path));
            return { status: body == null ? 404 : 200, body, etag: null, authed: true, rate: null };
          }
          if (cmd === "vault_status" || cmd === "vault_unlock") return { state: "unlocked" };
          if (cmd === "actions_status") return status;
          if (cmd === "actions_audit") return [];
          if (cmd === "action_propose_edit") {
            await (w.__sent as (r: unknown) => Promise<void>)(args.request);
            return {
              stage: "opened",
              reason: null,
              message: `Opened pull request #93 on ${(args.request as { repo: string }).repo} into main. Nothing is merged until you merge it.`,
              audit_id: "a",
              pull_number: 93,
              pull_url: "https://github.com/khaneilcampbell/ai-ops-atlas/pull/93",
              branch: "atlas-edit/readme-md-20261028-150000",
            };
          }
          if (cmd.startsWith("plugin:event|")) return cb;
          if (cmd.endsWith("_status") || cmd.endsWith("_runs") || cmd.endsWith("_reports")) throw new Error("not in this test");
          return null;
        },
      };
    },
    { repos: [ATLAS, SITE] },
  );
}

test("read-only until the Edit switch is on, then a file edit opens a pull request", async ({ page }) => {
  const sent: unknown[] = [];
  await desktop(page, sent);
  await openAtlas(page);
  await goTo(page, "Repos");
  await page.locator(".repo-card", { has: page.locator(".rname", { hasText: /^benjaire\.com$/ }) }).click();
  await settle(page);
  await expect(page.getByRole("button", { name: "Edit files" })).toHaveCount(0);

  await page.getByRole("button", { name: /^Edit$/ }).click();
  await expect(page.getByRole("button", { name: "Edit files" })).toBeVisible();
  await page.getByRole("button", { name: "Edit files" }).click();
  await settle(page);
  await expect(page.locator(".edit-files")).toContainText("README.md");
  await expect(page.locator(".edit-files")).toContainText("docs/");
  await shot(page, "1-file-picker");

  await page.locator(".edit-files button", { hasText: "README.md" }).click();
  await settle(page);
  const box = page.getByLabel("Contents of README.md");
  await expect(box).toHaveValue(/# Sample project/);
  await box.fill((await box.inputValue()).replace("A short description of the project.", "A short description of the project, edited in Atlas."));
  await shot(page, "2-editing");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.locator(".diff-head")).toContainText("+1");
  await expect(page.locator(".diff-head")).toContainText("−1");
  await expect(page.locator(".diff-line.del")).toContainText("A short description of the project.");
  await expect(page.locator(".diff-line.add")).toContainText("edited in Atlas.");
  await shot(page, "3-review");

  await page.getByRole("button", { name: "Open pull request" }).click();
  await expect(page.locator(".edit-done")).toContainText("Opened pull request #93");
  await shot(page, "4-opened");
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ repo: SITE, path: "README.md", title: "Edit README.md" });
  expect((sent[0] as { base_sha: string }).base_sha).toMatch(/^[0-9a-f]{40}$/);
  expect((sent[0] as { content: string }).content).toContain("edited in Atlas.");
});

test("agent details edit shows the manifest diff before anything is sent", async ({ page }) => {
  const sent: unknown[] = [];
  await desktop(page, sent);
  await openAtlas(page);
  await goTo(page, "Automations");
  await page.locator('.reg-row[data-id="benjaire-contact-worker"]').click();
  await settle(page);
  await page.getByRole("button", { name: /^Edit$/ }).click();
  await page.getByRole("button", { name: "Edit details" }).first().click();
  await settle(page);
  await expect(page.locator(".edit-sheet").getByLabel("Name", { exact: true })).toHaveValue("Contact Form Worker");
  const sheet = page.locator(".edit-sheet");
  await sheet.getByLabel("Status").selectOption("paused");
  await sheet.getByLabel("Schedule").fill("Daily at 06:00 UTC");
  await shot(page, "5-agent-form");
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.locator(".diff-head")).toContainText("catalog/benjaire-com.yaml");
  await expect(page.locator(".diff-line.del")).toContainText("status: active");
  await expect(page.locator(".diff-line.add").first()).toContainText("status: paused");
  await expect(page.locator(".diff-line.add").nth(1)).toContainText("schedule: Daily at 06:00 UTC");
  await shot(page, "6-agent-review");
  expect(sent).toHaveLength(0);
});

test("phone: the editor fills the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await desktop(page, []);
  await openAtlas(page);
  await goTo(page, "Repos");
  await page.locator(".repo-card", { has: page.locator(".rname", { hasText: /^benjaire\.com$/ }) }).click();
  await settle(page);
  // The inspector covers the header on a phone, so it offers the switch itself.
  await page.getByRole("button", { name: "Turn on editing", exact: true }).click();
  await page.getByRole("button", { name: "Edit details" }).click();
  await settle(page);
  await expect(page.locator(".edit-sheet").getByLabel("Summary")).toBeVisible();
  const sheet = await page.locator(".edit-sheet").boundingBox();
  expect(sheet!.width).toBe(390);
  await shot(page, "7-phone-form");
});
