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

const posted: unknown[] = [];

async function open(page: Page, canSend = false) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/inquiries/reply") {
      posted.push(route.request().postDataJSON());
      return route.fulfill({ json: { sent: true, to: "maya@northpeak.example" } });
    }
    if (u.pathname === "/api/inquiries") return route.fulfill({ json: { configured: true, reply: { enabled: canSend }, inquiries } });
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

test("Draft reply puts the branded email on the clipboard and opens Gmail", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    (window as unknown as { opened: string[] }).opened = [];
    window.open = ((url: string) => {
      (window as unknown as { opened: string[] }).opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  const card = await open(page);
  await card.getByRole("button", { name: "Draft reply" }).click();
  await expect(card.getByRole("status")).toBeVisible();
  const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(opened).toEqual(["https://mail.google.com/mail/?view=cm&fs=1&to=maya%40northpeak.example&su=Re%3A%20your%20Digital%20Solutions%20inquiry&body="]);
  await expect(card.getByRole("status")).toContainText("Branded reply copied");
  const html = await page.evaluate(async () => {
    const item = (await navigator.clipboard.read())[0];
    return item.types.includes("text/html") ? await (await item.getType("text/html")).text() : "";
  });
  expect(html).toContain("email-header-banner.png");
  expect(html).toContain("Hi Maya,");
  await card.screenshot({ path: join(OUT, "inquiries-4-copied.png"), animations: "disabled", caret: "hide" });
});

test("with sending set up, Draft reply opens an editor with the designed preview and Send emails it once", async ({ page }) => {
  posted.length = 0;
  const card = await open(page, true);
  await card.getByRole("button", { name: "Draft reply" }).click();
  const composer = card.getByRole("group", { name: "Reply to Maya Thompson" });
  await expect(composer).toBeVisible();
  await expect(composer.getByLabel("Subject")).toHaveValue("Re: your Digital Solutions inquiry");
  const frame = composer.frameLocator("iframe");
  await expect(frame.locator("img[alt=Benjaire]")).toHaveCount(1);
  await expect(frame.locator("body")).toContainText("Hi Maya,");
  await composer.getByLabel("Message").fill("Hi Maya,\n\nThanks for writing in. Happy to talk this week.");
  await expect(frame.locator("body")).toContainText("Happy to talk this week.");
  await composer.screenshot({ path: join(OUT, "inquiries-5-composer.png"), animations: "disabled", caret: "hide" });
  await composer.getByRole("button", { name: "Send to maya@northpeak.example" }).click();
  await expect(card.getByRole("status")).toContainText("Sent to maya@northpeak.example");
  await expect(composer).toHaveCount(0);
  await expect(card.locator(".inquiry-chip").first()).toHaveText(/Follow-up 1/);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ id: "inq-new-0001", subject: "Re: your Digital Solutions inquiry", body: expect.stringContaining("Happy to talk this week.") });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the inbox fits the phone layout", async ({ page }) => {
    const card = await open(page);
    const box = (await card.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await card.screenshot({ path: join(OUT, "inquiries-3-phone.png"), animations: "disabled", caret: "hide" });
  });

  test("the reply editor fits the phone layout", async ({ page }) => {
    const card = await open(page, true);
    await card.getByRole("button", { name: "Draft reply" }).click();
    const composer = card.getByRole("group", { name: "Reply to Maya Thompson" });
    await expect(composer).toBeVisible();
    const box = (await composer.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await composer.screenshot({ path: join(OUT, "inquiries-6-composer-phone.png"), animations: "disabled", caret: "hide" });
  });
});
