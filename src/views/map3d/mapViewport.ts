import type * as THREE from 'three';
/** A map frame always owns the full canvas, including after offscreen passes or a DPR change. */
export function prepareMapFrame(gl:THREE.WebGLRenderer,size:THREE.Vector2){
 gl.setRenderTarget(null);
 gl.getSize(size);
 gl.setViewport(0,0,size.x,size.y);
 gl.setScissorTest(false);
}
/** Permit a small framing margin, never a second overview's worth of empty ocean. */
export function mapZoomLimits(fitDistance:number){
 const fit=Number.isFinite(fitDistance)?Math.max(4,fitDistance):30;
 return {min:4,max:fit*1.05};
}
