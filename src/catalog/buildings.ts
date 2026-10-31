import {financialBrand,FINANCIAL_BRANDS} from "../views/map3d/financialBrands";
import {FINANCIAL_BUILDINGS} from "../views/map3d/financialPlan";
import {AIRPORT_BUILDINGS} from "../views/map3d/airportBuildings";
/** Shared building identity for the inspector and its prepared interior spaces. */
export const BUILDING_INTERIORS:Record<string,{accent:string;subtitle:string;rooms:string[]}>={
  "Atlas Hills":{accent:"#d0ad69",subtitle:"PRIVATE ESTATE · PLANNED",rooms:["Living lounge","Dining room","Guest suite","Upstairs study"]},
  Anthropic:{accent:"#bd7658",subtitle:"RESEARCH & SAFETY",rooms:["Research lab","Safety evaluation","Model development","Research review"]},
  OpenAI:{accent:"#16866d",subtitle:"APPLIED AI & ENGINEERING",rooms:["Model engineering","Product studio","Evaluation lab","Operations center"]},
  Starbucks:{accent:"#00754a",subtitle:"COFFEEHOUSE & HOSPITALITY",rooms:["Coffee bar","Guest lounge","Barista training","Hospitality planning"]},
  Smashburger:{accent:"#bf292b",subtitle:"RESTAURANT OPERATIONS",rooms:["Kitchen & preparation","Guest dining","Order coordination","Restaurant planning"]},
  Chipotle:{accent:"#93432f",subtitle:"KITCHEN & GUEST EXPERIENCE",rooms:["Food preparation","Guest dining","Order coordination","Team training"]},
  Zara:{accent:"#242424",subtitle:"FASHION & RETAIL",rooms:["Design studio","Collection showroom","Merchandising","Retail operations"]},
  Canva:{accent:"#00aeb8",subtitle:"DESIGN & CREATIVE PRODUCTION",rooms:["Brand studio","Design production","Creative review","Publishing coordination"]},
  Stripe:{accent:"#635bff",subtitle:"PAYMENTS INFRASTRUCTURE",rooms:["Payment operations","Billing coordination","Risk review","Integration studio"]},
  "Wells Fargo":{accent:"#a71d30",subtitle:"BANKING & FINANCIAL OPERATIONS",rooms:["Client advisory","Accounts & payments","Risk review","Financial operations"]},
};

for(const b of FINANCIAL_BUILDINGS){const brand=financialBrand(b.id);BUILDING_INTERIORS[b.name]={accent:brand?.accent??"#84b8bf",subtitle:brand?.subtitle??"FINANCIAL DISTRICT · PLANNED",rooms:brand?[...brand.rooms]:["Reception & records","Private review","Planning lounge",`${b.role} study`]};}
// Keep pre-brand interior routes usable without changing stable building IDs.
for(const brand of FINANCIAL_BRANDS)BUILDING_INTERIORS[brand.legacyName]=BUILDING_INTERIORS[brand.name];

for(const b of AIRPORT_BUILDINGS)BUILDING_INTERIORS[b.name]={accent:"#83bed2",subtitle:b.agent.toUpperCase(),rooms:[...b.rooms]};

export const SKYLINE_BUILDING_PREFIX="skyline:building:";
export const skylineBuildingId=(name:string)=>`${SKYLINE_BUILDING_PREFIX}${name}`;
export const skylineBuildingKey=(name:string)=>`service:${skylineBuildingId(name)}`;
export function skylineBuildingName(id:string):string|undefined {
  if(!id.startsWith(SKYLINE_BUILDING_PREFIX))return undefined;
  const name=id.slice(SKYLINE_BUILDING_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(BUILDING_INTERIORS,name)?name:undefined;
}
