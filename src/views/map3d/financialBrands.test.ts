import {it,expect} from 'vitest';
import {FINANCIAL_BRANDS,financialSignPlacement,FINANCIAL_SIGN} from './financialBrands';
import {FINANCIAL_BUILDINGS,FINANCIAL,financialKey} from './financialPlan';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
const stable=[['banks','Chase',4,4,1.32],['investments','Robinhood',9.8,6.8,1.48],['insurance','Navy Federal Credit Union',-20,4,1.18]] as const;
for(const [id,name,x,z,rise]of stable)it(`brands ${id} without changing its placement or identity`,()=>{
 const b=FINANCIAL_BUILDINGS.find(b=>b.id===id)!;expect(b).toMatchObject({name,x,z,rise});expect(financialKey(id)).toBe(`service:financial:${id}`);
 const brand=FINANCIAL_BRANDS.find(b=>b.id===id)!;
 expect(BUILDING_INTERIORS[name].rooms).toEqual([...brand.rooms]);expect(BUILDING_INTERIORS[name].accent).toBe(brand.accent);expect(BUILDING_INTERIORS[brand.legacyName]).toBe(BUILDING_INTERIORS[name]);
 expect(b.purpose).toContain('Unofficial visual representation');
});
it('keeps upper signs clear of windows, doors and structural corners',()=>{
 for(const height of [8,10,14]){const p=financialSignPlacement(height,FINANCIAL.towerDepth,FINANCIAL.towerWidth);expect(p.bottom).toBeGreaterThan(1.1);expect(p.top).toBeLessThan(height);expect(height-FINANCIAL_SIGN.windowSetback+.25).toBeLessThan(p.bottom);expect(p.frontZ).toBeGreaterThan(FINANCIAL.towerDepth/2+.0675);expect(p.frontX).toBeGreaterThan(FINANCIAL.towerWidth/2+.0675);expect(FINANCIAL_SIGN.width).toBeLessThan(FINANCIAL.towerWidth-.1);}
});
it('retains the other six building identities',()=>expect(FINANCIAL_BUILDINGS.filter(b=>!FINANCIAL_BRANDS.some(v=>v.id===b.id)).map(b=>b.name)).toEqual(['Residence','Spending & Budget','Bills & Records','Business Finance','Financial Planning','Harbor Residence']));
