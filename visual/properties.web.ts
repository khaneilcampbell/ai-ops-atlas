import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { openAtlas, selectBuilding, settle } from "./atlas";
import { answer, NOW } from "./github";

// The live website dashboards on Benjaire HQ and Portfolio Site, as the hosted page shows them.
// benjaire.com: the newest Workers Builds deploy failed and the certificate is ten days from its
// end, so two incidents show. khaneilcampbell.com: healthy, with Cloudflare and Uptime Kuma not
// connected yet. Screenshots go to visual/out/properties-*.png.
// Run with: npx playwright test -c visual/properties.config.ts
const OUT = join(import.meta.dirname, "out");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const ahead = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const ok = <T,>(source: string, data: T) => ({ state: "ok", source, checkedAt: ago(0.1), data });
const none = (source: string, need: string) => ({ state: "not-configured", source, need });

function site(domain: string, broken: boolean) {
  return {
    domain,
    checks: {
      domain: ok("RDAP (rdap.org)", { registrar: "Cloudflare, Inc.", registeredAt: "2025-04-02T00:00:00.000Z", expiresAt: ahead(broken ? 150 : 290), updatedAt: null, status: ["client transfer prohibited"], nameservers: ["adam.ns.cloudflare.com", "nova.ns.cloudflare.com"], dnssec: false }),
      dns: ok("Cloudflare DNS over HTTPS", { a: ["104.21.32.1", "172.67.160.1"], aaaa: ["2606:4700:3030::1"], ns: broken ? ["adam.ns.cloudflare.com", "nova.ns.cloudflare.com"] : ["dns1.registrar-servers.com"], mx: broken ? ["10 route1.mx.cloudflare.net"] : [], caa: [], www: [domain], validated: false }),
      tls: ok("Certificate Transparency logs (crt.sh)", { issuer: broken ? "Google Trust Services" : "Let's Encrypt", notBefore: ago(24 * 80), notAfter: ahead(broken ? 10 : 61), names: [domain, `www.${domain}`], current: 1 }),
      probe: ok("HTTPS request", { status: 200, ms: broken ? 184 : 96, finalUrl: `https://${domain}/`, cloudflare: broken, hsts: broken }),
      performance: ok("Google PageSpeed Insights, mobile", { strategy: "mobile", score: broken ? 78 : 97, lcpMs: broken ? 2900 : 1200, cls: 0.02, tbtMs: 60, field: null, reportUrl: `https://pagespeed.web.dev/analysis?url=https%3A%2F%2F${domain}%2F` }),
      traffic: none("Cloudflare analytics", "A read-only Cloudflare API token on the site (CLOUDFLARE_API_TOKEN)."),
      edgeEvents: none("Cloudflare audit log", "A read-only Cloudflare API token on the site (CLOUDFLARE_API_TOKEN)."),
      uptime: none("Uptime Kuma", "The address of KC's Uptime Kuma and a public status page (UPTIME_KUMA_URL)."),
    },
  };
}

function github(path: string): unknown {
  const checks = /^\/repos\/khaneilcampbell\/benjaire\.com\/commits\/([0-9a-f]+)\/check-runs/.exec(path);
  if (checks) {
    const newest = (answer("/repos/khaneilcampbell/benjaire.com/commits") as { sha: string }[])[0].sha;
    const failed = checks[1] === newest;
    return { total_count: 1, check_runs: [{ id: failed ? 71 : 70, name: "Workers Builds: benjaire-com", status: "completed", conclusion: failed ? "failure" : "success", started_at: ago(failed ? 0.6 : 5), completed_at: ago(failed ? 0.5 : 4.9), details_url: "https://dash.cloudflare.com/builds/71" }] };
  }
  if (/^\/repos\/khaneilcampbell\/khaneilcampbell\.com\/deployments\?/.test(path)) return [{ id: 501, sha: "c0ffee1".padEnd(40, "0"), environment: "github-pages", created_at: ago(26) }];
  if (/^\/repos\/khaneilcampbell\/khaneilcampbell\.com\/deployments\/501\/statuses/.test(path)) return [{ state: "success", created_at: ago(25.9), log_url: "https://github.com/khaneilcampbell/khaneilcampbell.com/actions/runs/1" }];
  return answer(path);
}

async function open(page: Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/properties") {
      const domain = u.searchParams.get("domain")!;
      return route.fulfill({ json: site(domain, domain === "benjaire.com") });
    }
    if (u.pathname.startsWith("/api/github")) {
      const body = github(u.pathname.slice("/api/github".length) + u.search);
      return route.fulfill({ status: body == null ? 404 : 200, json: body ?? { message: "Not Found" } });
    }
    return route.fulfill({ status: 404, json: { message: "Not in this check." } });
  });
  await openAtlas(page);
  await settle(page, 4);
}

const inspector = (page: Page) => page.getByRole("complementary", { name: "Inspector" }).or(page.getByRole("dialog", { name: "Details" }));

test("a failed deploy is an incident on Benjaire HQ, with links to act", async ({ page }) => {
  await open(page);
  await expect(page.locator(".property-pill")).toHaveText(/2 website incidents/);
  mkdirSync(OUT, { recursive: true });
  await page.locator(".header").screenshot({ path: join(OUT, "properties-1-header.png") });
  await page.locator(".property-pill").click();
  await settle(page, 4);
  const dash = inspector(page).locator(".property");
  await expect(dash.locator(".property-incident")).toHaveCount(2);
  await expect(dash.locator(".property-incident").first()).toContainText("Production deploy failed");
  await expect(dash.locator(".property-incident").first().getByRole("link", { name: /Fix with Claude/ })).toHaveAttribute("href", /labels=claude-fix/);
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Failed");
  await expect(dash.locator(".property-tile", { hasText: "Traffic" })).toContainText("Needs Cloudflare analytics");
  await page.screenshot({ path: join(OUT, "properties-2-benjaire.png"), animations: "disabled", caret: "hide" });
  
  await dash.locator(".property-incident").first().getByRole("button", { name: "Dismiss" }).click();
  await expect(dash.locator(".property-incident")).toHaveCount(1);
});

test("a healthy site shows every signal and what still needs connecting", async ({ page }) => {
  await open(page);
  await selectBuilding(page, "Portfolio Site");
  const dash = inspector(page).locator(".property");
  await expect(dash.locator(".property-chip")).toHaveText("No incidents");
  await expect(dash.locator(".property-tile", { hasText: "Deploys" })).toContainText("Live");
  await expect(dash.locator(".property-tile", { hasText: "SSL certificate" })).toContainText(/6\d days left/);
  await page.screenshot({ path: join(OUT, "properties-4-portfolio.png"), animations: "disabled", caret: "hide" });
});

test.describe("on iPhone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  test("the dashboard fits the phone panel", async ({ page }) => {
    await open(page);
    await page.locator(".property-pill").click();
    await settle(page, 4);
    const dash = inspector(page).locator(".property");
    await expect(dash).toBeVisible();
    await dash.scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, "properties-5-phone.png"), animations: "disabled", caret: "hide" });
  });
});
