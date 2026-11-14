import {goldJetRide} from './goldJetIds';

/**
 * Riding the Atlas yacht: while "Enter yacht" is open the map keeps drawing and its camera rides with the yacht, looking
 * into her decks from the starboard side (or out from the sun deck). Kept free of heavy imports, like goldJetIds, so the
 * map and the overlay can share it. `view` is a deck (0 lower to 3 sun), -1 for all decks, or 'sundeck'.
 */
export type YachtView=-1|0|1|2|3|'sundeck';
export const yachtRide={active:false,view:-1 as YachtView,yaw:0,pitch:0,zoom:1};

/** True while the map camera rides in a vehicle (the gold jet or the yacht) and the map's own controls stand aside. */
export const riding=()=>goldJetRide.active||yachtRide.active;
