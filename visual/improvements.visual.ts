import {expect,test} from "@playwright/test";
import {goTo,openAtlas,settle} from "./atlas";

test("reports-only improvement analyst is discoverable as an automation",async({page})=>{
  await openAtlas(page);
  await goTo(page,"Automations");
  await page.getByRole("textbox",{name:"Search automations",exact:true}).fill("System Improvement Analyst");
  await settle(page,1);
  const row=page.locator('.reg-row[data-id="atlas-system-improvements"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("System Improvement Analyst");
  await row.click();await settle(page,1);
  await page.getByRole("tab",{name:"Governance",exact:true}).click();
  await expect(page.getByText("Reports only. Does not open issues or pull requests, rerun CI, merge, deploy, or change credentials.",{exact:true})).toBeVisible();
});
