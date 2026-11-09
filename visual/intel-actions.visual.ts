import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { answer, NOW } from "./github";
import { atlasReport, ecoReport, intelStatus, trackingAnswer } from "./intel-fixtures";

// Repository Insights and Intel → Engineering review, the two Tauri-only screens. The page gets a
// stand-in for the desktop bridge (window.__TAURI_INTERNALS__) that answers the intel commands
// with SAMPLE fixtures and GitHub reads from visual/github.ts. Screenshots land in
// visual/out/intel-actions/<phase>/ for the pull request; INTEL_PHASE=before skips assertions.
const PHASE = process.env.INTEL_PHASE ?? "after";
const OUT = join(import.meta.dirname, "out", "intel-actions", PHASE);
const CHECK = PHASE === "after";
const ATLAS = "khaneilcampbell/ai-ops-atlas";

async function openDesktop(page: Page, resume: { view: string; selection?: { kind: string; id: string } }) {
  await page.exposeFunction("__atlasGithub", (path: string) => trackingAnswer(path) ?? answer(path) ?? null);
  await page.addInitScript(
    ({ status, reports, review, resume }) => {
      localStorage.clear();
      localStorage.setItem("atlas:mapMode", JSON.stringify("2d"));
      let id = 1;
      const answers: Record<string, unknown> = {
        intel_status: status,
        intel_reports: reports,
        intel_report: reports[0],
        review_report: review,
        intel_runs: [],
        vault_status: { state: "unlocked" },
        vault_unlock: { state: "unlocked" },
        take_resume: JSON.stringify(resume),
        anthropic_key_status: true,
        github_token_status: true,
      };
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        transformCallback: () => id++,
        unregisterCallback: () => undefined,
        convertFileSrc: (p: string) => p,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          if (cmd === "github_get") {
            const body = await (window as unknown as { __atlasGithub: (p: string) => Promise<unknown> }).__atlasGithub(String(args.path));
            return { status: body == null ? 404 : 200, etag: null, authed: true, rate: null, body };
          }
          if (cmd.startsWith("plugin:event|")) return id++;
          if (cmd in answers) return answers[cmd];
          return null;
        },
      };
    },
    { status: intelStatus, reports: [atlasReport], review: ecoReport, resume },
  );
  await page.clock.install({ time: NOW });
  await page.goto("/");
  await expect(page.locator(".nav-item").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.clock.fastForward(1000);
}

async function shot(page: Page, name: string, selector: string, full = false) {
  mkdirSync(OUT, { recursive: true });
  const el = page.locator(selector).first();
  // The page scrolls inside the app shell, so a tall element would be cut off: grow the window to fit it.
  const vp = page.viewportSize()!;
  const h = await el.evaluate((n) => n.scrollHeight);
  if (h + 300 > vp.height) {
    await page.setViewportSize({ width: vp.width, height: Math.min(h + 300, 8000) });
    await page.clock.runFor(50);
  }
  await el.scrollIntoViewIfNeeded();
  if (full) await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true, animations: "disabled", caret: "hide" });
  else await el.screenshot({ path: join(OUT, `${name}.png`), animations: "disabled", caret: "hide" });
}

async function openReview(page: Page) {
  await openDesktop(page, { view: "intel" });
  await page.getByRole("button", { name: "Engineering review" }).or(page.getByRole("tab", { name: "Engineering review" })).first().click();
  await expect(page.locator(".review .ai-box")).toBeVisible();
}

async function openInsights(page: Page) {
  await openDesktop(page, { view: "repos", selection: { kind: "repo", id: ATLAS } });
  await page.getByRole("tab", { name: "Insights" }).click();
  await expect(page.locator(".intel .ai-box")).toBeVisible();
}

async function checkReview(page: Page) {
  const box = page.locator(".review");
  // Alert reference → GitHub's alert page.
  const alert = box.locator('a.ref-link[href$="/security/dependabot/17"]').first();
  await expect(alert).toBeVisible();
  // Agent reference → an in-app button that opens the agent.
  await expect(box.locator('button.ref-link', { hasText: "Commerce Loop" }).first()).toBeVisible();
  // An id the facts don't contain stays plain text.
  await expect(box.locator("span.ref", { hasText: "made-up:ref" })).toBeVisible();
  // Every scorecard area shows, missing ones as unknown.
  await expect(box.locator(".score")).toHaveCount(9);
  await expect(box.locator(".score", { hasText: "Not rated in this review" }).first()).toBeVisible();
  // Recommendations: the owner opens its agent, KC, or unknown; Fix with Claude and Open issue per repository.
  const rec = box.locator(".recs > li").first();
  await expect(rec.locator(".rec-meta button.ref-link", { hasText: "Commerce Loop" })).toBeVisible();
  await expect(box.locator(".recs > li").nth(1)).toContainText("Owner: KC");
  await expect(box.locator(".recs > li").nth(2)).toContainText("Owner unknown");
  const fix = new URL((await rec.locator(".fix-claude").first().getAttribute("href"))!);
  expect(fix.pathname).toBe(`/${ATLAS}/issues/new`);
  expect(fix.searchParams.get("labels")).toBe("claude-fix");
  expect(fix.searchParams.get("body")).toContain("khaneilcampbell/multi-agent-commerce-pipeline");
  await expect(rec.locator(".codex-copy").first()).toContainText("Copy Codex prompt");
  const issue = new URL((await rec.locator(".open-issue").first().getAttribute("href"))!);
  expect(issue.pathname).toBe("/khaneilcampbell/multi-agent-commerce-pipeline/issues/new");
  expect(issue.searchParams.get("labels")).toBeNull();
  // Earlier hand-offs are found again: the VPS fix request has a merged PR, minimatch an open issue.
  await expect(rec.locator(".rec-status.done")).toContainText("Fixed in PR #31");
  await expect(box.locator(".recs > li").nth(2).locator(".rec-status")).toContainText("Issue #240 open");
  // The recommendation that names only agents still reaches their repositories.
  await expect(box.locator(".recs > li").nth(1).locator(".fix-claude")).toHaveCount(2);
  // An unreadable repository is shown as unknown with GitHub's reason.
  await expect(page.locator(".verified-box")).toContainText("GitHub returned 403");
}

async function checkInsights(page: Page) {
  const panel = page.locator(".intel");
  await expect(panel.locator('a[href$="/security/dependabot"]').first()).toBeVisible();
  await expect(panel.locator('a[href$="/security/dependabot/17"]').first()).toBeVisible();
  await expect(panel.locator(".ai-box")).toContainText("AI-generated, not verified");
  await expect(panel.locator(".ai-box")).toContainText("Unknown: Claude couldn't tell from the data");
  await expect(panel.locator(".ai-box .fix-claude").first()).toBeVisible();
}

test("engineering review: links, unknowns and hand-off", async ({ page }) => {
  await openReview(page);
  if (CHECK) await checkReview(page);
  await shot(page, "desktop-review", ".review");
});

test("insights: alerts, assessment and hand-off", async ({ page }) => {
  await openInsights(page);
  if (CHECK) await checkInsights(page);
  await shot(page, "desktop-insights-alerts", ".intel .verified-box");
  await shot(page, "desktop-insights-assessment", ".intel .ai-box");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("engineering review fits a phone", async ({ page }) => {
    await openReview(page);
    if (CHECK) {
      for (const b of await page.locator(".review .fix-claude, .review .open-issue, .review .codex-copy").all()) {
        const box = (await b.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(390);
      }
    }
    await shot(page, "phone-review", ".review");
  });

  test("insights fits a phone", async ({ page }) => {
    await openInsights(page);
    await shot(page, "phone-insights-alerts", ".intel .verified-box");
    await shot(page, "phone-insights-assessment", ".intel .ai-box");
  });
});
