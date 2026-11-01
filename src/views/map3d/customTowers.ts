import type {Kiosk,Tower} from './scene';
import {headquartersEnvelope} from './financialPlan';
import {isRibbonTower} from './ribbonTowerPlan';

/**
 * The custom-built HQs stand with the Financial District (KC, 2026-10-31: "make the building bigger
 * to align with the size of Financial district buildings ... correlate"). Each one's roof is a share
 * of the same reference height the Financial District towers rise from, so whenever the city's
 * scale changes, both move together. The shortest Financial tower is 1.08 of that reference, so
 * a share of at most 1 keeps every Financial tower taller.
 */
export const CUSTOM_TOWER_SHARE={atlas:1,benjaire:.92} as const;
/**
 * District tool offices (Stripe, n8n, Cloudflare and the rest) stand at half that reference: a
 * mid-rise beside their headquarters, the way a support building sits by a tower, and they grow
 * with it whenever the city is rescaled. They keep the old 2.8 as a floor.
 */
export const TOOL_OFFICE_SHARE=.5;
export const toolOfficeTop=(reference:number)=>Math.max(2.8,reference*TOOL_OFFICE_SHARE);

export function customTowerShare(t:Pick<Tower,'projectId'|'identity'>){
 if(t.identity.landmark)return CUSTOM_TOWER_SHARE.atlas;
 if(isRibbonTower(t.projectId))return CUSTOM_TOWER_SHARE.benjaire;
 return 0;
}

/** Give the custom HQs their heights, from every tower's plain height (before any custom height). */
export function sizeCustomTowers(towers:Tower[],kiosks:Kiosk[]=[]){
 const reference=headquartersEnvelope(towers);
 for(const t of towers){const share=customTowerShare(t);if(share)t.customHeight=reference*share;}
 const tools=toolOfficeTop(reference);
 for(const k of kiosks)k.height=tools;
}
