import {test} from '@playwright/test';
import {answer} from './github';
test.use({deviceScaleFactor:2});
test('profile cold city startup',async({page})=>{
 test.skip(!process.env.STARTUP_PROFILE, 'Opt-in real-clock startup measurement');
 await page.addInitScript(()=>{
  const now=performance.now.bind(performance);
  const data={start:now(),firstDraw:0,firstDrawUploads:0,compileMs:0,linkMs:0,uploads:0,contextMs:0};(window as unknown as {__startup:typeof data}).__startup=data;
  const getContext=HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext=function(...args:Parameters<typeof getContext>){const t=now();const value=getContext.apply(this,args);data.contextMs+=now()-t;return value;} as typeof getContext;
  for(const C of [WebGLRenderingContext,WebGL2RenderingContext])for(const name of ['compileShader','linkProgram','bufferData','drawElements','drawArrays','drawElementsInstanced']){
   const p=C.prototype as unknown as Record<string,(...args:unknown[])=>unknown>,orig=p[name];if(!orig)continue;
   p[name]=function(...args){const t=now();const result=orig.apply(this,args);if(name==='compileShader')data.compileMs+=now()-t;if(name==='linkProgram')data.linkMs+=now()-t;if(name==='bufferData')data.uploads++;if(name.startsWith('draw')&&!data.firstDraw){data.firstDraw=now();data.firstDrawUploads=data.uploads;}return result;};
  }
 });
 await page.addInitScript(()=>{localStorage.setItem('atlas:mapLight',JSON.stringify('night'));localStorage.setItem('atlas:mapMode',JSON.stringify('3d'));});
 await page.route('https://api.github.com/**',async route=>{const u=new URL(route.request().url());await route.fulfill({contentType:'application/json',body:JSON.stringify(answer(u.pathname+u.search)??{})});});
 await page.goto('/');
 await page.waitForFunction(()=>(window as unknown as {__startup:{firstDraw:number}}).__startup.firstDraw>0);
 console.log('STARTUP',await page.evaluate(()=>(window as unknown as {__startup:unknown}).__startup));
});
