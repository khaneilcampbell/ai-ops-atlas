import {FINANCIAL_BUILDINGS} from '../views/map3d/financialPlan';
import {financialBrand} from '../views/map3d/financialBrands';
import {matches} from './search';
/** Search current names and legacy aliases without registering fictitious projects or agents. */
export function financialBuildingMatches(query:string){return query.trim()?FINANCIAL_BUILDINGS.filter(b=>matches(query,b.name,financialBrand(b.id)?.legacyName,b.role,'Financial District')):[];}

export const financialBuildingAliases=(id:string)=>{const brand=financialBrand(id);return brand?[brand.legacyName]:[];};
