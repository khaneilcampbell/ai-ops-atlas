/** Proposed workspace links, never new agents or changes to their execution authority. */
export const MARKETPLACE_WORKSPACES = [
 {unitId:'L1-U1',agentId:'commerce-loop',role:'Production coordination',deliverable:'Product brief, milestones and approval checklist'},
 {unitId:'L1-U2',agentId:'market-analyst',role:'Product research',deliverable:'Evidence-backed audience and opportunity brief'},
 {unitId:'L1-U3',agentId:'brand-strategist',role:'Product design',deliverable:'Design specification and development handoff'},
 {unitId:'L1-U4',agentId:'copy-strategist',role:'Brand copy and SEO',deliverable:'Draft product copy and metadata'},
 {unitId:'L1-U5',agentId:'canva-mockups',role:'Visual production',deliverable:'Approved asset brief and visual draft references'},
 {unitId:'L1-U6',agentId:'commerce-tests',role:'Quality and release review',deliverable:'Validation evidence and release recommendation'},
] as const;
export const marketplaceWorkspace=(unitId:string)=>MARKETPLACE_WORKSPACES.find(w=>w.unitId===unitId);
