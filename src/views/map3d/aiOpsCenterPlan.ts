import {financialDimensions} from './financialArchitecture';
import {financialKey} from './financialPlan';
import type {Pt} from './roads';
import type {Scene3D} from './scene';

/**
 * Atlas AI Operations Center (Khaneil, 2026-11-24): a sculptural curved glass tower wrapped by a
 * sweeping bronze ribbon, rising out of a rounded three-level podium with a planted terrace that
 * steps back from the tower, a glass atrium drum over the glazed main entrance, and a forecourt on
 * the Financial District's north walk. It stands on the waterfront plot the Business Finance, Risk &
 * Insurance, Knowledge & Research and Client Success towers stood on; their functions are its floors.
 *
 * Plain numbers only, in coordinates local to the building (x across, z toward the street and the
 * map's camera, y up from the ground). The interior reads the same outlines (podiumRing, towerRing,
 * ribbonSpan), so inside and outside cannot drift apart.
 */
export const AIOPS_KEY='service:ai-operations-center';
export const AIOPS_ID='ai-operations-center';
export const AIOPS_NAME='Atlas AI Operations Center';
/** The interior's id (enterBuilding / Map.tsx). */
export const AIOPS_OFFICE_ID='ai-operations-center';

/** The four Financial District towers whose plot this is. Only their map models go: records, modules, agents and ids stay. */
export const CLEARED_FOR_AIOPS:readonly string[]=['business-finance','insurance','financial-planning','harbor-residence'].map(financialKey);
const CLEARED_IDS=new Set(['business-finance','insurance','financial-planning','harbor-residence']);

export const AIOPS={
 /** Podium half-size and its three storeys (lobby, operations, upper), bottom up. */
 podium:{a:4.7,b:3.35,n:3.2,floors:[.75,.5,.45] as readonly number[],slab:.09},
 /** Tower: an ellipse set back-left on the podium, gently bellied and tapering. */
 tower:{cx:-1.05,cz:-.65,rx:2.05,rz:1.5,floor:.3,ring:64},
 /** Roof cut: the crown slopes down toward the front-right by this much each side of the mean height. */
 crownSlope:.55,
 /** Planted step round the tower's foot, above the terrace. */
 step:{scale:1.32,rise:.24},
 /** Twist of the tower's plan from the ground to the crown, radians: the glass turns gently as it rises. */
 twist:.32,
 /** Glass atrium drum over the main entrance, rising through the podium above the terrace. */
 atrium:{x:.9,z:2.85,r:1.05,above:.38,ring:32},
 /** Bronze ribbon: louvre every half floor, standing proud of the glass. */
 ribbon:{gap:.15,depth:.11,thick:.026,back:1.028,samples:10,louvreEvery:2},
 /** Forecourt in front of the podium, up to the district's north walk. */
 forecourt:1.5,
 /** Glass colours shared by the map model and the interior (Khaneil's rule: inside matches outside). */
 palette:{glassTop:'#bcd9d4',glassBottom:'#6d9896',spandrel:'#46696a',mullion:'#e7e9e1',slab:'#efece4',bronze:'#d6a565',bronzeDark:'#b07f45',lobby:'#f2e3c2',lawn:'#6f9a52'},
} as const;

export const podiumTop=(level:number)=>AIOPS.podium.floors.slice(0,level+1).reduce((a,b)=>a+b,0);
export const PODIUM_H=podiumTop(AIOPS.podium.floors.length-1);

/**
 * The building's floors, ground up: what each one holds. Floors 1 to 4 bring in the four towers it
 * replaced, with their module (where one is set) shown in the building's panel.
 */
export const AIOPS_FLOORS=[
 {id:'lobby',label:'Lobby & atrium',from:null,where:'podium',summary:'Double-height glazed lobby under the atrium drum, reception and the lift core.',role:'Reception · Visitors'},
 {id:'business-finance',label:'Business Finance',from:financialKey('business-finance'),where:'podium',summary:'Read-only business cash flow, statements and P&L reviews, moved in from the Business Finance Center.',role:'Business Finance Planning Analyst'},
 {id:'insurance',label:'Risk & Insurance',from:financialKey('insurance'),where:'tower',summary:'Policy, coverage and renewal records, moved in from the Risk & Insurance Center.',role:'Insurance Records Analyst'},
 {id:'financial-planning',label:'Knowledge & Research',from:financialKey('financial-planning'),where:'tower',summary:'The Knowledge Repository and the Output Library of agent work reports, moved in from the Knowledge & Research Center.',role:'Financial Planning Research Analyst'},
 {id:'harbor-residence',label:'Client Success',from:financialKey('harbor-residence'),where:'tower',summary:'Client billing, renewals and follow-up planning, moved in from the Client Success Center.',role:'Client Success Coordinator'},
] as const;
export type AiOpsFloor=typeof AIOPS_FLOORS[number];

/** Height of the tower floor an interior level shows (tower floors sit above the podium, one storey apart). */
export function floorElevation(level:number){
 if(level<=0)return 0;
 if(level===1)return podiumTop(0);
 return PODIUM_H+AIOPS.step.rise+(level-2)*4*AIOPS.tower.floor;
}

export interface AiOpsPlan {
 /** Centre of the podium, world map units. */
 x:number;z:number;
 /** Mean roof height above the ground. */
 height:number;
 /** The landscaped plot no tree, shrub or other building may stand on (world). */
 site:{x:number;z:number;w:number;d:number};
}

/** Where it stands: centred on the four towers' plot, as tall as the tallest of them plus a storey or two. */
export function planAiOps(scene:Pick<Scene3D,'financial'>):AiOpsPlan|undefined{
 const fd=scene.financial;if(!fd)return undefined;
 const old=fd.buildings.filter(b=>CLEARED_IDS.has(b.id));if(old.length<CLEARED_IDS.size)return undefined;
 const box=old.map(b=>{const d=financialDimensions(b.id);return {x0:b.x-d.w/2,x1:b.x+d.w/2,z0:b.z-d.d/2,z1:b.z+d.d/2};});
 const x0=Math.min(...box.map(b=>b.x0)),x1=Math.max(...box.map(b=>b.x1)),z0=Math.min(...box.map(b=>b.z0)),z1=Math.max(...box.map(b=>b.z1));
 const x=fd.x+(x0+x1)/2,z=fd.z+(z0+z1)/2-.15;
 const height=Math.max(...old.map(b=>b.height))+.6;
 const back=AIOPS.podium.b+.9,front=AIOPS.podium.b+AIOPS.forecourt;
 return {x,z,height,site:{x,z:z+(front-back)/2,w:AIOPS.podium.a*2+1,d:back+front}};
}

/** Click and camera footprint: the podium with its forecourt, up to the crown. */
export function aiOpsFootprint(p:AiOpsPlan){
 return {x:p.x,z:p.z+AIOPS.forecourt/2,w:AIOPS.podium.a*2,d:AIOPS.podium.b*2+AIOPS.forecourt,y1:p.height+AIOPS.crownSlope};
}

/** The podium outline at storey `level`: a rounded bean, the upper storey pulled in toward the tower. */
export function podiumRing(level:number,n=64):Pt[]{
 const {a,b,n:e}=AIOPS.podium,k=level>=2?.94:1,sx=level>=2?-.22:0,sz=level>=2?-.16:0,pts:Pt[]=[];
 for(let i=0;i<n;i++){
  const th=-i/n*Math.PI*2,c=Math.cos(th),s=Math.sin(th);
  // A soft swell to the front-right, where the terrace sweeps round the tower.
  const r=1+.035*Math.cos(th-Math.PI/4)+.02*Math.sin(2*th);
  pts.push([(a*Math.sign(c)*Math.abs(c)**(2/e)*r)*k+sx,(b*Math.sign(s)*Math.abs(s)**(2/e)*r)*k+sz]);
 }
 return pts;
}

/** Plan scale of the tower at height y: a sculpted belly a third of the way up, tapering hard toward the crown. */
export function towerScale(y:number,height:number){const t=Math.max(0,Math.min(1,y/height));return 1+.075*Math.sin(Math.PI*t*1.1)-.17*t**1.6;}
/** How far the tower's plan has turned at height y (radians, counter-clockwise from above). */
export function towerTwist(y:number,height:number){const t=Math.max(0,Math.min(1,y/height));return AIOPS.twist*t*t*(3-2*t);}

/** Ellipse parameter phi (0 = +x, pi/2 = the front, toward the street) to a point on the tower at scale s. */
export function towerPoint(phi:number,y:number,height:number,s=1):Pt{
 const {cx,cz,rx,rz}=AIOPS.tower,k=towerScale(y,height)*s,x=rx*k*Math.cos(phi),z=rz*k*Math.sin(phi),w=-towerTwist(y,height),c=Math.cos(w),n=Math.sin(w);
 return [cx+x*c-z*n,cz+x*n+z*c];
}
/** Phi of ring point i, counter-clockwise seen from above (so edge x up faces out). */
export const towerPhi=(i:number,n:number=AIOPS.tower.ring)=>-i/n*Math.PI*2;
export function towerRing(y:number,height:number,s=1,n:number=AIOPS.tower.ring):Pt[]{return Array.from({length:n},(_,i)=>towerPoint(towerPhi(i,n),y,height,s));}
/** Outward unit normal of the ellipse at phi, turned with the tower's twist at height y. */
export function towerNormal(phi:number,y=0,height=1):Pt{const {rx,rz}=AIOPS.tower,x=Math.cos(phi)/rx,z=Math.sin(phi)/rz,l=Math.hypot(x,z),w=-towerTwist(y,height),c=Math.cos(w),n=Math.sin(w);return [(x*c-z*n)/l,(x*n+z*c)/l];}
/** Roof height over ring point phi: the crown is cut on a slope, lowest at the front-right. */
export function crownAt(phi:number,height:number){return height-AIOPS.crownSlope*Math.cos(phi-Math.PI/4);}

/**
 * The bronze ribbon at height y: the ellipse angles it spans. It starts on the terrace at the front-
 * right, sweeps across the front to the left at mid height and back to the right under the crown.
 * Returns undefined below the terrace.
 */
export function ribbonSpan(y:number,height:number):{from:number;to:number;mid:number}|undefined{
 const y0=PODIUM_H+AIOPS.step.rise;if(y<y0)return undefined;
 const t=(y-y0)/(height-y0);
 const mid=1.0-.55*Math.cos(Math.PI*1.6*t+.2),half=.3+.08*Math.sin(Math.PI*t);
 return {from:mid-half,to:mid+half,mid};
}

/** Tree spots on the terrace, clear of the tower and its planted step (local x, z). */
export function terraceTrees(height:number):Pt[]{
 const ring=podiumRing(2,40),out:Pt[]=[];
 for(let i=0;i<ring.length;i+=2){
  const [x,z]=ring[i],p:Pt=[x*.9+(-.22)*.1,z*.9+(-.16)*.1];
  const {cx,cz,rx,rz}=AIOPS.tower,s=AIOPS.step.scale*towerScale(PODIUM_H,height)+.12,w=towerTwist(PODIUM_H,height),dx=p[0]-cx,dz=p[1]-cz,u=dx*Math.cos(w)-dz*Math.sin(w),v=dx*Math.sin(w)+dz*Math.cos(w);
  if((u/(rx*s))**2+(v/(rz*s))**2<1)continue;
  if(Math.hypot(p[0]-AIOPS.atrium.x,p[1]-AIOPS.atrium.z)<AIOPS.atrium.r+.3)continue;
  out.push(p);
 }
 return out;
}

/**
 * The scene as drawn: the four towers left out and the AI Operations Center added. The planned scene is
 * not changed, so streets, the railway, traffic and every planner keep the same ground.
 */
export function presentAiOps<S extends Scene3D>(scene:S):S{
 const plan=planAiOps(scene);if(!plan)return scene;
 const {site}=plan,inside=(p:{x:number;z:number})=>Math.abs(p.x-site.x)<site.w/2+.2&&Math.abs(p.z-site.z)<site.d/2+.2;
 const fd=scene.financial!,financial={...fd,buildings:fd.buildings.filter(b=>!CLEARED_IDS.has(b.id)),perimeterTrees:fd.perimeterTrees.filter(([x,z])=>!inside({x:fd.x+x,z:fd.z+z}))};
 return {...scene,financial,aiOps:plan,trees:scene.trees.filter(t=>!inside(t)),bushes:scene.bushes.filter(b=>!inside(b))};
}

/** Where an agent seat on a floor sits, interior units before scaling (desks in rows round the core). */
export const AIOPS_IN={k:2.4,storey:3.2} as const;
