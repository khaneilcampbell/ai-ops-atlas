import {describe,it,expect} from 'vitest';
import {catalog} from '../catalog';
import {layoutMap,DISTRICT_SIZE} from './mapLayout';
import {buildScene} from './map3d/scene';
import {districtRect} from './map3d/buildingExtent';

describe.each(['district','none','status','tag'] as const)('standard districts in %s grouping',group=>{
 const layout=layoutMap(catalog,[],group),scene=buildScene(layout);
 for(const d of layout.districts)it(`uses the matching land and selection class for ${d.project.id}`,()=>{
  const multiple=d.lots.length+d.kiosks.length>0||d.project.id==='github-profile';
  expect(d.size).toBe(multiple?DISTRICT_SIZE.multiple:DISTRICT_SIZE.single);
  const own=scene.terraces.find(t=>t.id===d.project.id)!;
  const selected=districtRect(scene,d.project.id)!;
  for(const k of ['x','z','w','d'] as const)expect(selected[k]).toBeCloseTo(own[k],9);
 });
});

it('keeps Portfolio land reserved when its repository is filtered out',()=>{
 const before=layoutMap(catalog,[],'district').districts.find(d=>d.project.id==='portfolio-site')!;
 const after=layoutMap({...catalog,projects:catalog.projects.filter(p=>p.id!=='portfolio-site')},[],'district');
 expect(after.districts.some(d=>d.project.id==='portfolio-site')).toBe(false);
 expect(after.parks.find(p=>p.id==='park:vacant:portfolio-site')).toMatchObject({ox:before.ox,oy:before.oy,w:before.size,h:before.size});
});
