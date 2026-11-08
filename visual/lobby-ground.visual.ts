import {test} from '@playwright/test';import {mkdirSync} from 'node:fs';import {openAtlas,settle,waitForScene} from './atlas';
/** Financial District lobbies on the ground, inside "Enter building". Preview shots only: runs when SHOT_DIR is set. */
test.skip(!process.env.SHOT_DIR,'Set SHOT_DIR to take Financial District lobby screenshots.');
const dir=process.env.SHOT_DIR??'artifacts/lobby-ground';
const BUILDINGS:[string,string][]=[['ellipse','skyline-business:Ellipse Residences'],['bayvale','skyline-business:financial:banks'],['camton','skyline-business:financial:harbor-residence'],['amex','skyline-business:financial:budget']];
async function shoot(page:import('@playwright/test').Page,name:string,key:string,suffix:string,floors:[string,RegExp][]){
 await page.evaluate(async(k)=>{const m=await import('/src/views/office/store.ts' as string);m.enterBuilding(k,true);},key);
 await settle(page,4);
 for(const [f,label] of floors){await page.getByRole('button',{name:label}).click();for(let i=0;i<6;i++){await page.waitForTimeout(300);await settle(page,2);}await page.screenshot({path:`${dir}/${name}-${f}-${suffix}.png`});}
}
const FLOORS:[string,RegExp][]=[['all',/^All floors$/],['lobby',/^Lobby$/]];
for(const [name,key] of BUILDINGS)test(`${name} lobby on the ground`,async({page})=>{mkdirSync(dir,{recursive:true});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);await shoot(page,name,key,'day',FLOORS);});
test('Ellipse Residences on a phone',async({page})=>{mkdirSync(dir,{recursive:true});await page.setViewportSize({width:390,height:844});await openAtlas(page,{light:'day'});await waitForScene(page);await settle(page,2);await shoot(page,'ellipse','skyline-business:Ellipse Residences','phone',FLOORS.slice(0,1));});
