import {expect,test} from "@playwright/test";
import {goTo,openAtlas,settle} from "./atlas";

test("reports-only improvement analyst is discoverable",async({page})=>{
  await openAtlas(page);
  await goTo(page,"Agents");
  await page.getByRole("textbox",{name:"Search agents",exact:true}).fill("Atlas System Improvements");
  await settle(page,1);
  const row=page.locator('.reg-row[data-id="atlas-system-improvements"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText("Atlas System Improvements");
  await row.click();await settle(page,1);
  await expect(page.getByRole("button",{name:"Copy Codex review prompt",exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"Governance",exact:true}).click();
  await expect(page.getByText("Reports only. Does not open issues or pull requests, rerun CI, merge, deploy, or change credentials.",{exact:true})).toBeVisible();
});
