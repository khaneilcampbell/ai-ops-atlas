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
