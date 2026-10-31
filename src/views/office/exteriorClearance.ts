import type {Scene3D} from "../map3d/scene";
/** Exterior pedestrians and landscaping must never occupy the cutaway's room footprint. */
export function clearInteriorFootprint(scene:Scene3D,x:number,z:number,r:number):Scene3D {
  const outside=(p:{x:number;z:number},margin=0)=>Math.abs(p.x-x)>r+margin||Math.abs(p.z-z)>r+margin;
  return {...scene,
    pedestrianExclusion:{x:x-r,z:z-r,w:r*2,d:r*2},
    rocks:scene.rocks.filter(p=>outside(p,0.4)),
    bollards:scene.bollards.filter(p=>outside(p,0.3)),
    trees:scene.trees.filter(p=>outside(p,0.5)),bushes:scene.bushes.filter(p=>outside(p,0.3)),
    fountains:scene.fountains.filter(p=>outside(p,Math.max(0.6,(p.k??1)*0.475+0.3))),ponds:scene.ponds.filter(p=>outside(p,p.r)),
    walks:scene.walks.filter(w=>{
      const route=w.route??[{gx:w.x0,gy:w.z0},{gx:w.x1,gy:w.z1}];
      return route.slice(1).every((b,i)=>{const a=route[i];return Math.max(a.gx,b.gx)<x-r||Math.min(a.gx,b.gx)>x+r||Math.max(a.gy,b.gy)<z-r||Math.min(a.gy,b.gy)>z+r;});
    }),
  };
}
