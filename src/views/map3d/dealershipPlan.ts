import type {Rect} from './scene';
import type {Pt} from './roads';
import {FINANCIAL,type FinancialPlan} from './financialPlan';
import {financialDimensions} from './financialArchitecture';
export const DEALERSHIP_KEY='service:bmw-dealership';
export const DEALERSHIP={width:10,depth:8,showroomX:5,showroomZ:2.1,showroomWidth:7.6,showroomDepth:3.2,height:6.09,floorCount:4,mezzanineY:1.52,stairCount:10,aisleZ:6.5,walkX:5,walkWidth:.6,lotInset:.4} as const;
export interface DisplayCar {x:number;z:number;kind:'coupe'|'suv';color:string}
/**
 * x/z/w/d is the showroom block (building, forecourt and drive aisle); `lot` is the waterfront
 * parcel it stands on. `road` is the new street piece only; `service` is the whole drive the
 * service cars take, starting on the city street that already serves the Financial District.
 */
export interface DealershipPlan extends Rect {lot:Rect;road:Pt[];walk:Pt[];service:Pt[];drive:Pt[];promenade:Pt[];cars:DisplayCar[];showroom:Showroom}
/**
 * The showroom block, relative to the dealership's x/z. Its glass front stays on the promenade
 * line (z 3.7) so doors, sign and forecourt never move; width, depth and height come from the
 * Financial District's own towers, so BMW reads as one of them however the district changes.
 */
export interface Showroom {cx:number;cz:number;w:number;d:number;height:number;floors:number}
export const SHOWROOM_FRONT=3.7;
/** KC, 2026-10-31: BMW scales with the district: the widest tower's footprint, the shortest tower's height. */
export function dealershipShowroom(buildings:readonly {id:string;height:number}[]=[]):Showroom{
 if(!buildings.length)return {cx:DEALERSHIP.showroomX,cz:DEALERSHIP.showroomZ,w:DEALERSHIP.showroomWidth,d:DEALERSHIP.showroomDepth,height:DEALERSHIP.height,floors:DEALERSHIP.floorCount};
 const dims=buildings.map(b=>financialDimensions(b.id)),w=Math.max(...dims.map(x=>x.width)),d=Math.max(...dims.map(x=>x.depth));
 // Whole showroom storeys at the original gallery pitch, never taller than the shortest tower.
 const floors=Math.max(DEALERSHIP.floorCount,Math.floor(Math.min(...buildings.map(b=>b.height))/DEALERSHIP.mezzanineY));
 return {cx:DEALERSHIP.showroomX,cz:SHOWROOM_FRONT-d/2,w,d,height:floors*DEALERSHIP.mezzanineY,floors};
}
/** The waterfront parcel east of the Financial District, continuing its street and promenade. */
export function planDealership(s:{financial?:Pick<FinancialPlan,'x'|'z'|'w'|'d'|'road'|'street'|'sidewalk'>&Partial<Pick<FinancialPlan,'buildings'>>}):DealershipPlan|undefined{
 const f=s.financial;if(!f||!f.road.length||f.street.length<2||f.sidewalk.length<2)return;
 const lot:Rect={x:f.x+f.w,z:f.z,w:DEALERSHIP.width+2*DEALERSHIP.lotInset,d:f.d};
 const x=lot.x+DEALERSHIP.lotInset,z=f.z+FINANCIAL.streetZ-DEALERSHIP.aisleZ;
 // The district street ends at its east curb; the dealership aisle continues on the same line.
 const streetEnd=f.street[0],walkEnd=f.sidewalk[f.sidewalk.length-1];
 const entry:Pt=[x+.7,z+DEALERSHIP.aisleZ],landing:Pt=[x+.4,z+7.6];
 const road:Pt[]=[streetEnd,entry];
 const walk:Pt[]=[walkEnd,[landing[0],walkEnd[1]],landing];
 const showroom=dealershipShowroom(f.buildings),door:Pt=[x+showroom.cx+showroom.w/2+.06,z+showroom.cz];
 // East display bays sit beyond the service drive; a narrow showroom moves the drive and bays west.
 const right=door[0]-x<7.5?door[0]+1.4:x+6.5,rightGap=right===x+6.5?1.5:1.25;
 const service=[...f.road,...road].filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-7);
 return {x,z,w:DEALERSHIP.width,d:DEALERSHIP.depth,lot,road,walk,service,showroom,
 // The service drive turns down beside the showroom's east face into its side garage door.
 drive:[entry,[door[0]+.54,z+6.5],[door[0]+.54,door[1]],door],
 promenade:[landing,[x+5,z+7.6],[x+5,z+3.7]],
 cars:[{x:x+2,z:z+4.8,kind:'coupe',color:'#2163ad'},{x:x+3.5,z:z+4.8,kind:'coupe',color:'#e7e9e6'},{x:right,z:z+4.8,kind:'suv',color:'#a5abb0'},{x:right+rightGap,z:z+4.8,kind:'suv',color:'#202b35'}]};
}

/** Upper showroom decks share the original mezzanine pitch and atrium footprint. */
export const dealershipUpperFloors=(floors:number=DEALERSHIP.floorCount)=>Array.from({length:floors-1},(_,i)=>(i+1)*DEALERSHIP.mezzanineY);
