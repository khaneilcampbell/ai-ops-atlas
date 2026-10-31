import {expect,it} from 'vitest';
import {financialArchitecture,financialDimensions,financialHeight,financialSignLevel,FINANCIAL_METRES_PER_UNIT,WELLS_FARGO_REFERENCE_METRES,BALCONY} from './financialArchitecture';
import {financialInteriorBrand,financialInteriorKey,financialBrand} from './financialBrands';
import {FINANCIAL_BUILDINGS} from './financialPlan';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
import {financialBuildingMatches} from '../../lib/financialSearch';
const palette={ivory:'#f7f7f0',green:'#294237',gold:'#d0ad69'};
const identities=[['residence','Circa'],['harbor-residence','The Ritz-Carlton'],['records','Wells Fargo'],['financial-planning','Vanguard'],['budget','American Express'],['business-finance','Benjaire Finance']] as const;
for(const [id,name]of identities)it(`${name} keeps a stable route, searchable name and safe geometry envelope`,()=>{
 const b=FINANCIAL_BUILDINGS.find(b=>b.id===id)!;expect(b.name).toBe(name);expect(financialBuildingMatches(name).map(b=>b.id)).toContain(id);
 expect(financialBuildingMatches(financialInteriorBrand(financialInteriorKey(id))!.legacyName).map(b=>b.id)).toContain(id);
 expect(financialInteriorBrand(financialInteriorKey(id))?.id).toBe(id);expect(BUILDING_INTERIORS[financialInteriorKey(id)].rooms).toHaveLength(4);
 for(const height of [9,13,18]){
  const shape=financialArchitecture(id,height,palette),bounds=financialDimensions(id);
  for(const [kind,parts]of Object.entries({solid:shape.solid,glass:shape.glass,clearGlass:shape.clearGlass,glow:shape.glow,bevelled:shape.bevelled,leaves:shape.leaves}))for(const p of parts){
   expect([...p.p,...p.s].every(Number.isFinite)).toBe(true);expect(p.s.every(n=>n>0)).toBe(true);
   const factor=kind==='leaves'?1:.5,rx=Math.abs(Math.cos(p.r??0))*p.s[0]*factor+Math.abs(Math.sin(p.r??0))*p.s[2]*factor,rz=Math.abs(Math.sin(p.r??0))*p.s[0]*factor+Math.abs(Math.cos(p.r??0))*p.s[2]*factor;
   expect(Math.abs(p.p[0])+rx).toBeLessThanOrEqual(bounds.w/2+.001);expect(Math.abs(p.p[2])+rz).toBeLessThanOrEqual(bounds.d/2+.001);
   expect(p.p[1]+p.s[1]).toBeLessThanOrEqual(height+bounds.top);
  }
 }
});
it('Circa keeps a continuous outer walk around recessed garden planters and below the next balcony',()=>{
 const a=financialArchitecture('residence',13,palette);expect(a.balconies.length).toBeGreaterThan(15);expect(a.trees.filter(t=>t.floor>=0).length).toBeGreaterThan(2);
 for(const deck of a.balconies){expect((deck.outerW-deck.innerW)/2).toBeGreaterThanOrEqual(BALCONY.walkClearance);expect((deck.outerD-deck.innerD)/2).toBeGreaterThanOrEqual(BALCONY.walkClearance);}
 for(const t of a.trees.filter(t=>t.floor>=0)){
  const deck=a.balconies[t.floor],next=a.balconies[t.floor+1],side=t.x!==0,axis=side?Math.abs(t.x):Math.abs(t.z),inner=(side?deck.innerW:deck.innerD)/2,outer=(side?deck.outerW:deck.outerD)/2;expect(axis-.17).toBeGreaterThan(inner+.025);
  expect(outer-axis-.17).toBeGreaterThanOrEqual(BALCONY.walkClearance);
  if(next)expect(t.y+.34).toBeLessThan(next.y);
 }
});
it('keeps the Financial District bank distinct from the existing Skyline bank',()=>{
 expect(financialInteriorBrand('Wells Fargo')).toBeUndefined();expect(financialInteriorBrand('financial:records')?.name).toBe('Wells Fargo');
 expect(BUILDING_INTERIORS['Wells Fargo'].subtitle).toBe('BANKING & FINANCIAL OPERATIONS');expect(BUILDING_INTERIORS['financial:records'].subtitle).toContain('FINANCIAL DISTRICT');
});
it('scales the 235-metre architectural reference without breaking HQ-relative heights',()=>{
 expect(financialHeight('records',8,1.12)).toBe(WELLS_FARGO_REFERENCE_METRES/FINANCIAL_METRES_PER_UNIT);
 expect(financialHeight('records',20,1.12)).toBeGreaterThan(20);expect(financialSignLevel('financial-planning',12)).toBeLessThan(12*.54);
});
it('retains the three other tower names and stable IDs',()=>{
 expect(FINANCIAL_BUILDINGS.filter(b=>!identities.some(([id])=>id===b.id)).map(b=>[b.id,b.name])).toEqual([['banks','Chase'],['investments','Robinhood'],['insurance','Navy Federal Credit Union']]);
});

it('joins the top sign band to floor volumes without coplanar overlapping walls',()=>{
 for(const [id]of identities){const shape=financialArchitecture(id,13,palette),body=financialBrand(id)!.body,volumes=[...shape.solid,...shape.bevelled].filter(p=>p.c===body&&p.p[0]===0&&p.p[2]===0&&p.s[0]>1.7&&p.s[2]>1.7).sort((a,b)=>a.p[1]-b.p[1]);
 for(let i=1;i<volumes.length;i++)expect(volumes[i-1].p[1]+volumes[i-1].s[1]).toBeLessThanOrEqual(volumes[i].p[1]+1e-9);
 }
});

it('swaps American Express and Wells Fargo while keeping Circa and stable identities',()=>{
 expect(FINANCIAL_BUILDINGS.find(b=>b.id==='residence')).toMatchObject({name:'Circa',x:3.5,z:9,rise:1.24});
 expect(FINANCIAL_BUILDINGS.find(b=>b.id==='budget')).toMatchObject({name:'American Express',x:14.5,z:9.5,rise:1.08});
 expect(FINANCIAL_BUILDINGS.find(b=>b.id==='records')).toMatchObject({name:'Wells Fargo',x:15.7,z:4.3});
 expect(financialInteriorBrand('Spending & Budget')?.id).toBe('budget');
 expect(financialBuildingMatches('American Express')[0].id).toBe('budget');expect(financialBuildingMatches('Spending & Budget')[0].id).toBe('budget');
 expect(financialSignLevel('budget',10)).toBe(5);
});

it('restores American Express original Art Deco window grid and HQ-relative height',()=>{
 const shape=financialArchitecture('budget',10,palette);
 expect(shape.clearGlass).toHaveLength(0);expect(shape.glow).toHaveLength(0);
 expect(shape.glass.length).toBeGreaterThan(100);
 expect(shape.solid.some(p=>p.p[0]===0&&p.p[2]===0&&p.s[0]>2&&p.s[1]>.2)).toBe(true);
 expect(financialHeight('budget',8,1.08)).toBeCloseTo(8*1.08);
});

it('Benjaire Finance has three supported pavilion ribbons within its original block',()=>{
 const shape=financialArchitecture('business-finance',12,palette),ribbons=shape.solid.filter(p=>p.rx!==undefined);
 expect(ribbons).toHaveLength(24);expect(new Set(ribbons.map(p=>p.p[0])).size).toBe(3);
 expect(financialBuildingMatches('Business Finance')[0].name).toBe('Benjaire Finance');
 expect(financialBuildingMatches('Benjaire Finance')[0].id).toBe('business-finance');
});
