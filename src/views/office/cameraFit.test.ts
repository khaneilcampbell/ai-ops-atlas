import {expect,it} from "vitest";
import {cutawayCameraRadius} from "./cameraFit";
it("fits short and deep buildings on desktop and phone without clipping a floor",()=>{
  for(const [w,d] of [[10,8],[12,24],[18,35]])for(const aspect of [0.5,1.5,2]){
    const r=cutawayCameraRadius(w,d,aspect),phi=1.05,theta=Math.PI/4,tan=Math.tan(32*Math.PI/360);
    for(const x of [-w/2-0.7,w*0.65])for(const y of [-0.25,16.5])for(const z of [-d/2-0.2,d/2+2.5]){
      const py=y-8.1,pz=z-0.9,depth=x*Math.sin(phi)*Math.sin(theta)+py*Math.cos(phi)+pz*Math.sin(phi)*Math.cos(theta);
      expect(Math.abs(x*Math.cos(theta)-pz*Math.sin(theta))/(r-depth)).toBeLessThan(tan*aspect);
      expect(Math.abs(-x*Math.cos(phi)*Math.sin(theta)+py*Math.sin(phi)-pz*Math.cos(phi)*Math.cos(theta))/(r-depth)).toBeLessThan(tan);
    }
  }
});
