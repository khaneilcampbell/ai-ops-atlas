import {expect,it} from 'vitest';
import {catalog} from '../catalog';
import {layoutMap,type GroupBy} from './mapLayout';
import {districtHeadings,mapLabelVisible} from './mapPresentation';
it('changes headings without moving or mutating district geometry',()=>{
 const layout=layoutMap(catalog,[],'district'),before=JSON.stringify(layout);
 for(const mode of ['none','district','status','tag'] as GroupBy[]){
  const headings=districtHeadings(layout,mode);
  if(mode==='none')expect(headings).toEqual([]);
  else for(const h of headings){const original=layout.neighborhoods.find(n=>n.key===h.key)!;expect(h).toMatchObject({ox:original.ox,oy:original.oy,w:original.w,h:original.h});expect(h.label).toBe(original.label);}
  expect(JSON.stringify(layout)).toBe(before);
 }
 expect(districtHeadings(layout,'status')).toEqual(districtHeadings(layout,'tag'));
});
it('shows every primary building at the same zoom level and reveals supporting detail consistently',()=>{
 for(const distance of ['far','mid','near'] as const){
  expect(mapLabelVisible('building',distance)).toBe(true);
  expect(mapLabelVisible('detail',distance)).toBe(distance==='near');
  expect(mapLabelVisible('detail',distance,true)).toBe(true);
  expect(mapLabelVisible('detail',distance,false,true)).toBe(true);
  expect(mapLabelVisible('detail',distance,false,false,true)).toBe(true);
 }
});
