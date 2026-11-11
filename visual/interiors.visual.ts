import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {expect,test} from "@playwright/test";
import {openAtlas,selectBuilding,settle,waitForOffice} from "./atlas";

test.use({deviceScaleFactor:1});
const out=join(import.meta.dirname,"out");
async function shot(page:import("@playwright/test").Page,name:string){mkdirSync(out,{recursive:true});await page.screenshot({path:join(out,name+".png")});}

async function waitForFloorMarkers(page:import("@playwright/test").Page,count:number){
  // The test clock is paused; keep drawing frames while the lazy WebGL/Html roots initialize.
  for(let i=0;i<20&&(await page.locator("[data-floor-label]").count())!==count;i++){
    await page.waitForTimeout(150);await settle(page,2);
  }
  await expect(page.locator("[data-floor-label]")).toHaveCount(count);
}

test("project interiors: all floors, top-floor agents, lobby and exit",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();
  await settle(page,2);await waitForOffice(page);
  const nav=page.getByRole("navigation",{name:"Building floor navigation"});
  await expect(nav.getByRole("button",{name:"All floors",exact:true})).toHaveAttribute("aria-pressed","true");
  await waitForFloorMarkers(page,5);
  for(const n of [0,1,2,3,4])await expect(page.locator(`[data-floor-label="${n}"]`)).toHaveText(n===0?"Lobby":`Floor ${n}`);
  await shot(page,"interior-project-all");
  await nav.getByRole("button",{name:"Lobby",exact:true}).click();await settle(page,2);await waitForOffice(page);
  await expect(page.locator(".office-roster")).toHaveCount(0);
  await shot(page,"interior-project-lobby");
  await nav.getByRole("button",{name:"Floor 4 · Agents",exact:true}).click();await settle(page,2);await waitForOffice(page);
  await expect(page.locator(".office-roster")).toBeVisible();
  await shot(page,"interior-project-agents");
  await page.getByRole("button",{name:"Exit building",exact:true}).click();await settle(page,4);
  await expect(page.locator(".office-layer")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// The shared business interior (airport offices and other planned workspaces). It was shown on
// Skyline until that district was removed (KC, 2026-11-08).
const BUSINESS="Atlas · Operations";
/** The name the interior shows for it (catalog/workspace/buildings.yaml). */
const BUSINESS_NAME="Observability Center";
async function enterBusiness(page:import("@playwright/test").Page){
  await page.evaluate(async(b)=>{const m=await import("/src/views/office/store.ts" as string);m.enterBuilding(`skyline-business:${b}`,true);},BUSINESS);
}

test("business night interior: shared navigation and exterior clearance",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page,{light:"night"});
  await enterBusiness(page);await settle(page,4);
  await expect(page.locator(".skyline-interior.night")).toBeVisible();
  const nav=page.getByRole("navigation",{name:`Choose ${BUSINESS_NAME} floor`});
  await expect(nav.getByRole("button",{name:"All floors",exact:true})).toHaveAttribute("aria-pressed","true");
  await waitForFloorMarkers(page,5);
  await shot(page,"interior-business-night-all");
  await nav.getByRole("button",{name:"Lobby",exact:true}).click();await settle(page,3);
  await shot(page,"interior-business-night-lobby");
  await nav.getByRole("button",{name:"Floor 2",exact:true}).click();await settle(page,3);
  for(let i=0;i<12&&!(await page.getByRole("button",{name:/Suite 201/}).count());i++){await page.waitForTimeout(150);await settle(page,2);}
  await shot(page,"interior-business-night-floor2");
  await expect(page.getByRole("button",{name:/Suite 201/})).toBeVisible();
  await page.getByRole("button",{name:`Exit ${BUSINESS_NAME} and return to city`}).click();await settle(page,2);
  await expect(page.locator(".skyline-interior")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("phone: floor navigation and exit stay accessible",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,4);await waitForOffice(page);
  const nav=page.getByRole("navigation",{name:"Building floor navigation"});
  await expect(page.getByRole("button",{name:"Enter building",exact:true})).toHaveCount(0);
  await expect(nav.getByRole("button",{name:"Floor 4 · Agents",exact:true})).toBeInViewport();
  await nav.getByRole("button",{name:"Floor 4 · Agents",exact:true}).click();await settle(page,2);
  await expect(nav.getByRole("button",{name:"Floor 4 · Agents",exact:true})).toHaveAttribute("aria-pressed","true");
  await nav.getByRole("button",{name:"Lobby",exact:true}).click();await settle(page,3);await waitForOffice(page);
  await shot(page,"interior-phone-lobby");
  await expect(page.getByRole("button",{name:"Exit building",exact:true})).toBeInViewport();
  await page.getByRole("button",{name:"Exit building",exact:true}).click();await settle(page,4);
  await expect(page.locator(".office-layer")).toHaveCount(0);
});

test("deep commerce building: full night cutaway stays framed and lit",async({page})=>{
  await openAtlas(page,{light:"night"});
  await selectBuilding(page,"Commerce Operations Center");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,3);await waitForOffice(page);
  await expect(page.getByRole("navigation",{name:"Building floor navigation"}).getByRole("button",{name:"All floors",exact:true})).toHaveAttribute("aria-pressed","true");
  await shot(page,"interior-commerce-night-all");
});


test("floor switching preserves the renderer in project and business buildings",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page);
  await selectBuilding(page, "Atlas Command Center");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();
  await settle(page,2);await waitForOffice(page);
  for(const kind of ["office","business"] as const){
    const region=page.locator(kind==="office"?".office-layer":".skyline-interior");
    const canvas=await region.locator("canvas").elementHandle();
    expect(canvas).not.toBeNull();
    const nav=region.getByRole("navigation");
    for(const name of ["Lobby",kind==="office"?"Floor 4 · Agents":"Floor 4","All floors","Floor 2","All floors"]){
      await nav.getByRole("button",{name,exact:true}).click();await settle(page,1);
      await expect(nav.getByRole("button",{name,exact:true})).toHaveAttribute("aria-pressed","true");
      const current=await region.locator("canvas").elementHandle();
      expect(await canvas!.evaluate((original,current)=>original===current,current)).toBe(true);
      expect(await canvas!.evaluate(node=>(node as HTMLCanvasElement).getContext("webgl2")?.isContextLost())).toBe(false);
    }
    await region.getByRole("button",{name:kind==="office"?"Exit building":`Exit ${BUSINESS_NAME} and return to city`,exact:true}).click();await settle(page,3);
    await expect(region).toHaveCount(0);
    if(kind==="office"){await enterBusiness(page);await settle(page,2);}
  }
  expect(errors).toEqual([]);
});


test("tool buildings show their purpose and workers before explicit entry",async({page})=>{
  await openAtlas(page,{storage:{mapProjectGrouping:"none"}});
  await selectBuilding(page,"Commerce Operations Center");
  const tool=page.locator(".m3-pill",{hasText:"Design Studio"}).first();
  await tool.dispatchEvent("click");await settle(page,2);
  const inspector=page.getByRole("complementary",{name:"Inspector"});
  await expect(inspector.getByRole("heading",{name:"Design Studio",exact:true})).toBeVisible();
  await expect(inspector).toContainText("Purpose");
  await expect(page.getByRole("region",{name:"Design Studio interior"})).toHaveCount(0);
  await inspector.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,3);
  await expect(page.getByRole("region",{name:"Design Studio interior"})).toBeVisible();
  await page.getByRole("button",{name:"Exit Design Studio and return to city"}).click();await settle(page,2);
  await expect(inspector.getByRole("heading",{name:"Design Studio",exact:true})).toBeVisible();
});
