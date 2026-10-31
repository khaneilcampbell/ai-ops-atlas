import type {Inst} from './models';
import type {Pt} from './roads';
import type {Rect} from './scene';
/** Split at shore edges so guardrails and supports are only built over actual water. */
export function splitAtLand(spans:{a:Pt;b:Pt}[],land:Rect[]):{a:Pt;b:Pt;onLand:boolean}[]{
 return spans.flatMap(({a,b})=>{
  const axis=a[0]===b[0]?1:0,line=a[1-axis],lo=Math.min(a[axis],b[axis]),hi=Math.max(a[axis],b[axis]);
  const cuts=[lo,hi,...land.filter(r=>line>=(axis?r.x:r.z)&&line<=(axis?r.x+r.w:r.z+r.d)).flatMap(r=>axis?[r.z,r.z+r.d]:[r.x,r.x+r.w])].filter(v=>v>=lo&&v<=hi).sort((a,b)=>a-b);
  const unique=cuts.filter((v,i)=>!i||v-cuts[i-1]>.001);
  return unique.slice(1).map((v,i)=>{
   const p=(n:number):Pt=>axis?[line,n]:[n,line],mid=p((v+unique[i])/2);
   return {a:p(unique[i]),b:p(v),onLand:land.some(r=>mid[0]>=r.x&&mid[0]<=r.x+r.w&&mid[1]>=r.z&&mid[1]<=r.z+r.d)};
  });
 });
}
/** Sample from either end without reversing bridge furniture beyond its deck. */
export function bridgePoint(a:Pt,b:Pt,distance:number,side=0):Pt{
 const length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<1e-6)return [...a];
 const dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,t=Math.max(0,Math.min(length,distance));
 return [a[0]+dx*t+dz*side,a[1]+dz*t-dx*side];
}
/** Union collinear pieces before rendering, so shared district links never build two decks. */
export function connectionSpans(paths:Pt[][]):{a:Pt;b:Pt}[]{
 const groups=new Map<string,{axis:number;line:number;ranges:[number,number][]}>();
 for(const path of paths)for(let i=1;i<path.length;i++){
  const a=path[i-1],b=path[i];if(Math.hypot(b[0]-a[0],b[1]-a[1])<.02)continue;
  const axis=a[0]===b[0]?1:0,line=a[1-axis],key=`${axis}:${line.toFixed(6)}`;
  const g=groups.get(key)??{axis,line,ranges:[]};g.ranges.push([Math.min(a[axis],b[axis]),Math.max(a[axis],b[axis])]);groups.set(key,g);
 }
 return [...groups.values()].flatMap(g=>{const ranges:[number,number][]=[];
  for(const r of g.ranges.sort((a,b)=>a[0]-b[0])){const last=ranges[ranges.length-1];if(last&&r[0]<=last[1]+.001)last[1]=Math.max(last[1],r[1]);else ranges.push([...r]);}
  return ranges.map(([lo,hi])=>({a:(g.axis?[g.line,lo]:[lo,g.line]) as Pt,b:(g.axis?[g.line,hi]:[hi,g.line]) as Pt}));
 });
}
/** Cut individual rail sections at junctions instead of hiding a whole span by its midpoint. */
export function clipConnectionRails(items:Inst[],openings:Pt[],radius:number):Inst[]{
 return items.flatMap(item=>{
  if(!openings.length)return [item];
  // Footbridge rails use world X dimensions; vehicle rails use rotated local Z.
  const p=item.r===undefined&&item.s[0]>item.s[2]&&item.s[0]>.1?{...item,s:[item.s[2],item.s[1],item.s[0]] as [number,number,number],r:Math.PI/2}:item;
  const len=p.s[2];if(len<.1)return openings.some(q=>Math.hypot(p.p[0]-q[0],p.p[2]-q[1])<radius)?[]:[p];
  const dx=Math.sin(p.r??0),dz=Math.cos(p.r??0),dy=-Math.sin(p.rx??0),start:Pt=[p.p[0]-dx*len/2,p.p[2]-dz*len/2];let spans:[number,number][]=[[0,len]];
  for(const q of openings){const along=(q[0]-start[0])*dx+(q[1]-start[1])*dz,across=Math.abs((q[0]-start[0])*dz-(q[1]-start[1])*dx);if(across>=radius)continue;
   const cut=Math.sqrt(radius*radius-across*across);spans=spans.flatMap(([a,b])=>b<=along-cut||a>=along+cut?[[a,b] as [number,number]]:[[a,Math.min(b,along-cut)],[Math.max(a,along+cut),b]].filter(([x,y])=>y-x>.025) as [number,number][]);
  }
  return spans.map(([a,b])=>{const shift=(a+b-len)/2;return {...p,p:[p.p[0]+dx*shift,p.p[1]+dy*shift,p.p[2]+dz*shift] as [number,number,number],s:[p.s[0],p.s[1],b-a] as [number,number,number]};});
 });
}
