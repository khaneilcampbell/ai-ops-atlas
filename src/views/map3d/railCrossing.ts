import type {Inst} from './models';
import {roadIntersections} from './highway';
import {TRANSPORT} from './transportScale';
import {COMMUNITY} from './hillsCommunityPlan';
type Pt=[number,number];
type Seg=[Pt,Pt];

/**
 * Level crossings on the ground-level shore railway (Khaneil, 2026-11-15: "put the train station tracks on the ground",
 * keeping the yacht dock in mind). Where a ground walk, such as the Events Arena forecourt's walk to the marina stair,
 * or a street meets the track, it crosses on a flush deck between the rails instead of under a viaduct.
 */
export const RAIL_CROSSING={walkWidth:.62,span:1.1,postGap:.12,deckTop:COMMUNITY.railRise+.07,signalHeight:.62} as const;
export interface RailCrossing {at:Pt;dir:Pt;width:number;kind:'walk'|'road'}

/** Every point where a walk or street segment meets the track, once each, with the crossing's direction. */
export function railCrossings(route:Pt[],walks:Seg[],roads:Seg[]=[]):RailCrossing[]{
 const out:RailCrossing[]=[];
 for(const [kind,list] of [['walk',walks],['road',roads]] as const)for(const seg of list){
  const len=Math.hypot(seg[1][0]-seg[0][0],seg[1][1]-seg[0][1]);if(len<1e-6)continue;
  const dir:Pt=[(seg[1][0]-seg[0][0])/len,(seg[1][1]-seg[0][1])/len];
  for(const at of roadIntersections(route,seg))if(!out.some(c=>Math.hypot(c.at[0]-at[0],c.at[1]-at[1])<.3))out.push({at,dir,kind,width:kind==='walk'?RAIL_CROSSING.walkWidth:TRANSPORT.cityWidth+.1});
 }
 return out;
}

/** Deck, white edge lines and two signal posts, in world x/z with heights above the terrace. `light` marks the red signal lamps (drawn in the plain material so they stay red at night). */
export function railCrossingParts(c:RailCrossing,night:boolean):(Inst&{light?:boolean})[]{
 const [ux,uz]=c.dir,r=Math.atan2(ux,uz),S=RAIL_CROSSING.span;
 // a runs along the crossing walk (over the track), b across it.
 const at=(a:number,b:number):[number,number]=>[c.at[0]+ux*a+uz*b,c.at[1]+uz*a-ux*b];
 const part=(a:number,b:number,y:number,s:[number,number,number],col:string,light=false)=>{const [x,z]=at(a,b);return {p:[x,y,z] as [number,number,number],s,c:col,r,...(light?{light}:{})};};
 const out=[part(0,0,-.02,[c.width,RAIL_CROSSING.deckTop+.02,S],'#cfc9ba')];
 for(const a of [-S/2+.03,S/2-.03])out.push(part(a,0,RAIL_CROSSING.deckTop,[c.width,.006,.05],'#f7f7f0'));
 // A signal post on the right of each approach, close to the deck: the track runs only .75 inside the shore, so the
 // dock-side post must still stand on land at the head of the marina stair. Pole, white sign board and a red lamp that glows at night.
 for(const side of [-1,1]){const a=side*(S/2+RAIL_CROSSING.postGap),b=side*(c.width/2+.12),h=RAIL_CROSSING.signalHeight;
  out.push(part(a,b,0,[.04,h,.04],'#2f3a3c'),part(a,b,h-.2,[.24,.1,.02],'#f4f2ec'),part(a,b,h,[.08,.06,.04],night?'#ff5a4a':'#b8433a',true));}
 return out;
}
