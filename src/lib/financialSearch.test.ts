import {it,expect} from 'vitest';
import {prioritizeExact} from './search';
import {financialBuildingAliases,financialBuildingMatches} from './financialSearch';
it('chooses the named finance building over a dashboard description match',()=>{
 const building=financialBuildingMatches('Benjaire Finance')[0];expect(building.id).toBe('business-finance');
 const rows=[{title:'Benjaire Dashboard'},{title:building.name,aliases:financialBuildingAliases(building.id)},{title:'Benjaire HQ'}];
 for(const query of ['Benjaire Finance','Business Finance','  BUSINESS   FINANCE  '])expect(prioritizeExact(rows,query)[0].title).toBe('Benjaire Finance');
 expect(prioritizeExact(rows,'Benjaire')).toEqual(rows);expect(rows[0].title).toBe('Benjaire Dashboard');
});
