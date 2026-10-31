import type {Inst} from './models';
import {toolOfficeHeight} from './toolBrand';

/**
 * One scale table for the city's buildings, set against the Atlas Marketplace mall (about 12 x 11.6
 * map units and 6.4 tall: four 1.6 storeys, twice the Atlas Hills mansion). Before this, a project
 * headquarters was 1.6 wide and 4.5 tall and a Skyline shop 0.85 wide, so next to the mall they read
 * as toys (KC, 2026-10-31).
 *
 * Each class keeps its own design; only its size changes, so a change here is the whole edit.
 * - Project headquarters: storeys 1.5x taller (0.32 to 0.48), so a 14-storey HQ (6.7) tops the
 *   mall's roof. Footprints stay: district traffic runs right by the plinths, and 1.1x already
 *   puts cars inside the walls.
 * - Skyline shops (1.3x) and the Skyline residence (1.35x): the whole building grows evenly (doors,
 *   windows, signs). 1.4x shops push the highway ramps off their route in the 'none' and 'status' maps.
 * - The Financial District keeps rising with the headquarters (its HQ-relative rule), so it still
 *   stands above them.
 * - Not scaled: the airport offices
 *   (2.4 x 2.8 and 3.4 to 6 tall, already at this scale) and the stadium (8 x 7, its lot sets the
 *   city layout), so their roads and lots stay where they are.
 */
export const CITY_SCALE={
 /** Project headquarters: height of one storey, and footprint, against the old 0.32 storey. */
 hq:{storey:1.5,footprint:1},
 /** Skyline tenants (Anthropic, OpenAI, Zara, Wells Fargo, Smashburger, Starbucks, Chipotle). */
 shop:1.3,
 /** The Skyline residence in the middle of the park. */
 skyline:1.35,
} as const;

/** Grow the parts pushed since `from` evenly about a base point (x, y, z), so a building keeps its design. */
export function scaleParts(items:Inst[],from:number,x:number,y:number,z:number,k:number){
 if(k===1)return;
 for(let i=from;i<items.length;i++){
  const it=items[i];
  items[i]={...it,p:[x+(it.p[0]-x)*k,y+(it.p[1]-y)*k,z+(it.p[2]-z)*k],s:[it.s[0]*k,it.s[1]*k,it.s[2]*k]};
 }
}

/** Skyline tenants are the `retail:` buildings; tool kiosks inside the districts keep their size. */
export const shopScale=(b:{key:string})=>b.key.startsWith('retail:')?CITY_SCALE.shop:1;
/** A shop's or kiosk's roof height above the terrace, after scaling. */
export const shopHeight=(b:{key:string;name:string})=>toolOfficeHeight(b.name)*shopScale(b);
