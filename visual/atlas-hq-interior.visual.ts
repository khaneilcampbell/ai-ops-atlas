import {mkdirSync} from "node:fs";
import {test} from "@playwright/test";
import {openAtlas,selectBuilding,settle,waitForOffice} from "./atlas";
/** Atlas HQ interior matched to the curving glass exterior (KC, 2026-10-31). Writes floor views, day and night. */
const out=process.env.SHOT_DIR??"artifacts/atlas-hq-interior";
for(const light of ["day","night"] as const)test(`Atlas HQ interior, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light});await selectBuilding(page,"Atlas HQ");
 await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,2);await waitForOffice(page);
 const nav=page.getByRole("navigation",{name:"Building floor navigation"});
 for(const [label,name] of [["All floors","all"],["Lobby","lobby"],["Floor 3 · Production","floor3"],["Floor 4 · Agents","agents"]] as const){
  await nav.getByRole("button",{name:label,exact:true}).click();await settle(page,2);await waitForOffice(page);
  await page.screenshot({path:`${out}/${name}-${light}.png`});
 }
});
test("Atlas HQ interior on a phone",async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:"day"});await selectBuilding(page,"Atlas HQ");
 await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,2);await waitForOffice(page);
 await page.screenshot({path:`${out}/phone-all.png`});
});
