import type {Inst} from './models';
import {AIRPORT_LAYOUT,AIRCRAFT_LAYOUT} from './airport';

/** Atlas Airport terminal, redesigned (KC, 2026-10-31): an oval glass hub under a white ribbed shell,
 * a glazed pier with rounded ends, a twisted control tower and an oval car park. Procedural shapes only,
 * airport-local coordinates, all drawn with shared instanced meshes (no new lights or textures). */
export const TERMINAL_HUB={x:1.5,z:6,rx:1.9,rz:5,glass:1.85,eave:1.92} as const;
export const TERMINAL_PIER={x:3.65,width:.7,from:-1.45,to:13.95,floor:.2,glass:.36} as const;
export const CONTROL_TOWER={x:1.5,z:-3,segments:25,step:.15,twist:.17,cab:3.75} as const;
export const CAR_PARK={x:1,z:-6.4,w:5,d:3.6} as const;

/** One part list per material and shape, so the whole terminal is a handful of draw calls. */
export interface TerminalParts {
  /** White shell, ribs, slabs and tower: box geometry, plain material. */
  shell:Inst[];
  /** Oval and round pieces: lifted cylinder, plain material. */
  discs:Inst[];
  /** Glazed walls: lifted cylinder / box, glazing material. */
  glassDiscs:Inst[];
  glassBoxes:Inst[];
  /** Tinted roof glass (green band, oculus, skylights): sphere / cylinder / box. */
  tintBalls:Inst[];
  tintDiscs:Inst[];
  tintBoxes:Inst[];
  /** Flared control-tower cab: cone geometry, glazing material. */
  cab:Inst[];
  /** Domes: sphere geometry, plain material. */
  domes:Inst[];
  /** Painted apron guide lines: box geometry, plain material. */
  lines:Inst[];
}

const WHITE='#f3f2ec',RIB='#fbfaf6',SLAB='#e4e0d3',GREEN='#294237',TINT='#ffffff',LINE='#f1eedf';

/** Points on the hub's oval, with the outward-facing yaw for a radial fin. */
export function hubRim(count:number,grow=0){
  const h=TERMINAL_HUB;
  return Array.from({length:count},(_,i)=>{
    const t=i/count*Math.PI*2,rx=h.rx+grow,rz=h.rz+grow;
    return {x:h.x+rx*Math.cos(t),z:h.z+rz*Math.sin(t),yaw:Math.atan2(Math.cos(t)/rx,Math.sin(t)/rz),angle:t};
  });
}

export function terminalParts(ox:number,oy:number,oz:number):TerminalParts{
  const parts:TerminalParts={shell:[],discs:[],glassDiscs:[],glassBoxes:[],tintBalls:[],tintDiscs:[],tintBoxes:[],cab:[],domes:[],lines:[]};
  const at=(x:number,y:number,z:number):[number,number,number]=>[ox+x,oy+y,oz+z];
  const h=TERMINAL_HUB,p=TERMINAL_PIER,t=CONTROL_TOWER,c=CAR_PARK;
  // Hub: plinth, glass drum, mezzanine, white eave, green-glass band, shallow dome and glass oculus.
  parts.discs.push({p:at(h.x,0,h.z),s:[2*h.rx+.5,.06,2*h.rz+.5],c:SLAB});
  parts.glassDiscs.push({p:at(h.x,.06,h.z),s:[2*h.rx,h.glass-.06,2*h.rz],c:TINT});
  parts.discs.push({p:at(h.x+.25,1.2,h.z),s:[2*h.rx-1.2,.07,2*h.rz-1.6],c:WHITE});
  parts.tintDiscs.push({p:at(h.x,h.glass-.04,h.z),s:[2*h.rx+.36,.08,2*h.rz+.36],c:'#8fc7b4'});
  parts.discs.push({p:at(h.x,h.eave-.04,h.z),s:[2*h.rx+.62,.1,2*h.rz+.62],c:WHITE});
  parts.domes.push({p:at(h.x,h.eave+.04,h.z),s:[h.rx+.18,.42,h.rz+.18],c:WHITE});
  parts.tintBalls.push({p:at(h.x,h.eave+.07,h.z),s:[h.rx*.5,.56,h.rz*.56],c:'#9ad2c4'});
  // Ribbed shell: radial white fins all round the drum, rising into the eave.
  for(const r of hubRim(44,.02))parts.shell.push({p:at(r.x,.06,r.z),s:[.045,h.eave-.02,.2],r:r.yaw,c:RIB});
  // Roof ribs over the dome, like the meridians of a shell.
  for(let i=0;i<10;i++){const a=i/10*Math.PI,reach=1/Math.hypot(Math.sin(a)/(h.rx+.2),Math.cos(a)/(h.rz+.2));parts.domes.push({p:at(h.x,h.eave+.04,h.z),s:[.035,.435,reach],r:a,c:RIB});}
  // Landside fan canopy over the drop-off kerb, louvres radiating from the hub.
  for(let deg=146;deg<=214;deg+=4){
    const a=deg*Math.PI/180,len=1.05,rx=h.rx+.15+len/2,rz=h.rz+.15+len/2;
    parts.shell.push({p:at(h.x+rx*Math.cos(a),1.02,h.z+rz*Math.sin(a)),s:[.05,.04,len],r:Math.atan2(Math.cos(a)/rx,Math.sin(a)/rz),c:RIB});
  }
  for(const deg of [150,180,210]){const a=deg*Math.PI/180;parts.shell.push({p:at(h.x+(h.rx+1.1)*Math.cos(a),.05,h.z+(h.rz+1.1)*Math.sin(a)),s:[.06,.98,.06],c:'#cfd3cb'});}
  // Pier: raised glass gallery with rounded ends, white roof and a tinted skylight spine.
  const mid=(p.from+p.to)/2,len=p.to-p.from;
  parts.shell.push({p:at(p.x,0,mid),s:[p.width,p.floor,len],c:SLAB});
  parts.glassBoxes.push({p:at(p.x,p.floor,mid),s:[p.width,p.glass,len],c:TINT});
  parts.shell.push({p:at(p.x,p.floor+p.glass,mid),s:[p.width+.18,.06,len],c:WHITE});
  parts.tintBoxes.push({p:at(p.x,p.floor+p.glass+.06,mid),s:[.3,.05,len-.2],c:'#9ad2c4'});
  for(const end of [p.from,p.to]){
    parts.discs.push({p:at(p.x,0,end),s:[p.width+.4,p.floor,p.width+.4],c:SLAB});
    parts.glassDiscs.push({p:at(p.x,p.floor,end),s:[p.width+.4,p.glass,p.width+.4],c:TINT});
    parts.discs.push({p:at(p.x,p.floor+p.glass,end),s:[p.width+.58,.06,p.width+.58],c:WHITE});
    parts.tintDiscs.push({p:at(p.x,p.floor+p.glass+.06,end),s:[.42,.05,.42],c:'#9ad2c4'});
  }
  for(let z=p.from+.25;z<p.to-.1;z+=.5)for(const side of [-1,1])parts.shell.push({p:at(p.x+side*(p.width/2+.015),p.floor,z),s:[.03,p.glass,.05],c:RIB});
  // Rotundas where each jet bridge leaves the pier.
  for(const gz of AIRPORT_LAYOUT.gateZ){
    const bz=gz+AIRCRAFT_LAYOUT.doorZ;
    parts.discs.push({p:at(p.x+p.width/2+.1,0,bz),s:[.36,.56,.36],c:WHITE});
  }
  // Control tower: a twisting, tapering shaft carrying a flared glass cab, roof disc, crown and mast.
  // A tinted glass core wrapped by three white fins that spiral up to the cab.
  parts.tintDiscs.push({p:at(t.x,0,t.z),s:[.44,t.cab,.44],c:'#bfe0d6'});
  for(let i=0;i<t.segments;i++)for(let k=0;k<3;k++){
    const a=i*t.twist+k*Math.PI*2/3,r=.27-i*.006;
    parts.shell.push({p:at(t.x+r*Math.sin(a),i*t.step,t.z+r*Math.cos(a)),s:[.1,t.step+.012,.2],r:a,c:WHITE});
  }
  parts.discs.push({p:at(t.x,t.cab-.12,t.z),s:[.95,.14,.95],c:WHITE});
  parts.cab.push({p:at(t.x,t.cab,t.z),s:[1.25,.48,1.25],c:TINT});
  parts.discs.push({p:at(t.x,t.cab+.48,t.z),s:[1.42,.08,1.42],c:WHITE});
  parts.domes.push({p:at(t.x,t.cab+.56,t.z),s:[.42,.22,.42],c:WHITE});
  parts.shell.push({p:at(t.x,t.cab+.7,t.z),s:[.035,.42,.035],c:GREEN});
  parts.domes.push({p:at(t.x,t.cab+1.15,t.z),s:[.06,.06,.06],c:'#d0ad69'});
  // Oval car park with a white kerb ring.
  parts.discs.push({p:at(c.x,.02,c.z),s:[c.w+.3,.02,c.d+.3],c:LINE});
  parts.discs.push({p:at(c.x,.03,c.z),s:[c.w,.02,c.d],c:'#424b50'});
  // Apron: a painted ring round every stand and a curved lead-in line from the taxiway.
  const ring=(cx:number,cz:number,r:number,from:number,to:number,n:number)=>{
    for(let i=0;i<n;i++){
      const a0=from+(to-from)*i/n,a1=from+(to-from)*(i+1)/n,am=(a0+a1)/2,seg=Math.abs(a1-a0)*r+.02;
      parts.lines.push({p:at(cx+r*Math.cos(am),.06,cz+r*Math.sin(am)),s:[.04,.012,seg],r:-am,c:LINE});
    }
  };
  for(const gz of AIRPORT_LAYOUT.gateZ){
    ring(AIRPORT_LAYOUT.gateX,gz,1.85,0,Math.PI*2,30);
    ring(AIRPORT_LAYOUT.taxiX-1.6,gz+1.6,1.6,0,-Math.PI/2,10);
    const from=AIRPORT_LAYOUT.gateX+1.85,to=AIRPORT_LAYOUT.taxiX-1.6;
    parts.lines.push({p:at((from+to)/2,.06,gz),s:[to-from,.012,.04],c:LINE});
  }
  return parts;
}
