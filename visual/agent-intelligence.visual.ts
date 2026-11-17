import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { goTo, openAtlas, settle } from "./atlas";

// Agent intelligence on the three existing screens: Agent Detail → Intelligence, the Workflow
// Intelligence live-run evidence table, and a Task Center task's context, quality and feedback.
// The Task Center shot uses a fixture written to this browser's storage (one context record and
// one evaluation for the intake task), because nothing in a test run finishes an agent step.
// Nothing leaves the page. Screenshots go to visual/out/agent-intelligence/ (not baselines).
test.use({ deviceScaleFactor: 1 });
const out = process.env.INTEL_SHOTS ?? "visual/out/agent-intelligence";

for (const width of [1512, 390])
  test(`Agent intelligence ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(out, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await openAtlas(page, { storage: { "registry-prefs-agents": { view: "all" } } }); // the flat list (Essential roles is the default since 2026-11-17)

    // Agent Detail → Intelligence
    await goTo(page, "Agents");
    await page.locator('.reg-row[data-id="benjaire-product-lab-research"]').click();
    await settle(page, 1);
    const tab = page.getByRole("tab", { name: "Intelligence" });
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await settle(page, 1);
      await expect(page.locator(".intel-tab")).toContainText("Memory sources");
      await expect(page.locator(".intel-tab")).toContainText("Web search");
      await page.locator(".intel-tab").evaluate((e) => (e.closest(".reg-inspector")?.querySelector(".tabs") ?? e).scrollIntoView({ block: "start" }));
      await settle(page, 1);
    }
    await page.screenshot({ path: `${out}/agent-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    // On a phone the agent opens in a sheet; close it before moving on.
    const close = page.getByRole("button", { name: /^Close/ }).first();
    if (width < 700 && (await close.isVisible().catch(() => false))) await close.click();

    // Workflow Intelligence → live run
    await goTo(page, "Mission");
    await page.locator(".ghost-btn", { hasText: "Workflow Intelligence" }).first().click();
    await settle(page, 1);
    await page.getByRole("tab", { name: "Live" }).click();
    await page.getByRole("button", { name: /Start a live run/ }).click();
    await page.getByRole("button", { name: "Create tasks" }).click();
    await settle(page, 1);
    const coordinate = page.getByRole("button", { name: "Start coordinating" });
    if (await coordinate.isVisible().catch(() => false)) {
      await coordinate.click();
      await settle(page, 1);
    }
    const panel = page.locator(".wf-intel");
    if (await panel.count()) {
      await expect(panel).toContainText("Evidence and evaluation");
      await panel.evaluate((e) => e.scrollIntoView({ block: "start" }));
    } else await page.locator(".wf-exec").evaluate((e) => e.scrollIntoView({ block: "end" }));
    await settle(page, 1);
    await page.screenshot({ path: `${out}/workflow-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);

    // Task Center → the intake task, with a fixture context and evaluation.
    const taskId = await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem("atlas:tasks") ?? "{}").tasks as { id: string; agentId?: string }[];
      const t = tasks.find((x) => x.agentId === "agent-operations-lead")!;
      const at = new Date().toISOString();
      const file = {
        version: 1,
        rev: 1,
        memory: [],
        decisions: [],
        feedback: [],
        proposals: [],
        versions: [],
        audit: [],
        contexts: [
          {
            key: `${t.id}:1`,
            taskId: t.id,
            attempt: 1,
            agentId: "agent-operations-lead",
            at,
            query: "goal delegation approval budget agents",
            items: [
              { id: "seed:policy-approval-gates", title: "Human approval before development, spending, publication or deployment", category: "human_approved", verification: "verified", stale: false, tokens: 60, source: { kind: "repository", ref: "src/tasks/lifecycle.ts" } },
              { id: "seed:policy-model-use", title: "Keep model calls few: Haiku classifies, Sonnet summarises and reviews, Opus writes code", category: "human_approved", verification: "verified", stale: false, tokens: 70, source: { kind: "repository", ref: "src/usage/insights.ts" } },
            ],
            usedTokens: 130,
            budgetTokens: 1500,
            dropped: { "no-match": 6 },
            capabilities: ["memory.retrieve", "tasks.delegate", "decision.record"],
            route: { tier: 0, model: null, reason: "routing starts at tier 0" },
          },
        ],
        evaluations: [
          {
            id: `eval_${t.id}_1`,
            key: `${t.id}:1`,
            taskId: t.id,
            attempt: 1,
            agentId: "agent-operations-lead",
            promptVersion: "Not documented",
            model: "No model reported",
            taskType: "routing",
            at,
            metrics: { completion: 1, outputValid: 1, evidence: null, toolSelection: 1, policy: 1, reliability: 1, estimatedUsd: 0, billedUsd: 0, tokens: 0, latencyMs: 60000 },
            score: 100,
            flags: [],
          },
        ],
      };
      localStorage.setItem("atlas:agent-intel", JSON.stringify(file));
      return t.id;
    });
    expect(taskId).toBeTruthy();
    await page.reload();
    await settle(page, 2);
    await goTo(page, "Task Center");
    await page.locator(".task-title", { hasText: "Goal intake" }).first().click();
    await settle(page, 1);
    const ctx = page.locator(".section-title", { hasText: "Context used" });
    if (await ctx.count()) {
      await expect(page.getByText("Output quality")).toBeVisible();
      await ctx.evaluate((e) => e.scrollIntoView({ block: "start" }));
    }
    await settle(page, 1);
    await page.screenshot({ path: `${out}/task-${width}.png` });
  });
