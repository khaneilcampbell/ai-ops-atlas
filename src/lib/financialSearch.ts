import {FINANCIAL_BUILDINGS} from '../views/map3d/financialPlan';
import {financialBrand} from '../views/map3d/financialBrands';
import {matches} from './search';
import {BUILDING_NAMES,buildingAliases,buildingDisplayName,buildingOrganization} from '../modules/names';

const key=(id:string)=>`service:financial:${id}`;
/** A Financial District building's display name (catalog/workspace/buildings.yaml), else its map name. */
export const financialDisplayName=(b:{id:string;name:string})=>buildingDisplayName(key(b.id),b.name);
/** Search current names and legacy aliases without registering fictitious projects or agents. */
export function financialBuildingMatches(query:string){return query.trim()?FINANCIAL_BUILDINGS.filter(b=>matches(query,financialDisplayName(b),b.name,buildingOrganization(key(b.id)),...buildingAliases(key(b.id)),financialBrand(b.id)?.legacyName,...(financialBrand(b.id)?.formerNames??[]),b.role,'Financial District')):[];}

export const financialBuildingAliases=(id:string)=>{const brand=financialBrand(id);const renamed=BUILDING_NAMES[key(id)]?[brand?.name??'',...buildingAliases(key(id))].filter(Boolean):[];return brand?[...new Set([...renamed,brand.legacyName,...(brand.formerNames??[])])]:renamed;};

/** Renamed landmarks outside the Financial District (agency, marketplace, stations...), by display, organization or earlier name. */
export function landmarkMatches(query:string){return query.trim()?Object.values(BUILDING_NAMES).filter(n=>n.key.startsWith('service:')&&!n.key.startsWith('service:financial:')&&matches(query,n.displayName,n.organization,...n.formerNames)):[];}
