/** Airport-local, non-overlapping building parcels; ownership roles are prepared, not live jobs. */
/** Airport storeys are 1.5x the old 0.32-unit floor, the same rule the city uses for its headquarters
 * (CITY_SCALE.hq.storey), so the campus stands with the Financial District, the Marketplace and the
 * Marketing Agency (KC, 2026-10-31). Footprints and the airfield stay put; only heights grow. */
export const AIRPORT_STOREY_SCALE=1.5;
// Passenger Services, Logistics and Administration were removed from the north row (KC, 2026-11-08);
// Operations stays as the one airport office.
const PARCELS=[
 {id:'terminal',name:'Atlas · Terminal',agent:'Airport Operations Coordinator',x:1.5,z:6,w:3.8,d:10.5,h:2.6,kind:'terminal',rooms:['Check-in operations','Passenger lounge','Gate coordination','Terminal review']},
 {id:'tower',name:'Atlas · Air Traffic',agent:'Airfield Safety Coordinator',x:1.5,z:-3,w:1.5,d:1.4,h:4.95,kind:'tower',rooms:['Tower consoles','Airfield review','Traffic planning','Safety briefing']},
 // Cargo (home of the Model Intelligence Lab) stands on the open lot between the north service road, the
 // landside street, the taxiway and the north remote stand (Khaneil, 2026-11-13), off the old runway-side strip.
 {id:'cargo',name:'Atlas · Cargo',agent:'Cargo Logistics Coordinator',x:8.5,z:-10.5,w:4,d:3,h:2.1,kind:'hangar',rooms:['Cargo staging','Freight planning','Service coordination','Shipment review']},
 {id:'operations',name:'Atlas · Operations',agent:'Airport Systems Analyst',x:.3,z:-12,w:2.4,d:2.8,h:4.2,kind:'office',rooms:['Systems desk','Operations review','Infrastructure planning','Briefing room']},
] as const;
export const AIRPORT_BUILDINGS=PARCELS.map(b=>({...b,h:Math.round(b.h*AIRPORT_STOREY_SCALE*100)/100}));
export const airportBuildingKey=(id:string)=>`service:airport-building:${id}`;
export function airportBuilding(id:string){return AIRPORT_BUILDINGS.find(b=>b.id===id);}
export function airportAnimationEnabled(moving:boolean,saver:boolean,visible:boolean){return moving&&!saver&&visible;}
