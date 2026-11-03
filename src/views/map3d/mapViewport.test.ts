import {expect,it,vi} from 'vitest';
import * as THREE from 'three';
import {mapZoomLimits,prepareMapFrame,renderMapFrame} from './mapViewport';
it('resets offscreen/scissor state and covers the complete logical canvas at any DPR',()=>{
 const gl={setRenderTarget:vi.fn(),getSize:(v:THREE.Vector2)=>v.set(1200,800),setViewport:vi.fn(),setScissorTest:vi.fn()} as unknown as THREE.WebGLRenderer;
 prepareMapFrame(gl,new THREE.Vector2());
 expect(gl.setRenderTarget).toHaveBeenCalledWith(null);
 expect(gl.setViewport).toHaveBeenCalledWith(0,0,1200,800);
 expect(gl.setScissorTest).toHaveBeenCalledWith(false);
});
it('bounds zoom-out near the fitted city and recalculates for viewport size',()=>{
 expect(mapZoomLimits(100)).toEqual({min:4,max:105});
 expect(mapZoomLimits(200).max).toBe(210);
 expect(mapZoomLimits(NaN).max).toBe(31.5);
 expect(mapZoomLimits(0).max).toBeGreaterThanOrEqual(4);
});

it('renders straight to the complete canvas on repeated frames without offscreen targets',()=>{
 const gl={setRenderTarget:vi.fn(),getSize:(v:THREE.Vector2)=>v.set(800,500),setViewport:vi.fn(),setScissorTest:vi.fn(),render:vi.fn()} as unknown as THREE.WebGLRenderer;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),size=new THREE.Vector2();
 for(let i=0;i<3;i++)renderMapFrame(gl,scene,camera,size);
 expect(gl.render).toHaveBeenCalledTimes(3);
 expect(gl.render).toHaveBeenLastCalledWith(scene,camera);
 expect(vi.mocked(gl.setRenderTarget).mock.calls).toEqual([[null],[null],[null]]);
 expect(vi.mocked(gl.setViewport).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(gl.render).mock.invocationCallOrder[0]);
});
