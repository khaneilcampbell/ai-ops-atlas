import {describe,it,expect} from 'vitest';
import {catalog} from '../../catalog';import {layoutMap,type GroupBy} from '../mapLayout';import {buildScene} from './scene';
import {laPlanting,laShrubKind,laTreeKind,fanPalm,datePalm,emptyParts,PALM_LIGHTS} from './laPlanting';
import {airportFootprint} from './airport';
import {planStreetLights,lightingObstacles} from './streetLighting';
import {planStreetPalms,airportSidewalkPalms,AIRPORT_SIDEWALK_X,STREET_PALMS,palmZones,streetPalmZones,inPalmZone,calmLawnPalms} from './streetPalms';
import {AIRPORT_LAYOUT} from './airport';
import {distanceToRoad} from './highway';

describe('Los Angeles planting',()=>{
 const s=buildScene(layoutMap(catalog,[],'district'));
 it('thins the lawns and keeps palms as specimens among olive, ficus, cypress and jacaranda (luxury, not jungle)',()=>{
  const drawn=s.trees.filter(t=>t.kind!=='palm'),kinds=drawn.map(laTreeKind).filter(k=>k!==null),share=(k:string)=>kinds.filter(x=>x===k).length/kinds.length;
  expect(kinds.length).toBeGreaterThan(80);
  expect(kinds.length/drawn.length).toBeLessThan(.8);
  expect(share('fan')+share('date')).toBeGreaterThan(.15);
  expect(share('fan')+share('date')).toBeLessThan(.4);
  for(const k of ['fan','date','olive','ficus','jacaranda','cypress'])expect(share(k),k).toBeGreaterThan(0);
 });
 it('grows the arena palms as avenue palms and keeps old blossom trees flowering, now jacaranda',()=>{
  expect(laTreeKind({x:1,z:1,kind:'palm'})).toBe('avenue');
  expect(laTreeKind({x:1,z:1,kind:'blossom'})).toBe('jacaranda');
  expect(['cypress',null]).toContain(laTreeKind({x:3.2,z:7.1,kind:'cone'}));
  expect(laTreeKind({x:3.2,z:7.1,kind:'avenue'})).toBe('avenue');
 });
 it('picks the same plant for the same spot every time',()=>{
  const a=laPlanting(s.trees,s.bushes),b=laPlanting(s.trees,s.bushes);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  const shrubs=s.bushes.map(laShrubKind);
  expect(new Set(shrubs)).toEqual(new Set(['hedge','agave','paradise','bougainvillea']));
  expect(shrubs.filter(k=>k==='hedge').length/shrubs.length).toBeGreaterThan(.4);
 });
 it('stands avenue palms upright at one height',()=>{
  const a=emptyParts(),b=emptyParts();fanPalm(a,1,0,2,.26,true);fanPalm(b,7.3,0,-4.1,.26,true);
  expect(a.trunks[0].s[1]).toBe(b.trunks[0].s[1]);expect(a.trunks[0].rx).toBe(0);
 });
 it('builds a fan palm tall and thin and a date palm short and full',()=>{
  const fan=emptyParts(),date=emptyParts();fanPalm(fan,0,0,0,.3);datePalm(date,0,0,0,.3);
  const fanH=fan.trunks[0].s[1],dateH=date.trunks[0].s[1];
  expect(fanH).toBeGreaterThan(dateH*1.5);
  expect(fan.trunks[0].s[0]).toBeLessThan(date.trunks[0].s[0]);
  const reach=(o:typeof fan)=>Math.max(...o.leaves.map(f=>Math.hypot(f.p[0],f.p[2])+f.s[2]/2));
  expect(reach(date)).toBeGreaterThan(reach(fan));
  // A leaning fan palm's crown still sits on top of its trunk.
  const top=fan.clumps[0].p;expect(Math.hypot(top[0],top[2])).toBeLessThan(fanH*.07);
 });
 it('draws a palm in far fewer triangles than the round tree it replaces',()=>{
  const o=emptyParts();fanPalm(o,0,0,0,.3);
  const palm=o.trunks.length*24+o.leaves.length*4+o.fronds.length*12+o.clumps.length*80,round=24+4*80;
  // Even against the round tree's far (overview) canopies.
  expect(palm).toBeLessThan(round*.6);
 });
});

for(const group of ['none','district','status','tag'] as GroupBy[])it(`plants formal palm avenues on the streets only, clear of the airport, lamps and buildings in ${group}`,()=>{
 const s=buildScene(layoutMap(catalog,[],group)),palms=planStreetPalms(s),lamps=planStreetLights(s),boxes=lightingObstacles(s),walks=s.transportConnections.map(c=>c.walk),streets=[...s.carBridges.flatMap(b=>b.roads),...s.transportConnections.map(c=>c.road),...(s.financial?[s.financial.street]:[]),...(s.community?.streets??[])];
 // Only the Galleria boulevard, the arena and the airport's front road keep street palms (Khaneil, 2026-11-13).
 const zones=palmZones(s);expect(palms.length).toBeGreaterThan(1);expect(palms.length).toBeLessThan(20);
 for(const p of palms)expect(inPalmZone(zones,p.x,p.z)).toBe(true);
 // No street palms by the Team Events Arena and its station (Khaneil, 2026-11-13).
 const arena=s.stadium?palmZones({stadium:s.stadium}):[];
 if(arena.length)expect(palms.filter(p=>inPalmZone(arena,p.x,p.z)&&!inPalmZone(streetPalmZones(s),p.x,p.z))).toHaveLength(0);
 // Outside the zones, lawn trees are never palms.
 for(const t of calmLawnPalms(s.trees,zones))if(!inPalmZone(zones,t.x,t.z)&&t.kind!=='palm')expect(['date','fan']).not.toContain(laTreeKind(t));
 const a=s.airport&&airportFootprint(s.airport);
 for(const p of palms){
  expect(laTreeKind(p)).toBe('avenue');
  expect(boxes.some(b=>Math.abs(p.x-b.x)<b.w/2+.12&&Math.abs(p.z-b.z)<b.d/2+.12)).toBe(false);
  expect(lamps.some(l=>Math.hypot(l.x-p.x,l.z-p.z)<STREET_PALMS.lampClear)).toBe(false);
  expect(walks.some(w=>distanceToRoad([p.x,p.z],w)<STREET_PALMS.walkClear),`palm at ${p.x},${p.z} on a walk`).toBe(false);
  // On planted grass, past the street, its kerb and the walk flush beside it (centre .6 out, .48 wide).
  expect(streets.some(r=>distanceToRoad([p.x,p.z],r)<1),`palm at ${p.x},${p.z} on a sidewalk`).toBe(false);
  if(a)expect(p.x>a.x-STREET_PALMS.airportMargin&&p.x<a.x+a.w+STREET_PALMS.airportMargin&&p.z>a.z-STREET_PALMS.airportMargin&&p.z<a.z+a.d+STREET_PALMS.airportMargin,`palm at ${p.x},${p.z} on the airport`).toBe(false);
 }
});

describe('airport sidewalk palms',()=>{
 for(const west of [false,true])it(`grow as the avenue palm on the public sidewalk (${west?'west':'east'}-facing campus)`,()=>{
  const a={x:10,z:20,accessX:0,accessZ:0,west},palms=airportSidewalkPalms(a);
  expect(palms.length).toBeGreaterThanOrEqual(3);
  const x=west?a.x+AIRPORT_LAYOUT.mirrorWidth-AIRPORT_SIDEWALK_X:a.x+AIRPORT_SIDEWALK_X;
  for(const p of palms){expect(laTreeKind(p)).toBe('avenue');expect(p.s).toBe(STREET_PALMS.size);expect(p.x).toBeCloseTo(x);}
 });
});

describe('palm string lights',()=>{
 it('light every palm, with an even spiral of bulbs hugging each trunk, leaning or not',()=>{
  const spiral=PALM_LIGHTS.turns*PALM_LIGHTS.perTurn+1;
  const o=emptyParts();fanPalm(o,0,0,0,STREET_PALMS.size,true);
  expect(o.bulbs.length).toBe(spiral);
  const top=Math.max(...o.bulbs.map(b=>b.p[1]));expect(top).toBeLessThan(STREET_PALMS.size*7.6);
  // A leaning lawn fan palm and a date palm are lit too, the bulbs staying on the trunk.
  for(const [x,z] of [[3.1,7.7],[12.4,-5.2],[-8.3,20.6]]){
   const f=emptyParts();fanPalm(f,x,0,z,.3);expect(f.bulbs.length).toBe(spiral);
   const trunk=f.trunks[0],lean=trunk.rx??0,yaw=trunk.r??0;
   for(const b of f.bulbs){const h=b.p[1],cx=x+Math.sin(lean)*Math.sin(yaw)*h/Math.cos(lean),cz=z+Math.sin(lean)*Math.cos(yaw)*h/Math.cos(lean);expect(Math.hypot(b.p[0]-cx,b.p[2]-cz)).toBeLessThan(.06);}
   const d=emptyParts();datePalm(d,x,0,z,.3);expect(d.bulbs.length).toBe(spiral);
  }
 });
});
