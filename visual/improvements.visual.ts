import {expect,test} from "@playwright/test";
import {goTo,openAtlas,settle} from "./atlas";

test("reports-only improvement analyst is discoverable with its OpenAI workplace",async({page})=>{
  await openAtlas(page);
  await goTo(page,"Agents");
  await page.getByRole("textbox",{name:"Search agents",exact:true}).fill("AI Production Improvement Analyst");
  await settle(page,1);
  const row=page.locator('.reg-row[data-id="atlas-system-improvements"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("AI Production Improvement Analyst");
  await row.click();await settle(page,1);
  await expect(page.getByRole("button",{name:"Copy Codex review prompt",exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"Governance",exact:true}).click();
  await expect(page.getByText("Reports only. Does not open issues or pull requests, rerun CI, merge, deploy, or change credentials.",{exact:true})).toBeVisible();
});


test("OpenAI building seats the Atlas improvement role on its top floor",async({page})=>{
  await openAtlas(page,{storage:{mapProjectGrouping:"none"}});
  for(let i=0;i<6;i++){await page.getByRole("button",{name:"Zoom in",exact:true}).click();await settle(page,1);}
  await page.locator(".m3-plaque.secondary",{hasText:"OpenAI"}).dispatchEvent("click");await settle(page,2);
  const inspector=page.getByRole("complementary",{name:"Inspector"});
  await expect(inspector.getByRole("button",{name:"AI Production Improvement Analyst →",exact:true})).toBeVisible();
  await expect(inspector).toContainText("Floor 4 · Suite 401");
  await inspector.getByRole("button",{name:"AI Production Improvement Analyst →",exact:true}).click();await settle(page,1);
  await expect(inspector.getByRole("button",{name:"Copy Codex review prompt",exact:true})).toBeVisible();
  await page.locator(".m3-plaque.secondary",{hasText:"OpenAI"}).dispatchEvent("click");await settle(page,1);
  await inspector.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,3);
  const nav=page.getByRole("navigation",{name:"Choose OpenAI floor"});
  await nav.getByRole("button",{name:"Floor 4",exact:true}).click();await settle(page,3);
  await expect(page.getByRole("button",{name:/Suite 401.*AI Production Improvement Analyst/})).toBeVisible();
  await expect(page.getByRole("region",{name:"OpenAI interior"})).toContainText("Automatic reports are model-free");
  const {mkdirSync}=await import("node:fs");const {join}=await import("node:path");
  mkdirSync(join(import.meta.dirname,"out"),{recursive:true});
  await page.screenshot({path:join(import.meta.dirname,"out","openai-improvement-analyst.png")});
});
