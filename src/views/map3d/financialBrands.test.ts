import {it,expect} from 'vitest';
import {FINANCIAL_BRANDS,financialSignPlacement,FINANCIAL_SIGN} from './financialBrands';
import {FINANCIAL_BUILDINGS,FINANCIAL,financialKey} from './financialPlan';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
const stable=[['banks','Bayvale Bank',4,4,1.32],['investments','Robin Exchange',9.8,6.8,1.48],['insurance','Merrow Credit Union',-20,4,1.18]] as const;
for(const [id,name,x,z,rise]of stable)it(`brands ${id} without changing its placement or identity`,()=>{
 const b=FINANCIAL_BUILDINGS.find(b=>b.id===id)!;expect(b).toMatchObject({name,x,z,rise});expect(financialKey(id)).toBe(`service:financial:${id}`);
 const brand=FINANCIAL_BRANDS.find(b=>b.id===id)!;
 expect(BUILDING_INTERIORS[name].rooms).toEqual([...brand.rooms]);expect(BUILDING_INTERIORS[name].accent).toBe(brand.accent);expect(BUILDING_INTERIORS[brand.legacyName]).toBe(BUILDING_INTERIORS[name]);
 expect(b.purpose).not.toMatch(/unofficial/i);expect(brand.formerNames?.length).toBe(1);expect(BUILDING_INTERIORS[brand.formerNames![0]]).toBe(BUILDING_INTERIORS[name]);
});
it('keeps upper signs clear of windows, doors and structural corners',()=>{
 for(const height of [8,10,14]){const p=financialSignPlacement(height,FINANCIAL.towerDepth,FINANCIAL.towerWidth);expect(p.bottom).toBeGreaterThan(1.1);expect(p.top).toBeLessThan(height);expect(height-FINANCIAL_SIGN.windowSetback+.25).toBeLessThan(p.bottom);expect(p.frontZ).toBeGreaterThan(FINANCIAL.towerDepth/2+.0675);expect(p.frontX).toBeGreaterThan(FINANCIAL.towerWidth/2+.0675);expect(FINANCIAL_SIGN.width).toBeLessThan(FINANCIAL.towerWidth-.1);}
});
it('renames Benjaire Finance to Corvane Capital, a finance alias with its own drawn logo, in the same slot',()=>{
 const b=FINANCIAL_BUILDINGS.find(b=>b.id==='business-finance')!;expect(b).toMatchObject({name:'Corvane Capital',x:-13,z:4.2,rise:1.35});
 const brand=FINANCIAL_BRANDS.find(b=>b.id==='business-finance')!;expect(brand).toMatchObject({symbol:'emblem',signLines:['Corvane','Capital'],accent:'#1f5f5b',logoInk:'#d39a5b',formerNames:['Benjaire Finance']});
 expect(brand.ownedBrand).toBeFalsy();expect(brand.website).toBeUndefined();expect(brand.designSource).toBeUndefined();
 expect(BUILDING_INTERIORS['Business Finance']).toBe(BUILDING_INTERIORS['Corvane Capital']);expect(BUILDING_INTERIORS['Benjaire Finance']).toBe(BUILDING_INTERIORS['Corvane Capital']);
});
it('renames American Express to Ellery Budget Center, a life-management building, in the same slot',()=>{
 const b=FINANCIAL_BUILDINGS.find(b=>b.id==='budget')!;expect(b).toMatchObject({name:'Ellery Budget Center',x:14.5,z:9.5,rise:1.08,role:'Life Management Planning Analyst'});
 const brand=FINANCIAL_BRANDS.find(b=>b.id==='budget')!;expect(brand).toMatchObject({subtitle:'LIFE MANAGEMENT · PLANNED',formerNames:['American Express'],signLines:['Ellery','Budget Center']});
 expect(BUILDING_INTERIORS['American Express']).toBe(BUILDING_INTERIORS['Ellery Budget Center']);expect(BUILDING_INTERIORS['Spending & Budget']).toBe(BUILDING_INTERIORS['Ellery Budget Center']);
});
it('shows no real company names or their colours on any financial building',()=>{
 for(const brand of FINANCIAL_BRANDS){const shown=[brand.name,...brand.signLines,brand.role,brand.purpose,brand.subtitle,...brand.rooms].join(' ');expect(shown).not.toMatch(/american express|amex|benjaire|chase|wells fargo|robinhood|experian|vanguard|ritz|navy federal/i);}
 expect(FINANCIAL_BRANDS.map(b=>b.accent)).not.toContain('#006fcf');
 for(const brand of FINANCIAL_BRANDS)expect(brand.name.length).toBeLessThanOrEqual(22);
});
