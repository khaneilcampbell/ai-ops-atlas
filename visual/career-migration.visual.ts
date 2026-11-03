import {expect,test} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {openAtlas,selectBuilding,settle,waitForOffice} from "./atlas";

test("Career Applications keeps its panel and interior with Atlas as its repository",async({page})=>{
  await openAtlas(page,{storage:{mapTraffic:false}});
  await selectBuilding(page,"Career Applications");
  await expect(page.getByRole("button",{name:"Inspect repository khaneilcampbell/ai-ops-atlas",exact:true})).toBeVisible();
  await expect(page.locator(".map-bar h3")).toHaveText("Career Applications");
  mkdirSync("artifacts/career-migration",{recursive:true});
  await page.screenshot({path:"artifacts/career-migration/project.png"});
  await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,4);await waitForOffice(page);
  await expect(page.locator(".office-layer")).toBeVisible();
  await page.screenshot({path:"artifacts/career-migration/interior.png"});
  const floors=page.getByRole("navigation",{name:"Building floor navigation"});
  for(const name of ["Floor 2","Lobby","All floors"]){
    await floors.getByRole("button",{name,exact:true}).click();await settle(page,2);
    await expect(floors.getByRole("button",{name,exact:true})).toHaveAttribute("aria-pressed","true");
  }
  await page.getByRole("button",{name:"Exit building",exact:true}).click();await settle(page,3);
  await expect(page.locator(".office-layer")).toHaveCount(0);
});
