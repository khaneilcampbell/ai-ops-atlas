import type {GroupBy,Layout} from './mapLayout';
/** Grouping never changes district names or the city's geographic/transport plan. */
export function districtHeadings(layout:Layout,mode:GroupBy){
 if(mode==='none')return [];
 // A group left with only a vacant lot (its one tower was removed) gets no heading.
 return layout.neighborhoods.filter(n=>n.count>0);
}
/** Primary buildings share one rule; only supporting rooms/tools wait for closer zoom. */
export function mapLabelVisible(kind:'building'|'detail',near:'far'|'mid'|'near',selected=false,hovered=false,parentSelected=false){
 return kind==='building'||near==='near'||selected||hovered||parentSelected;
}
