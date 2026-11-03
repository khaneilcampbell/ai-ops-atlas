import {expect,test} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {openAtlas,selectBuilding,settle} from "./atlas";

test("Financial District includes Circa and BMW with their existing selection panels",async({page})=>{
  await openAtlas(page,{storage:{mapTraffic:false}});
  await selectBuilding(page,"Financial District");
  await expect(page.getByRole("button",{name:"Circa →",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"BMW →",exact:true}).click();await settle(page,2);
  await expect(page.getByText("Financial District · Automotive showroom",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Financial District →",exact:true}).click();await settle(page,2);
  await page.getByRole("button",{name:"Circa →",exact:true}).click();await settle(page,2);
  await expect(page.getByRole("button",{name:"Enter building",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Financial District →",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Financial District →",exact:true}).click();await settle(page,2);
  mkdirSync("artifacts/financial-membership",{recursive:true});
  await page.screenshot({path:"artifacts/financial-membership/district.png"});
});
