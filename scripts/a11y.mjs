// Accessibility and layout check against a running `wrangler dev` (local
// Access bypass). axe at WCAG 2.2 AA in light and dark, desktop and phone.
// Usage: node scripts/a11y.mjs [baseUrl] [screenshotDir]
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const shots = process.argv[3];
const pages = ['/', '/website', '/finance?month=2026-10', '/connections', '/audit'];
const views = [
  { name: 'desktop', width: 1280, height: 860 },
  { name: 'phone', width: 390, height: 844 },
];

// CHROMIUM_PATH lets sandboxes with a preinstalled browser skip the download.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failures = 0;
for (const theme of ['light', 'dark']) {
  for (const v of views) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: theme });
    const page = await ctx.newPage();
    for (const path of pages) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      const label = `${theme} ${v.name} ${path}`;
      if (overflow) {
        failures++;
        console.log(`FAIL ${label}: page scrolls horizontally`);
      }
      for (const x of violations) {
        failures++;
        console.log(`FAIL ${label}: ${x.id} (${x.nodes.length}) ${x.help}`);
        for (const n of x.nodes.slice(0, 3)) console.log('   ', n.target.join(' '), n.failureSummary?.split('\n')[1] ?? '');
      }
      if (!overflow && !violations.length) console.log(`ok   ${label}`);
      if (shots) await page.screenshot({ path: `${shots}/${theme}-${v.name}-${path.split('?')[0].replace(/\//g, '_') || '_'}.png`, fullPage: true });
    }
    await ctx.close();
  }
}
await browser.close();
process.exit(failures ? 1 : 0);
