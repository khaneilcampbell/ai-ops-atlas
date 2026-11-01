import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goTo, openAtlas } from "./atlas";
import { answer, NOW } from "./github";

// Client inquiries (Inquiry to Client) in Mission Control, as the hosted page shows them: one new
// inquiry needing a reply, one replied with its first follow-up due, one closed. Screenshots go to
// visual/out/inquiries-*.png. Run with: npx playwright test -c visual/inquiries.config.ts
const OUT = join(import.meta.dirname, "out");
const shot = async (page: Page, name: string) => {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `inquiries-${name}.png`), animations: "disabled", caret: "hide" });
};
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const inquiries = [
  { id: "inq-new-0001", received_at: ago(2), category: "digital", category_label: "Digital Solutions", name: "Maya Thompson", email: "maya@northpeak.example", company: "Northpeak Dental", message: "We'd like to automate appointment reminders and intake forms for two clinics. Can you share pricing and a rough timeline?", host: "benjaire.com" },
  { id: "inq-replied-0002", received_at: ago(100), category: "partnership", category_label: "Partnership", name: "Jordan Lee", email: "jordan@brightlane.example", company: "", message: "I run a small agency and think we could refer clients to each other.", host: "benjaire.com" },
  { id: "inq-closed-0003", received_at: ago(300), category: "supplier", category_label: "Supplier / Manufacturing", name: "Ken Wu", email: "ken@factory.example", company: "Factory Co", message: "We manufacture laptop stands and would like to supply your store.", host: "benjaire.com" },
];
const progress = { "inq-replied-0002": { stage: "replied", repliedAt: ago(80), followUps: 0 }, "inq-closed-0003": { stage: "closed" } };

async function open(page: Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/inquiries") return route.fulfill({ json: { configured: true, inquiries } });
    if (u.pathname.startsWith("/api/github")) {
      const body = answer(u.pathname.slice("/api/github".length) + u.search);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page, { storage: { "mission-tab": "overview", inquiryProgress: progress } });
  await goTo(page, "Mission");
  const card = page.locator("#client-inquiries");
  await card.scrollIntoViewIfNeeded();
  return card;
}

test("the inbox shows what needs a reply or a follow-up and drafts the reply", async ({ page }) => {
  const card = await open(page);
  await expect(card.locator(".inquiry-chip")).toHaveText(["Reply needed", "Follow-up 1 due", "Done"]);
  await expect(card.locator(".card-head .chip")).toHaveText(/2 need you/);
  await card.screenshot({ path: join(OUT, "inquiries-1-card.png"), animations: "disabled", caret: "hide" });
  await shot(page, "2-mission");
  await card.getByRole("button", { name: "Mark replied" }).click();
  await expect(card.locator(".inquiry-chip").first()).toHaveText(/Follow-up 1/);
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the inbox fits the phone layout", async ({ page }) => {
    const card = await open(page);
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await card.screenshot({ path: join(OUT, "inquiries-3-phone.png"), animations: "disabled", caret: "hide" });
  });
});
