import {it,expect} from 'vitest';
import {terminalParts,TERMINAL_HUB as H,TERMINAL_PIER as P,CONTROL_TOWER as T,hubRim} from './airportTerminal';
import {AIRPORT_BUILDINGS} from './airportBuildings';
import {AIRPORT_LAYOUT,AIRCRAFT_LAYOUT,BOARDING_LAYOUT} from './airport';

const parcel=(id:string)=>AIRPORT_BUILDINGS.find(b=>b.id===id)!;
const all=()=>Object.values(terminalParts(0,0,0)).flat();

it('keeps the oval hub inside the terminal parcel the map uses for picking and flight clearance',()=>{
 const t=parcel('terminal');
 for(const r of hubRim(72,.33)){expect(Math.abs(r.x-t.x)).toBeLessThanOrEqual(t.w/2+.36);expect(Math.abs(r.z-t.z)).toBeLessThanOrEqual(t.d/2+.36);}
 const top=Math.max(...all().filter(p=>Math.abs(p.p[0]-H.x)<H.rx&&Math.abs(p.p[2]-H.z)<H.rz).map(p=>p.p[1]+(p.s[1]<1?p.s[1]:0)));
 expect(top).toBeLessThanOrEqual(t.h+.1);
});

it('keeps the twisted tower within its parcel and under its listed height',()=>{
 const t=parcel('tower'),parts=terminalParts(0,0,0);
 const tower=[...parts.shell,...parts.discs,...parts.domes,...parts.cab,...parts.tintDiscs].filter(p=>Math.hypot(p.p[0]-T.x,p.p[2]-T.z)<1);
 for(const p of tower){expect(Math.abs(p.p[0]-t.x)).toBeLessThanOrEqual(t.w/2+.01);expect(Math.abs(p.p[2]-t.z)).toBeLessThanOrEqual(t.d/2+.01);}
 expect(Math.max(...tower.map(p=>p.p[1]+(p.s[1]>.1?p.s[1]:p.s[1])))).toBeLessThanOrEqual(t.h+.05);
});

it('leaves every stand clear of the pier and links each jet bridge to it',()=>{
 for(const gz of AIRPORT_LAYOUT.gateZ){
  expect(AIRPORT_LAYOUT.gateX-AIRCRAFT_LAYOUT.halfSpan).toBeGreaterThan(P.x+P.width/2+.5);
  const door=gz+AIRCRAFT_LAYOUT.doorZ;expect(door).toBeGreaterThan(P.from);expect(door).toBeLessThan(P.to);
 }
 expect(BOARDING_LAYOUT.fromX).toBeGreaterThan(P.x-P.width/2);
 expect(BOARDING_LAYOUT.fromX).toBeLessThan(P.x+P.width/2);
});

it('stays a light scene: shared shapes, a bounded number of instances',()=>{
 expect(all().length).toBeLessThan(500);
 for(const p of all())for(const v of [...p.p,...p.s])expect(Number.isFinite(v)).toBe(true);
});
