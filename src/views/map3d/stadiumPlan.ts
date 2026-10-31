import type {Rect,Slab} from "./scene";
export const STADIUM_KEY="service:skyline-stadium";
export interface StadiumPlan extends Rect {accessX:number;accessZ:number}
export function planStadium(land:Rect[],paving:Slab[],profile?:Rect):StadiumPlan|undefined {
  if(!profile||!paving.length)return;
  const w=8,d=7,margin=2,gap=.35;
  // Evaluate nearby parcel edges instead of repeatedly shifting a whole district north.
  const preferred={x:profile.x-w-margin*2-gap-.001,z:profile.z+profile.d/2-(d+margin*2)/2};
  const xs=[preferred.x,...land.map(r=>r.x-w-margin*2-gap-.001)];
  const zs=[preferred.z,...land.flatMap(r=>[r.z-d-margin*2-gap,r.z+r.d+gap])];
  const candidates=xs.flatMap(x=>zs.map(z=>({x,z}))).filter(p=>p.x+w+margin*2<=profile.x-gap&&!land.some(r=>p.x<r.x+r.w+gap&&p.x+w+margin*2+gap>r.x&&p.z<r.z+r.d+gap&&p.z+d+margin*2+gap>r.z));
  candidates.sort((a,b)=>(a.x-preferred.x)**2+(a.z-preferred.z)**2-((b.x-preferred.x)**2+(b.z-preferred.z)**2));
  const parcel=candidates[0];if(!parcel)return;
  const x=parcel.x+margin,z=parcel.z+margin;
  const access=paving.filter(p=>p.x>=profile.x&&p.x<=profile.x+profile.w&&p.z>=profile.z&&p.z<=profile.z+profile.d).sort((a,b)=>a.x-b.x)[0];
  if(!access)return;
  return {x,z,w,d,accessX:access.x+.05,accessZ:access.z+access.d/2};
}
