import {expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene,FOUNTAIN_R} from "./scene";
it("keeps fountain basins and pedestrian lanes apart in every grouping",()=>{
  for(const group of ["none","district","status","tag"] as const){
    const scene=buildScene(layoutMap(catalog,[],group));
    for(const f of scene.fountains)for(const walk of scene.walks){
      const route=walk.route??[{gx:walk.x0,gy:walk.z0},{gx:walk.x1,gy:walk.z1}];
      for(let i=1;i<route.length;i++){
        const a=route[i-1],b=route[i],dx=b.gx-a.gx,dz=b.gy-a.gy;
        const t=Math.max(0,Math.min(1,((f.x-a.gx)*dx+(f.z-a.gy)*dz)/(dx*dx+dz*dz||1)));
        expect(Math.hypot(f.x-a.gx-t*dx,f.z-a.gy-t*dz),`${group} fountain at ${f.x},${f.z}`).toBeGreaterThanOrEqual(FOUNTAIN_R*(f.k??1)+0.16);
      }
    }
  }
});
