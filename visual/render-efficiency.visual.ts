import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openAtlas, selectBuilding, settle, waitForOffice, waitForScene } from './atlas';

test('static scenes sleep, wake for controls, and suspend when hidden', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __draws: number }).__draws = 0;
    for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
      for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const p = C.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
        const original = p[key];
        if (original) p[key] = function (...args) { (window as unknown as { __draws: number }).__draws++; return original.apply(this, args); };
      }
    }
  });
  await openAtlas(page);
  await waitForScene(page);
  // Let mount, camera damping, and any focus wake finish before measuring static idle.
  await page.clock.runFor(2000);
  const read = () => page.evaluate(() => (window as unknown as { __draws: number }).__draws);
  const before = await read(); await page.clock.runFor(1000);
  console.log(`STATIC_IDLE draws/s ${(await read())-before}`);
  expect.soft(await read()).toBe(before);
  await page.mouse.move(700, 450); await page.mouse.wheel(0, -80); await page.clock.runFor(500);
  expect(await read()).toBeGreaterThan(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  // A frame already queued by React/controls may finish; the pump must then stop.
  await page.clock.runFor(100);
  const hidden = await read(); await page.clock.runFor(1000); expect(await read()).toBe(hidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(page);
  mkdirSync('artifacts/render-efficiency', {recursive:true});
  await page.screenshot({path:'artifacts/render-efficiency/desktop.png'});
  await page.setViewportSize({width:390,height:844}); await settle(page);
  await page.screenshot({path:'artifacts/render-efficiency/phone.png'});
});

test('night effect survives adaptive resolution and day/night switching', async ({page}) => {
  await openAtlas(page, {light:'night'}); await waitForScene(page);
  await page.evaluate(async () => {
    const path = '/src/lib/power.ts'; const power = await import(path); power.setPowerMode('saver');
  });
  await settle(page, 4);
  const canvas = page.locator('.map3d canvas').first();
  expect(await canvas.evaluate(el => (el as HTMLCanvasElement).width / el.getBoundingClientRect().width)).toBeCloseTo(1.5, 1);
  await page.getByRole('button',{name:'Night mode', exact:true}).click(); await settle(page, 4);
  await expect(page.getByRole('button',{name:'Night mode', exact:true})).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Night mode', exact:true}).click(); await settle(page, 4);
  await expect(page.getByRole('button',{name:'Night mode', exact:true})).toHaveAttribute('aria-pressed','true');
  mkdirSync('artifacts/render-efficiency', {recursive:true});
  await page.screenshot({path:'artifacts/render-efficiency/night.png'});
  await selectBuilding(page, 'Atlas HQ');
  await page.getByRole('button', {name:'Enter building',exact:true}).click();
  await settle(page,4); await waitForOffice(page);
  await page.screenshot({path:'artifacts/render-efficiency/office-night.png'});
});
