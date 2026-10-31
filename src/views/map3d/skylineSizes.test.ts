import {describe,expect,it} from 'vitest';
import {MALL} from './mallPlan';
import {SKYLINE_BUILDING_TYPES,SKYLINE_TYPES,skylineBuildingHeight,skylineBuildingSize} from './skylineSizes';
import {TOOL_OFFICE_HEIGHT,toolOfficeHeight} from './toolBrand';
import {WORKPLACE_BUILDINGS} from '../../catalog/workplaces';
import {buildScene} from './scene';
import {layoutMap} from '../mapLayout';
import {catalog} from '../../catalog';

describe('Skyline building sizes follow the Atlas Marketplace',()=>{
 it('gives every Skyline building a type',()=>{
  for(const name of WORKPLACE_BUILDINGS)expect(SKYLINE_BUILDING_TYPES[name]).toBeDefined();
 });
 it('builds every height from whole Marketplace floors',()=>{
  for(const name of Object.keys(SKYLINE_BUILDING_TYPES)){
   const storeys=skylineBuildingHeight(name)!/MALL.floor;
   expect(Math.abs(storeys-Math.round(storeys))).toBeLessThan(1e-9);
   expect(toolOfficeHeight(name)).toBe(skylineBuildingHeight(name));
  }
  expect(skylineBuildingHeight('Starbucks')).toBeCloseTo(MALL.floor);
  expect(skylineBuildingHeight('Zara')).toBeCloseTo(2*MALL.floor);
  expect(skylineBuildingHeight('Anthropic')).toBeCloseTo(MALL.levels*MALL.floor);
 });
 it('gives buildings of one type one size, and ranks types like the Marketplace',()=>{
  const {office,shop,bank,restaurant}=SKYLINE_TYPES;
  expect(office.storeys).toBeGreaterThan(shop.storeys);
  expect(shop.storeys).toBeGreaterThan(restaurant.storeys);
  expect(bank.size).toBeGreaterThanOrEqual(restaurant.size);
  expect(skylineBuildingSize('Smashburger')).toBe(skylineBuildingSize('Chipotle'));
  expect(skylineBuildingSize('Anthropic')).toBe(skylineBuildingSize('OpenAI'));
 });
 it('leaves offices that are not Skyline tenants at the standard height',()=>{
  expect(toolOfficeHeight('Canva')).toBe(TOOL_OFFICE_HEIGHT);
  expect(skylineBuildingSize('Canva')).toBeUndefined();
 });
 it('places each Skyline building on the map at its type size',()=>{
  const scene=buildScene(layoutMap(catalog));
  const park=scene.parks.find(p=>p.label==='Skyline')!;
  for(const shop of scene.retail.filter(k=>k.projectId===park.id))expect(shop.size).toBe(skylineBuildingSize(shop.name));
 });
});
