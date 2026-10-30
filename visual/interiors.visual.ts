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
  await selectBuilding(page,"ai-ops-atlas");
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

test("Skyline night interior: shared navigation and exterior clearance",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page,{light:"night"});
  await selectBuilding(page,"Skyline");await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,4);
  await expect(page.locator(".skyline-interior.night")).toBeVisible();
  const nav=page.getByRole("navigation",{name:"Choose Skyline floor"});
  await expect(nav.getByRole("button",{name:"All floors",exact:true})).toHaveAttribute("aria-pressed","true");
  await waitForFloorMarkers(page,5);
  await shot(page,"interior-skyline-night-all");
  await nav.getByRole("button",{name:"Lobby",exact:true}).click();await settle(page,3);
  await shot(page,"interior-skyline-night-lobby");
  await nav.getByRole("button",{name:"Floor 2",exact:true}).click();await settle(page,3);
  for(let i=0;i<12&&!(await page.getByRole("button",{name:/Apartment 201/}).count());i++){await page.waitForTimeout(150);await settle(page,2);}
  await shot(page,"interior-skyline-night-floor2");
  expect(errors).toEqual([]);
  await expect(page.getByRole("button",{name:/Apartment 201/})).toBeVisible();
  await page.getByRole("button",{name:"Exit Skyline and return to city"}).click();await settle(page,2);
  await expect(page.locator(".skyline-interior")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("branded business interior opens with its own workspace navigation",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page,{storage:{mapProjectGrouping:"none"}});
  for(let i=0;i<6;i++){await page.getByRole("button",{name:"Zoom in",exact:true}).click();await settle(page,1);}
  await page.locator(".m3-plaque.secondary",{hasText:"Anthropic"}).dispatchEvent("click");await settle(page,4);
  await expect(page.getByRole("region",{name:"Anthropic interior"})).toBeVisible();
  const nav=page.getByRole("navigation",{name:"Choose Anthropic floor"});
  await nav.getByRole("button",{name:"Lobby",exact:true}).click();await settle(page,3);
  await shot(page,"interior-anthropic-lobby");
  await page.getByRole("button",{name:"Exit Anthropic and return to city"}).click();await settle(page,2);
  await expect(page.locator(".skyline-interior")).toHaveCount(0);expect(errors).toEqual([]);
});

test("phone: floor navigation and exit stay accessible",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await openAtlas(page);
  await selectBuilding(page,"ai-ops-atlas");
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
  await selectBuilding(page,"multi-agent-commerce-pipeline");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,3);await waitForOffice(page);
  await expect(page.getByRole("navigation",{name:"Building floor navigation"}).getByRole("button",{name:"All floors",exact:true})).toHaveAttribute("aria-pressed","true");
  await shot(page,"interior-commerce-night-all");
});


test("floor switching preserves the renderer in project and Skyline buildings",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await openAtlas(page);
  await selectBuilding(page,"ai-ops-atlas");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();
  await settle(page,2);await waitForOffice(page);
  for(const kind of ["office","skyline"] as const){
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
    await region.getByRole("button",{name:kind==="office"?"Exit building":"Exit Skyline and return to city",exact:true}).click();await settle(page,3);
    await expect(region).toHaveCount(0);
    if(kind==="office"){await selectBuilding(page,"Skyline");await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,2);}
  }
  expect(errors).toEqual([]);
});


test("Skyline project panel links its repository before entering the district",async({page})=>{
  await openAtlas(page);
  await selectBuilding(page,"Skyline");
  await expect(page.getByRole("region",{name:"Linked repositories"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Inspect repository khaneilcampbell/skyline",exact:true})).toBeVisible();
  await expect(page.locator(".map-bar h3")).toHaveText("skyline");
  await expect(page.locator(".map-bar")).toContainText("No agents registered for this project");
  await shot(page,"skyline-project-repository");
  await page.getByRole("button",{name:"Enter building",exact:true}).click();await settle(page,3);
  await expect(page.getByRole("region",{name:"Skyline interior"})).toBeVisible();
});
