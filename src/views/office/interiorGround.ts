import {TERRACE_H} from "../map3d/scene";

/** Thickness of the interior floor slab (its top is y 0). */
export const INTERIOR_SLAB=.3;
/**
 * How far the city drawn round an interior is lowered, so the map's raised terrace (TERRACE_H on the map) lands at the
 * interior's floor. Most buildings keep the old 0.35 drop. A grounded building (Circa) drops by exactly its slab, so the
 * terrace and street meet the bottom of the lobby slab with no gap. Upper floors add their elevation.
 */
export function cityDrop(scale:number,elevation=0,grounded=false){return TERRACE_H*scale+(grounded?INTERIOR_SLAB:.35)+elevation;}
