import {financialBrand,FINANCIAL_BRANDS,financialInteriorKey} from "../views/map3d/financialBrands";
import {FINANCIAL_BUILDINGS} from "../views/map3d/financialPlan";
import {AIRPORT_BUILDINGS} from "../views/map3d/airportBuildings";
/** Shared building identity for the inspector and its prepared interior spaces. */
export const BUILDING_INTERIORS:Record<string,{accent:string;subtitle:string;rooms:string[]}>={
  "Atlas Hills":{accent:"#d0ad69",subtitle:"PRIVATE ESTATE · PLANNED",rooms:["Living lounge","Dining room","Guest suite","Upstairs study"]},
  "Design Studio":{accent:"#00aeb8",subtitle:"DESIGN & CREATIVE PRODUCTION",rooms:["Brand studio","Design production","Creative review","Publishing coordination"]},
  "Payments Office":{accent:"#635bff",subtitle:"PAYMENTS INFRASTRUCTURE",rooms:["Payment operations","Billing coordination","Risk review","Integration studio"]},
};

for(const b of FINANCIAL_BUILDINGS){const brand=financialBrand(b.id);BUILDING_INTERIORS[financialInteriorKey(b.id)]={accent:brand?.accent??"#84b8bf",subtitle:brand?.subtitle??"FINANCIAL DISTRICT · PLANNED",rooms:brand?[...brand.rooms]:["Reception & records","Private review","Planning lounge",`${b.role} study`]};BUILDING_INTERIORS[b.name]=BUILDING_INTERIORS[financialInteriorKey(b.id)];}
// Keep pre-brand interior routes usable without changing stable building IDs.
for(const brand of FINANCIAL_BRANDS){const interior=BUILDING_INTERIORS[financialInteriorKey(brand.id)];for(const name of [brand.legacyName,brand.name,...(brand.formerNames??[])])BUILDING_INTERIORS[name]=interior;}

for(const b of AIRPORT_BUILDINGS)BUILDING_INTERIORS[b.name]={accent:"#83bed2",subtitle:b.agent.toUpperCase(),rooms:[...b.rooms]};

