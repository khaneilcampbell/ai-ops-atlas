import type {Inst} from './models';

/**
 * One scale table for the city's buildings, set against the Atlas Marketplace mall (about 12 x 11.6
 * map units and 6.4 tall: four 1.6 storeys, twice the Atlas Hills mansion). Before this, a project
 * headquarters was 1.6 wide and 4.5 tall, so next to the mall it read as a toy (KC, 2026-10-31).
 *
 * Each class keeps its own design; only its size changes, so a change here is the whole edit.
 * - Project headquarters: storeys 1.5x taller (0.32 to 0.48), so a 14-storey HQ (6.7) tops the
 *   mall's roof. Footprints stay: district traffic runs right by the plinths, and 1.1x already
 *   puts cars inside the walls.
 * - The Financial District keeps rising with the headquarters (its HQ-relative rule), so it still
 *   stands above them.
 * - Not scaled: the airport offices
 *   (2.4 x 2.8 and 3.4 to 6 tall, already at this scale) and the stadium (8 x 7, its lot sets the
 *   city layout), so their roads and lots stay where they are.
 */
export const CITY_SCALE={
 /** Project headquarters: height of one storey, and footprint, against the old 0.32 storey. */
 hq:{storey:1.5,footprint:1},
} as const;

/** Grow the parts pushed since `from` evenly about a base point (x, y, z), so a building keeps its design. */
export function scaleParts(items:Inst[],from:number,x:number,y:number,z:number,k:number){
 if(k===1)return;
 for(let i=from;i<items.length;i++){
  const it=items[i];
  items[i]={...it,p:[x+(it.p[0]-x)*k,y+(it.p[1]-y)*k,z+(it.p[2]-z)*k],s:[it.s[0]*k,it.s[1]*k,it.s[2]*k]};
 }
}


/** Mid-rise offices share the frozen Financial reference; footprints and human-scale doors stay clear. */
export function alignOfficeScale(towers:import('./scene').Tower[],reference:number){
 for(const t of towers)if(t.customHeight===undefined)t.height=Math.max(t.height,reference*.7);
}
