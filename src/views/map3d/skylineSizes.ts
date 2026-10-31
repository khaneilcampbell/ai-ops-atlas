import {MALL} from './mallPlan';

/** The kind of space each Skyline building is, matched to the Atlas Marketplace space of the same kind. */
export type SkylineBuildingType='office'|'shop'|'restaurant'|'bank';

/**
 * Skyline building sizes, taken from the Atlas Marketplace so the two read at one scale.
 * A storey is one Marketplace floor (MALL.floor). Widths are the frontage of a Marketplace unit
 * of that kind on the map: about 1.8 for a ground-floor shop or service unit, about 1.6 for a
 * food-court bay. Depth stays at 0.8 of the width, as the map draws every Skyline building.
 */
export const SKYLINE_TYPES:Record<SkylineBuildingType,{storeys:number;size:number;marketplace:string}>={
 restaurant:{storeys:1,size:1.6,marketplace:'Food court: one floor, one bay wide'},
 bank:{storeys:1,size:1.8,marketplace:'Ground-floor client services unit'},
 shop:{storeys:2,size:1.8,marketplace:'Shop unit on the ground floor and Floor 1'},
 office:{storeys:MALL.levels,size:2,marketplace:'Full Marketplace height, studio floors included'},
};

export const SKYLINE_BUILDING_TYPES:Record<string,SkylineBuildingType>={
 Anthropic:'office',OpenAI:'office',
 Zara:'shop',
 'Wells Fargo':'bank',
 Starbucks:'restaurant',Smashburger:'restaurant',Chipotle:'restaurant',
};

export function skylineBuildingType(name:string):SkylineBuildingType|undefined{return SKYLINE_BUILDING_TYPES[name];}
/** Footprint width on the map, or undefined for buildings that are not Skyline tenants. */
export function skylineBuildingSize(name:string):number|undefined{const t=skylineBuildingType(name);return t&&SKYLINE_TYPES[t].size;}
/** Wall height on the map: whole Marketplace floors. */
export function skylineBuildingHeight(name:string):number|undefined{const t=skylineBuildingType(name);return t&&SKYLINE_TYPES[t].storeys*MALL.floor;}
