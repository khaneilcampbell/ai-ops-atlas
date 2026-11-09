import {expect,test} from '@playwright/test';
import {openAtlas} from './atlas';
for(const phone of [false,true])test(`Orbit brand ${phone?'phone':'desktop'}`,async({page})=>{
 await page.setViewportSize(phone?{width:390,height:844}:{width:1512,height:900});
 await openAtlas(page);
 await expect(page.locator('.header .brand-mark')).toBeVisible();
 if(process.env.ORBIT_AFTER)await expect(page.locator('.header .brand-mark img')).toHaveAttribute('src','/atlas-orbit.svg');
 await page.screenshot({path:`visual/out/orbit-${process.env.ORBIT_AFTER?'after':'before'}-${phone?'phone':'desktop'}.png`,clip:{x:0,y:0,width:phone?390:1512,height:120}});
});
