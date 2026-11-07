import type {Inst} from "./models";

/**
 * A palm in plain boxes (KC, 2026-11-07: "use palm tree around the stadium"): the Financial
 * District's palm, a ringed two-step trunk under a crown of drooping fronds with a few coconuts,
 * drawn with boxes only so it joins a building's plain instanced set at no extra draw.
 */
export function palmBoxes(x:number,y:number,z:number,i:number,k=1):Inst[]{
 const top=(1.5+(i%3)*.1)*k,out:Inst[]=[],b=(px:number,py:number,pz:number,w:number,h:number,d:number,c:string,r?:number,rx?:number):Inst=>({p:[px,y+py,pz],s:[w*k,h,d*k],c,r,rx});
 out.push(b(x,.02,z,.11,top*.5,.11,'#9a8a68'),b(x,.02+top*.5,z,.09,top*.5,.09,'#8e7f5f'));
 for(const ring of [.4,.8,1.2])if(ring*k<top)out.push(b(x,ring*k,z,.12,.03,.12,'#7d6f53'));
 for(let f=0;f<7;f++){const t=f/7*Math.PI*2+i*.4;out.push(b(x+Math.sin(t)*.38*k,top-.05,z+Math.cos(t)*.38*k,.16,.05,.55,f%2?'#5c8f4e':'#6ea35a',t,.42));}
 out.push(b(x,top-.02,z,.15,.1,.15,'#5c8f4e'));
 for(const t of [.6,2.7,4.8])out.push(b(x+Math.sin(t)*.08*k,top-.12,z+Math.cos(t)*.08*k,.06,.06,.06,'#8a6a3e'));
 return out;
}
