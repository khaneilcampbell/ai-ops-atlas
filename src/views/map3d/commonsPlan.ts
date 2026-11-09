import type {Rect,Scene3D} from './scene';
import type {Pt} from './roads';
export const COMMONS_KEY='service:atlas-commons';
export const COMMONS_NAME='Atlas Commons';
export const COMMONS={pathWidth:.48,bridgeWidth:.55,edgeClearance:.6,pavilionRadius:1.05} as const;
export interface CommonsPlan {rect:Rect;pond:Pt[];loop:Pt[];paths:Pt[][];bridges:[Pt,Pt][];pavilion:Pt;amphitheater:Pt;trees:Pt[];benches:Pt[];lights:Pt[];access:{service:Pt;marketplace:Pt}}
/** One bounded park in the existing meadow; no headquarters or transport coordinates move. */
export function planCommons(s:Pick<Scene3D,'mall'|'towers'|'paving'|'transportConnections'>):CommonsPlan|undefined{
 const mall=s.mall,desk=s.towers.find(t=>t.projectId==='service-desk'),profile=s.towers.find(t=>t.projectId==='github-profile');
 if(!mall||!desk||!profile)return;
 let x=Math.max(desk.x+desk.size/2+5,profile.x-3.55),z=Math.max(profile.z+profile.size/2+3.4,mall.z+.8),w=mall.x-.7-x,d=mall.plaza.z-.55-z;

 if(w<12){w=15;x=mall.x-.7-w;z=mall.z+.8;d=mall.plaza.z-.55-z;}
 if(d<6.8||s.towers.some(b=>b.x+b.size/2>x&&b.x-b.size/2<x+w&&b.z+b.size/2>z&&b.z-b.size/2<z+d))return;
 const rect={x,z,w,d},cx=x+w*.63,cz=z+d*.5,rx=w*.275,rz=d*.245;
 const outline=(grow:number)=>Array.from({length:49},(_,i):Pt=>{const a=i%48/48*Math.PI*2;return [cx+(rx+grow)*Math.cos(a),cz+(rz*(.65+.35*Math.abs(Math.cos(a)))+grow)*Math.sin(a)];});
 const pond=outline(0),loop=outline(.65);
 const bridges:[Pt,Pt][]=[10,14].map(i=>[loop[i],loop[48-i]]);
 const pavilion:Pt=[x+2.1,z+2.1],amphitheater:Pt=[x+3.1,z+d*.67];
 // Join the existing Service Desk approach, and the Marketplace's already paved promenade.
 const service:Pt=s.transportConnections.find(c=>c.id==='skyline-airport')?.walk[0]??[desk.x,desk.z+desk.size/2+1.2],marketplace:Pt=[mall.plaza.x+.1,mall.plaza.z+.425],join:Pt=[x+3.6,cz];
 const paths:Pt[][]=[loop,[loop[24],join,[join[0],service[1]],service],[loop[12],[loop[12][0],z+d-.1],[marketplace[0],z+d-.1],marketplace],[[pavilion[0],pavilion[1]+1.15],[join[0],pavilion[1]+1.15],join],[[amphitheater[0],amphitheater[1]+1.15],[join[0],amphitheater[1]+1.15],[join[0],service[1]]]];
 const trees:Pt[]=[[x+.65,z+.75],[x+w*.31,z+.65],[x+w*.53,z+.65],[x+w*.78,z+.65],[x+w-.65,z+.75],[x+w-.65,z+d-.65],[x+w*.35,z+d-.7]];
 const benches:Pt[]=[[x+w*.48,z+.75],[x+w*.72,z+.75],[x+w-.65,z+d*.66]];
 const lights:Pt[]=[...trees.filter((_,i)=>i%2===0).map(([x,z]):Pt=>[x+.3,z+.15]),[join[0]-.35,service[1]]];
 return {rect,pond,loop,paths,bridges,pavilion,amphitheater,trees,benches,lights,access:{service,marketplace}};
}
