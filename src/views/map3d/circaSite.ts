import type {Inst} from './models';
import {FINANCIAL as F,type FinancialPlan} from './financialPlan';
import {TRANSPORT} from './transportScale';
import {TERRACE_H} from './scene';

/**
 * Circa's lot west of the Financial District: its raised terrace, the street, walks, seawall and waterfront railing.
 * Shared by the map (CircaTowers) and the city drawn round Circa's interior (CityOutside), so the lobby sits on the
 * same ground in both. Items use the lifted box geometry (p is the base).
 */
export function circaSitePieces(a:FinancialPlan,green:string){
  const site:Inst[]=[],marks:Inst[]=[],lamps:Inst[]=[],s=a.circa;
  if(!s)return {site,marks,lamps,terrace:[] as Inst[]};
  const box=(t:Inst[],x:number,y:number,z:number,w:number,h:number,d:number,c:string)=>t.push({p:[a.x+x,TERRACE_H+y,a.z+z],s:[w,h,d],c});
  // Street, north walk and promenade continue west from the district.
  const x0=-s.w+.3,x1=.3,cx=(x0+x1)/2,span=x1-x0;
  box(site,cx,.025,F.streetZ,span,.035,TRANSPORT.cityWidth,'#424b50');
  box(site,cx,.04,F.northWalkZ,span,.045,.6,'#e4ddcd');
  box(site,cx,.065,F.promenadeZ,span,.045,.65,'#e4ddcd');
  for(let x=x0+.5;x<x1-.3;x+=.7)box(marks,x,.067,F.streetZ,.32,.006,.025,'#e5dfc9');
  for(const z of [F.streetZ-TRANSPORT.cityWidth/2-.04,F.streetZ+TRANSPORT.cityWidth/2+.04])box(site,cx,.055,z,span,.055,.07,'#cfcbbd');
  box(site,x0+.05,.055,F.streetZ,.08,.12,TRANSPORT.cityWidth+.16,'#cfcbbd');
  // Seawall along the highway side and the north edge; waterfront railing on the south.
  box(site,-s.w+.18,0,s.d/2,.18,.35,s.d-.4,'#c6c3b4');
  box(site,-s.w/2,0,.18,s.w,.35,.18,'#c6c3b4');
  box(site,-s.w/2,0,s.d-.18,s.w,.23,.16,'#c6c3b4');box(site,-s.w/2,.5,s.d-.18,s.w,.035,.035,green);
  for(let x=-s.w+.4;x<0;x+=.5)box(site,x,.23,s.d-.18,.025,.27,.025,green);
  for(let x=-s.w+1;x<-.5;x+=2.5){box(site,x,.02,14.5,.05,.28,.05,green);box(lamps,x,.3,14.5,.07,.05,.07,'#ffffff');}
  return {site,marks,lamps,terrace:[{p:[s.x+s.w/2,0,s.z+s.d/2],s:[s.w,TERRACE_H,s.d]} as Inst]};
}

/** The Financial District's own raised parcel (drawn by FinancialDistrict on the map). */
export const financialTerrace=(a:FinancialPlan):Inst=>({p:[a.x+a.w/2,0,a.z+a.d/2],s:[a.w,TERRACE_H,a.d]});
