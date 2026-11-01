/**
 * Atlas road standard. One lane width, scaled once, sets every street, road bridge, highway
 * collector, ramp and highway lane in the city, so cars fit both directions everywhere.
 * World units, not operational data.
 *
 * A city street is two lanes plus a curb margin each side. The highway is one lane each way
 * either side of a median, with a shoulder and a rail beyond it. Change `scale` to make every
 * road wider or narrower together; vehicles keep their own size (`vehicleScale`).
 */
export const ROAD={scale:1,lane:.32,curb:.04,median:.1,shoulder:.13,edgeLine:.05,railGap:.08,turnExtra:.15} as const;
const r=(v:number)=>Math.round(v*ROAD.scale*1000)/1000;
const street=r(2*ROAD.lane+2*ROAD.curb),highway=r(2*(ROAD.median+ROAD.lane+ROAD.shoulder));
/** One visual scale for parked and moving road vehicles and the roads they drive on. */
export const TRANSPORT={vehicleScale:2,walkWidth:.48,landingOverlap:.08,junctionOpening:.55,
 /** Every district street, the Financial District street, Hills streets and freight city access. */
 cityWidth:street,
 /** Road bridges between districts carry the same street, edge to edge. */
 bridgeWidth:street,
 /** Centre of each city lane from the street's centre line. */
 cityLaneOffset:r(ROAD.lane/2),
 highwayWidth:highway,highwayTurnWidth:r(2*(ROAD.median+ROAD.lane+ROAD.shoulder+ROAD.turnExtra)),
 highwayLaneOffset:r(ROAD.median+ROAD.lane/2),highwayShoulder:r(ROAD.median+ROAD.lane+ROAD.edgeLine),
 highwayBarrier:r(ROAD.median+ROAD.lane+ROAD.shoulder+ROAD.railGap),
 /** Ground-level roads blend from street to highway size over this distance once they leave land. */
 streetToHighway:r(2.5),
 /** Water within this distance of the highway is the highway's approach; canals deeper in town are not. */
 highwayReach:6.5,
 displayBayWidth:.72,displayBayLength:.95,dealerAisle:.9} as const;
