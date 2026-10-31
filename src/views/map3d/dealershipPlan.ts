import type {Rect} from './scene';
import type {Pt} from './roads';
import {FINANCIAL,type FinancialPlan} from './financialPlan';
export const DEALERSHIP_KEY='service:bmw-dealership';
export const DEALERSHIP={width:10,depth:8,showroomX:5,showroomZ:2.1,showroomWidth:7.6,showroomDepth:3.2,height:6.09,floorCount:4,mezzanineY:1.52,stairCount:10,aisleZ:6.5,walkX:5,walkWidth:.6,lotInset:.4} as const;
export interface DisplayCar {x:number;z:number;kind:'coupe'|'suv';color:string}
/**
 * x/z/w/d is the showroom block (building, forecourt and drive aisle); `lot` is the waterfront
 * parcel it stands on. `road` is the new street piece only; `service` is the whole drive the
 * service cars take, starting on the city street that already serves the Financial District.
 */
export interface DealershipPlan extends Rect {lot:Rect;road:Pt[];walk:Pt[];service:Pt[];drive:Pt[];promenade:Pt[];cars:DisplayCar[]}
/** The waterfront parcel east of the Financial District, continuing its street and promenade. */
export function planDealership(s:{financial?:Pick<FinancialPlan,'x'|'z'|'w'|'d'|'road'|'street'|'sidewalk'>}):DealershipPlan|undefined{
 const f=s.financial;if(!f||!f.road.length||f.street.length<2||f.sidewalk.length<2)return;
 const lot:Rect={x:f.x+f.w,z:f.z,w:DEALERSHIP.width+2*DEALERSHIP.lotInset,d:f.d};
 const x=lot.x+DEALERSHIP.lotInset,z=f.z+FINANCIAL.streetZ-DEALERSHIP.aisleZ;
 // The district street ends at its east curb; the dealership aisle continues on the same line.
 const streetEnd=f.street[0],walkEnd=f.sidewalk[f.sidewalk.length-1];
 const entry:Pt=[x+.7,z+DEALERSHIP.aisleZ],landing:Pt=[x+.4,z+7.6];
 const road:Pt[]=[streetEnd,entry];
 const walk:Pt[]=[walkEnd,[landing[0],walkEnd[1]],landing];
 const service=[...f.road,...road].filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>1e-7);
 return {x,z,w:DEALERSHIP.width,d:DEALERSHIP.depth,lot,road,walk,service,
 drive:[entry,[x+9.3,z+6.5],[x+9.3,z+2.1]],
 promenade:[landing,[x+5,z+7.6],[x+5,z+3.7]],
 cars:[{x:x+2,z:z+4.8,kind:'coupe',color:'#2163ad'},{x:x+3.5,z:z+4.8,kind:'coupe',color:'#e7e9e6'},{x:x+6.5,z:z+4.8,kind:'suv',color:'#a5abb0'},{x:x+8,z:z+4.8,kind:'suv',color:'#202b35'}]};
}

/** Upper showroom decks share the original mezzanine pitch and atrium footprint. */
export const dealershipUpperFloors=()=>Array.from({length:DEALERSHIP.floorCount-1},(_,i)=>(i+1)*DEALERSHIP.mezzanineY);
