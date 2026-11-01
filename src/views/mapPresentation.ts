import type {GroupBy,Layout} from './mapLayout';
/** Sorting changes information, never the city's geographic/transport plan. */
export function districtHeadings(layout:Layout,mode:GroupBy){
 if(mode==='none')return [];
 return layout.neighborhoods.map(n=>{
  const projects=layout.districts.filter(d=>d.group===n.key).map(d=>d.project);
  const values=mode==='status'?projects.map(p=>p.status):mode==='tag'?projects.flatMap(p=>p.tags):[];
  const counts=new Map<string,number>();for(const value of values)counts.set(value,(counts.get(value)??0)+1);
  const summary=[...counts].sort(([a,ac],[b,bc])=>bc-ac||a.localeCompare(b)).slice(0,2).map(([value,count])=>`${mode==='status'?'Declared ':'#'}${value} ${count}`).join(' · ');
  return {...n,label:summary?`${n.label} · ${summary}`:n.label};
 });
}
/** Primary buildings share one rule; only supporting rooms/tools wait for closer zoom. */
export function mapLabelVisible(kind:'building'|'detail',near:'far'|'mid'|'near',selected=false,hovered=false,parentSelected=false){
 return kind==='building'||near==='near'||selected||hovered||parentSelected;
}
