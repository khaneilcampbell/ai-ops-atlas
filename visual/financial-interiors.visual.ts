import {test} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Financial District interiors inside "Enter building". Preview shots only: runs when FINANCIAL_SHOTS=1. FINANCIAL_SHOT_DIR picks the folder. */
test.skip(!process.env.FINANCIAL_SHOTS,'Set FINANCIAL_SHOTS=1 to take Financial District interior screenshots.');
const dir=process.env.FINANCIAL_SHOT_DIR??'artifacts/financial-interiors';
const BUILDINGS=['Chase','Robinhood','Navy Federal Credit Union','Experian','The Ritz-Carlton','Wells Fargo','Vanguard','American Express','Benjaire Finance'];
const FLOORS:[string,RegExp][]=[['lobby',/^Lobby$/],['floor2',/^Floor 2$/],['all',/^All floors$/]];
const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-');
async function shoot(page:import('@playwright/test').Page,b:string,suffix:string,floors=FLOORS){
 await page.evaluate(async(b)=>{const m=await import('/src/views/office/store.ts' as string);m.enterBuilding(`skyline-business:${b}`,true);},b);
 await settle(page,4);
 for(const [name,label] of floors){await page.getByRole('button',{name:label}).click();for(let i=0;i<6;i++){await page.waitForTimeout(300);await settle(page,2);}await page.screenshot({path:`${dir}/${slug(b)}-${name}-${suffix}.png`});}
}
for(const b of BUILDINGS)test(`${b} inside, day`,async({page})=>{test.setTimeout(300_000);mkdirSync(dir,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);await shoot(page,b,'day');});
for(const b of ['Chase','The Ritz-Carlton'])test(`${b} inside, night`,async({page})=>{test.setTimeout(300_000);mkdirSync(dir,{recursive:true});await openAtlas(page,{light:'night'});await waitForScene(page);await settle(page,2);await shoot(page,b,'night',FLOORS.slice(0,2));});
test('Chase inside on a phone',async({page})=>{test.setTimeout(300_000);mkdirSync(dir,{recursive:true});await page.setViewportSize({width:390,height:844});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);await shoot(page,'Chase','phone',FLOORS.slice(0,2));});
