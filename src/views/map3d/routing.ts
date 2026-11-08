import {TRANSPORT} from './transportScale';
import {pathClear,type Box,type Pt} from './roads';
/** Rectilinear visibility grid. Coordinates include exact endpoints and obstacle setbacks. */
export function routeAround(from:Pt,to:Pt,boxes:Box[],margin:number):Pt[]|undefined{
 const direct=[from,[from[0],to[1]] as Pt,to];if(pathClear(direct,boxes,margin))return direct;
 const other=[from,[to[0],from[1]] as Pt,to];if(pathClear(other,boxes,margin))return other;
 const unique=(v:number[])=>[...new Set(v)].sort((a,b)=>a-b);
 const xs=unique([from[0],to[0],...boxes.flatMap(b=>[b.x-b.w/2-margin-.02,b.x+b.w/2+margin+.02])]);
 const zs=unique([from[1],to[1],...boxes.flatMap(b=>[b.z-b.d/2-margin-.02,b.z+b.d/2+margin+.02])]);
 const cols=xs.length,start=zs.indexOf(from[1])*cols+xs.indexOf(from[0]),end=zs.indexOf(to[1])*cols+xs.indexOf(to[0]);
 const point=(id:number):Pt=>[xs[id%cols],zs[Math.floor(id/cols)]];
 const cost=new Map([[start,0]]),came=new Map<number,number>(),heap:[number,number][]=[];
 const push=(id:number,score:number)=>{let i=heap.length;heap.push([id,score]);while(i){const p=(i-1)>>1;if(heap[p][1]<=score)break;[heap[i],heap[p]]=[heap[p],heap[i]];i=p;}};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;for(;;){let j=i*2+1;if(j>=heap.length)break;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[i][1]<=heap[j][1])break;[heap[i],heap[j]]=[heap[j],heap[i]];i=j;}}return first[0];};
 const done=new Set<number>();push(start,0);
 // An axis-aligned edge can only intersect obstacles in its own row or column.
 const columns=new Map<number,Box[]>(),rows=new Map<number,Box[]>();
 const blockers=(index:number,vertical:boolean)=>{const cache=vertical?columns:rows;let found=cache.get(index);if(!found){const coordinate=vertical?xs[index]:zs[index];found=boxes.filter(b=>vertical?coordinate>b.x-b.w/2-margin&&coordinate<b.x+b.w/2+margin:coordinate>b.z-b.d/2-margin&&coordinate<b.z+b.d/2+margin);cache.set(index,found);}return found;};
 while(heap.length){const cur=pop();if(done.has(cur))continue;if(cur===end)break;done.add(cur);const a=point(cur),x=cur%cols,z=Math.floor(cur/cols);
  for(const next of [...(x?[cur-1]:[]),...(x+1<cols?[cur+1]:[]),...(z?[cur-cols]:[]),...(z+1<zs.length?[cur+cols]:[])]){
   if(done.has(next))continue;const b=point(next);if(!pathClear([a,b],blockers(a[0]===b[0]?x:z,a[0]===b[0]),margin))continue;
   const d=cost.get(cur)!+Math.hypot(b[0]-a[0],b[1]-a[1]);if(d>=(cost.get(next)??Infinity))continue;
   came.set(next,cur);cost.set(next,d);push(next,d+Math.abs(b[0]-to[0])+Math.abs(b[1]-to[1]));
  }
 }
 if(!came.has(end))return;
 const ids=[end];while(ids[ids.length-1]!==start)ids.push(came.get(ids[ids.length-1])!);
 const raw=ids.reverse().map(point);
 return raw.filter((p,i)=>!i||i===raw.length-1||!((raw[i-1][0]===p[0]&&p[0]===raw[i+1][0])||(raw[i-1][1]===p[1]&&p[1]===raw[i+1][1])));
}

/**
 * Removes small Z-shaped jogs from a rectilinear route (the visibility grid steps sideways at
 * every building edge). A jog goes when one side of it can line up with the other and the road
 * stays clear, so a gap between buildings gets one straight street instead of a wiggle.
 */
/** How far a Z jog may sit from a parallel street and still move onto it: up to a street, its curb and the promenade beside it. */
export const JOG_TO_STREET=1.75;
const STREET_HALF=TRANSPORT.cityWidth/2;
export function straightenJogs(route:Pt[],boxes:Box[],margin:number,maxJog=1,streets:Pt[][]=[],jogAllowed:(p:Pt)=>boolean=()=>true):Pt[]{
 let path=route.map(p=>[p[0],p[1]] as Pt);
 const tidy=(p:Pt[])=>{const d=p.filter((q,i)=>!i||Math.hypot(q[0]-p[i-1][0],q[1]-p[i-1][1])>1e-9);return d.filter((q,i)=>!i||i===d.length-1||!((d[i-1][0]===q[0]&&q[0]===d[i+1][0])||(d[i-1][1]===q[1]&&q[1]===d[i+1][1])));};
 for(let changed=true,guard=0;changed&&guard<50;guard++){
  changed=false;path=tidy(path);
  for(let i=1;i+2<path.length&&!changed;i++){
   const a=path[i-1],b=path[i],c=path[i+1],d=path[i+2];
   const vertical=a[0]===b[0]&&c[0]===d[0]&&b[1]===c[1],horizontal=a[1]===b[1]&&c[1]===d[1]&&b[0]===c[0];
   if(!vertical&&!horizontal)continue;
   const axis=vertical?0:1,jog=Math.abs(c[axis]-b[axis]);if(jog<1e-9||jog>maxJog)continue;
   // Same direction before and after: a Z, not a U-turn.
   const along=1-axis;if(Math.sign(b[along]-a[along])!==Math.sign(d[along]-c[along]))continue;
   // A jog that already runs along a street is a plain offset crossing of that street: keep it.
   const onAStreet=(q:Pt)=>streets.some(st=>st.slice(1).some((e,k)=>{const f=st[k],dx=e[0]-f[0],dz=e[1]-f[1],t=Math.max(0,Math.min(1,((q[0]-f[0])*dx+(q[1]-f[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(q[0]-f[0]-dx*t,q[1]-f[1]-dz*t)<1e-6;}));
   if(onAStreet(b)&&onAStreet(c))continue;
   const options:Pt[][]=[];
   if(i-1>0){const p=path.map(q=>[q[0],q[1]] as Pt);p[i-1][axis]=c[axis];p[i][axis]=c[axis];options.push(p);}
   if(i+2<path.length-1){const p=path.map(q=>[q[0],q[1]] as Pt);p[i+1][axis]=b[axis];p[i+2][axis]=b[axis];options.push(p);}
   // A jog next to the fixed start moves back along the first stretch instead, away from any
   // street it would otherwise sit on (and onto land, not a bridge), so the road crosses that street straight.
   const nearStreet=(q:Pt)=>streets.some(st=>st.slice(1).some((e,k)=>{const f=st[k],dx=e[0]-f[0],dz=e[1]-f[1],t=Math.max(0,Math.min(1,((q[0]-f[0])*dx+(q[1]-f[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(q[0]-f[0]-dx*t,q[1]-f[1]-dz*t)<1.5;}));
   if(i-1===0&&nearStreet(b))for(const t of [.5,.35,.65,.2,.8,.1,.9]){const m:Pt=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],n:Pt=[m[0],m[1]];n[axis]=c[axis];if(!nearStreet(m)&&!nearStreet(n)&&jogAllowed(m)&&jogAllowed(n))options.push([a,m,n,...path.slice(i+1)]);}
   // A jog right beside a parallel street moves onto that street, so the road meets it as a plain
   // offset crossing instead of an S-bend squeezed onto the pavement.
   const mid:Pt=[(b[0]+c[0])/2,(b[1]+c[1])/2];
   const onStreet=new Set<Pt[]>();
   for(const st of streets)for(let k=1;k<st.length;k++){const e=st[k-1],f=st[k];if(Math.abs(e[along]-f[along])>1e-6||Math.abs(mid[along]-e[along])<1e-9||Math.abs(mid[along]-e[along])>JOG_TO_STREET)continue;
    if(mid[axis]<Math.min(e[axis],f[axis])||mid[axis]>Math.max(e[axis],f[axis]))continue;
    const p=path.map(q=>[q[0],q[1]] as Pt);p[i][along]=e[along];p[i+1][along]=e[along];
    if(Math.sign(p[i][along]-a[along])===Math.sign(b[along]-a[along])&&Math.sign(d[along]-p[i+1][along])===Math.sign(d[along]-c[along])){options.unshift(p);onStreet.add(p);}}
   // The leg along the street is the street itself, already clear; only the legs to and from it are checked.
   // They stop at the street's edge, where the street's own clearance takes over.
   const edge=(q:Pt,from:Pt):Pt=>{const l=Math.hypot(q[0]-from[0],q[1]-from[1])||1,k=Math.min(1,STREET_HALF/l);return [q[0]+(from[0]-q[0])*k,q[1]+(from[1]-q[1])*k];};
   const clear=(p:Pt[])=>onStreet.has(p)?pathClear([...p.slice(0,i),edge(p[i],p[i-1])],boxes,margin)&&pathClear([edge(p[i+1],p[i+2]),...p.slice(i+2)],boxes,margin):pathClear(p,boxes,margin);
   const ok=options.find(clear);if(ok){path=ok;changed=true;}
  }
 }
 return tidy(path);
}
