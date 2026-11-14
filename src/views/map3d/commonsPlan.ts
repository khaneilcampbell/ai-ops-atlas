import type {Point,Rect,Scene3D,Tree} from './scene';
import type {Pt} from './roads';
export const COMMONS_KEY='service:atlas-commons';
export const COMMONS_NAME='Atlas Commons';
export const COMMONS={pathWidth:.48,bridgeWidth:.55,edgeClearance:.6,pavilionRadius:1.05} as const;
export interface CommonsPlan {rect:Rect;pond:Pt[];loop:Pt[];paths:Pt[][];bridges:[Pt,Pt][];pavilion:Pt;amphitheater:Pt;trees:Pt[];benches:Pt[];benchRotations:number[];lights:Pt[];access:{service:Pt;marketplace:Pt}}
/** One bounded park in the existing meadow; no headquarters or transport coordinates move. */
export function planCommons(s:Pick<Scene3D,'mall'|'towers'|'paving'|'transportConnections'>&{parks?:Pick<Scene3D,'parks'>['parks']}):CommonsPlan|undefined{
 // The park takes its west anchor from the middle of the vacant lot west of it, where a removed
 // tower stood (2026-11-09).
 const lot=s.parks?.find(p=>p.id==='park:vacant:vacant-lot-west');
 const mall=s.mall,desk=lot&&{x:lot.x+lot.w/2,z:lot.z+lot.d/2,size:0},profile=s.towers.find(t=>t.projectId==='github-profile');
 if(!mall||!desk||!profile)return;
 let x=Math.max(desk.x+desk.size/2+5,profile.x-3.55),z=Math.max(profile.z+profile.size/2+3.4,mall.z+.8),w=mall.x-.7-x,d=mall.plaza.z-.55-z;

 if(w<12){w=15;x=mall.x-.7-w;z=mall.z+.8;d=mall.plaza.z-.55-z;}
 if(d<6.8||s.towers.some(b=>b.x+b.size/2>x&&b.x-b.size/2<x+w&&b.z+b.size/2>z&&b.z-b.size/2<z+d)||(lot&&lot.x+lot.w>x&&lot.x<x+w&&lot.z+lot.d>z&&lot.z<z+d))return;
 const rect={x,z,w,d},cx=x+w*.63,cz=z+d*.5,rx=w*.275,rz=d*.245;
 const outline=(grow:number)=>Array.from({length:49},(_,i):Pt=>{const a=i%48/48*Math.PI*2;return [cx+(rx+grow)*Math.cos(a),cz+(rz*(.65+.35*Math.abs(Math.cos(a)))+grow)*Math.sin(a)];});
 const pond=outline(0),loop=outline(.65);
 const bridges:[Pt,Pt][]=[10,14].map(i=>[loop[i],loop[48-i]]);
 const pavilion:Pt=[x+2.1,z+2.1],amphitheater:Pt=[x+3.1,z+d*.67];
 // Join the existing approach from the vacant lot, and the Marketplace's already paved promenade.
 const service:Pt=s.transportConnections.find(c=>c.id==='skyline-airport')?.walk[0]??[desk.x,desk.z+desk.size/2+1.2],marketplace:Pt=[mall.plaza.x+.1,mall.plaza.z+.425],join:Pt=[x+3.6,cz];
 const paths:Pt[][]=[loop,[loop[24],join,[join[0],service[1]],service],[loop[12],[loop[12][0],z+d-.1],[marketplace[0],z+d-.1],marketplace],[[pavilion[0],pavilion[1]+1.15],[join[0],pavilion[1]+1.15],join],[[amphitheater[0],amphitheater[1]+1.15],[join[0],amphitheater[1]+1.15],[join[0],service[1]]]];
 const trees:Pt[]=[[x+.65,z+.75],[x+w*.31,z+.65],[x+w*.53,z+.65],[x+w*.78,z+.65],[x+w-.65,z+.75],[x+w-.65,z+d-.65],[x+w*.35,z+d-.7]];
 // Seats sit outside the loop, with their backs outward and a clear walking lane.
 const benchIndices=[4,20,44],benchRotations:number[]=[];
 const benches:Pt[]=benchIndices.map(i=>{const q=loop[i],dx=q[0]-cx,dz=q[1]-cz,len=Math.hypot(dx,dz);benchRotations.push(Math.atan2(dx,dz));return [q[0]+dx/len*.6,q[1]+dz/len*.6];});
 const lights:Pt[]=[...trees.filter((_,i)=>i%2===0).map(([x,z]):Pt=>[x+.3,z+.15]),[join[0]-.35,service[1]]];
 return {rect,pond,loop,paths,bridges,pavilion,amphitheater,trees,benches,benchRotations,lights,access:{service,marketplace}};
}

/** How far outside the walking loop the pond palms stand, on the lawn. */
export const COMMONS_PLANTING={loopPalms:[6,18,30,42],loopOffset:.75,palm:.26,olive:.34,shrub:.13} as const;

/**
 * Atlas Commons in the city's planting (Khaneil, 2026-11-13: "same landscape as the rest of Atlas … not excessive").
 * The edge trees alternate lit avenue palms and olives, four lit palms frame the pond outside the loop (either side
 * of the two footbridges), and the shore is the city's LA shrubs. Landscape draws them with every other tree.
 */
export function commonsPlanting(p:CommonsPlan,y:number){
 // Edge trees are olives; the four lit palms by the loop are the Commons' only palms (Khaneil, 2026-11-13: fewer palms).
 const trees:Tree[]=p.trees.map(([x,z])=>({x,y,z,s:COMMONS_PLANTING.olive,kind:'round',la:'olive'}));
 const cx=p.pond.reduce((a,q)=>a+q[0],0)/p.pond.length,cz=p.pond.reduce((a,q)=>a+q[1],0)/p.pond.length;
 for(const i of COMMONS_PLANTING.loopPalms){const [x,z]=p.loop[i],dx=x-cx,dz=z-cz,len=Math.hypot(dx,dz);trees.push({x:x+dx/len*COMMONS_PLANTING.loopOffset,y,z:z+dz/len*COMMONS_PLANTING.loopOffset,s:COMMONS_PLANTING.palm,kind:'avenue'});}
 const bushes:Point[]=[];
 // The south lawn reads like the city's lawns: two olives, each with a pair of shrubs, clear of the paths.
 const {x:rx,z:rz,w:rw,d:rd}=p.rect;
 for(const f of [.42,.86]){const x=rx+rw*f,z=rz+rd-.9;trees.push({x,y,z,s:COMMONS_PLANTING.olive,kind:'round',la:'olive'});bushes.push({x:x-.45,y,z:z+.1,s:COMMONS_PLANTING.shrub},{x:x+.45,y,z:z-.05,s:COMMONS_PLANTING.shrub});}
 // Low planted shoreline below the promenade, leaving every bridge mouth open.
 for(let i=0;i<48;i+=2){const [x,z]=p.pond[i];if(p.bridges.some(([a])=>Math.abs(x-a[0])<.45))continue;bushes.push({x,y,z,s:COMMONS_PLANTING.shrub});}
 return {trees,bushes};
}
