import {mkdirSync} from "node:fs";
import {test} from "@playwright/test";
import {openAtlas,selectBuilding,settle,waitForOffice} from "./atlas";
/** Atlas Command Center interior, matched to the corporate HQ exterior (Khaneil, 2026-11-17). Writes floor views, day and night. */
const out=process.env.SHOT_DIR??"artifacts/atlas-hq-interior";
for(const light of ["day","night"] as const)test(`Atlas HQ interior, ${light}`,async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});
 await openAtlas(page,{light});await selectBuilding(page,"Atlas Command Center");
 await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,2);await waitForOffice(page);
 const nav=page.getByRole("navigation",{name:"Building floor navigation"});
 for(const [label,name] of [["All floors","all"],["Lobby","lobby"],["Floor 3","floor3"],["Floor 4","agents"]] as const){
  await nav.getByRole("button",{name:label,exact:true}).click();await settle(page,2);await waitForOffice(page);
  await page.screenshot({path:`${out}/${name}-${light}.png`});
 }
});
test("Atlas HQ interior on a phone",async({page})=>{
 test.setTimeout(600_000);mkdirSync(out,{recursive:true});await page.setViewportSize({width:390,height:844});
 await openAtlas(page,{light:"day"});await selectBuilding(page,"Atlas Command Center");
 await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,2);await waitForOffice(page);
 await page.screenshot({path:`${out}/phone-all.png`});
 await page.getByRole("navigation",{name:"Building floor navigation"}).getByRole("button",{name:"Floor 4",exact:true}).click();await settle(page,2);await waitForOffice(page);
 await page.screenshot({path:`${out}/phone-agents.png`});
});
