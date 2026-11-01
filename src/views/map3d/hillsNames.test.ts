import {describe,expect,it} from 'vitest';
import {HILLS,HILLS_DISTRICT_NAME,HILLS_KEY,MANSION_INTERIOR_BUILDING,MANSION_INTERIOR_ID,MANSION_NAME,interiorDisplayName,mansionPlaque} from './hillsPlan';
import {COMMUNITY_BUILDINGS} from './hillsCommunityPlan';
import {BUILDING_INTERIORS} from '../../catalog/buildings';
import {hillsSearchResult} from '../../lib/hillsSearch';

// KC, 2026-11-01: the district is Atlas Hills and the house on its estate is Atlas Mansion.
describe('Atlas Hills and Atlas Mansion names',()=>{
 it('names the district Atlas Hills and the mansion Atlas Mansion',()=>{
  expect(HILLS_DISTRICT_NAME).toBe('Atlas Hills');
  expect(MANSION_NAME).toBe('Atlas Mansion');
 });
 it('labels the house on the map Atlas Mansion, at the mansion, and keeps the district in its title',()=>{
  const p=mansionPlaque({x:5,z:44.725});
  expect(p.name).toBe('Atlas Mansion');
  expect(p.title).toBe('Atlas Mansion · Atlas Hills · Planned community');
  expect([p.x,p.z]).toEqual([5+HILLS.mansion.x,44.725+HILLS.mansion.z]);
  expect(p.id).toBe(HILLS_KEY);expect(p.select).toBe(HILLS_KEY);
 });
 it('keeps the old ids so saved selections and the interior still open',()=>{
  expect(HILLS_KEY).toBe('service:atlas-hills');
  expect(MANSION_INTERIOR_ID).toBe('skyline-business:Atlas Hills');
  expect(BUILDING_INTERIORS[MANSION_INTERIOR_BUILDING]).toBeDefined();
 });
 it('shows Atlas Mansion inside the house and leaves other interiors alone',()=>{
  expect(interiorDisplayName(MANSION_INTERIOR_BUILDING)).toBe('Atlas Mansion');
  expect(interiorDisplayName('Wells Fargo')).toBe('Wells Fargo');
 });
 it('keeps Atlas Hills Station named for the district',()=>{
  expect(COMMUNITY_BUILDINGS.find(b=>b.id==='station')?.name).toBe('Atlas Hills Station');
  expect(COMMUNITY_BUILDINGS.some(b=>/mansion/i.test(b.name))).toBe(false);
 });
 it('finds each place by its own name in search',()=>{
  expect(hillsSearchResult('Atlas Mansion')?.title).toBe('Atlas Mansion');
  expect(hillsSearchResult('mansion')?.title).toBe('Atlas Mansion');
  expect(hillsSearchResult('Atlas Hills')?.title).toBe('Atlas Hills');
  expect(hillsSearchResult('Atlas Hills')?.aliases).toEqual(['Atlas Mansion']);
  expect(hillsSearchResult('Wells Fargo')).toBeUndefined();
  expect(hillsSearchResult('  ')).toBeUndefined();
 });
});
