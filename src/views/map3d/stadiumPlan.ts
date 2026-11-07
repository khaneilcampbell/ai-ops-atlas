import type {Rect,Slab} from "./scene";
/**
 * Size of Atlas Stadium's box, in map units: the 8 x 7 design grown by STADIUM_SCALE (KC, 2026-11-07:
 * "expand district size to make the change more realistic"). About 1.3 times the Marketplace footprint.
 */
export const STADIUM_SCALE=1.4;
export const STADIUM_BOX={w:8*STADIUM_SCALE,d:7*STADIUM_SCALE} as const;
export const STADIUM_KEY="service:skyline-stadium";
/** Display name on the nameplate and panel; the key and id stay as they were. */
export const STADIUM_NAME="Atlas Stadium";
/** Grass kept between the stadium grounds and the island edge. */
export const SITE_EDGE=1.2;
/** Furthest the stadium's lot may slide west of GitHub Profile to centre it in open land. */
const SLIDE_MAX=10;
export interface StadiumPlan extends Rect {accessX:number;accessZ:number}
export function planStadium(land:Rect[],paving:Slab[],profile?:Rect,centre=true):StadiumPlan|undefined {
  if(!profile||!paving.length)return;
  const w=STADIUM_BOX.w,d=STADIUM_BOX.d,margin=2,gap=.35;
  // Evaluate nearby parcel edges instead of repeatedly shifting a whole district north.
  const preferred={x:profile.x-w-margin*2-gap-.001,z:profile.z+profile.d/2-(d+margin*2)/2};
  const xs=[...new Set([preferred.x,...land.map(r=>r.x-w-margin*2-gap-.001)])];
  const zs=[...new Set([preferred.z,...land.flatMap(r=>[r.z-d-margin*2-gap,r.z+r.d+gap])])];
  const candidates=xs.flatMap(x=>zs.map(z=>({x,z}))).filter(p=>p.x+w+margin*2<=profile.x-gap);
  candidates.sort((a,b)=>(a.x-preferred.x)**2+(a.z-preferred.z)**2-((b.x-preferred.x)**2+(b.z-preferred.z)**2));
  const parcel=candidates.find(p=>!land.some(r=>p.x<r.x+r.w+gap&&p.x+w+margin*2+gap>r.x&&p.z<r.z+r.d+gap&&p.z+d+margin*2+gap>r.z));if(!parcel)return;
  // Centre the stadium in the open land on its west side (KC, 2026-11-07: "center the stadium in the
  // entire space"): slide west while the lot stays free and on the island, then sit halfway.
  const lot=(px:number)=>({x:px,z:parcel.z,w:w+margin*2,d:d+margin*2});
  const free=(r:Rect)=>!land.some(o=>r.x<o.x+o.w+gap&&r.x+r.w+gap>o.x&&r.z<o.z+o.d+gap&&r.z+r.d+gap>o.z);
  const west=Math.min(...land.map(r=>r.x))+SITE_EDGE;
  let far=parcel.x;
  if(centre)
  // At most SLIDE_MAX west, so its roads and walks still reach GitHub Profile's plaza.
  for(let px=parcel.x-.5;px>=Math.max(west,parcel.x-SLIDE_MAX)&&free(lot(px));px-=.5)far=px;
  const x=(parcel.x+far)/2+margin,z=parcel.z+margin;
  const access=paving.filter(p=>p.x>=profile.x&&p.x<=profile.x+profile.w&&p.z>=profile.z&&p.z<=profile.z+profile.d).sort((a,b)=>a.x-b.x)[0];
  if(!access)return;
  return {x,z,w,d,accessX:access.x+.05,accessZ:access.z+access.d/2};
}
/** Office id the Enter building button and the interior route share. */
export const STADIUM_OFFICE_ID=`skyline-business:${STADIUM_NAME}`;
