import {expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene} from "./scene";
import {FINANCIAL_MEMBERS,financialDistrictBounds} from "./financialDistrictMembership";

it("includes Circa and BMW once with unchanged selection identities",()=>{
  expect(FINANCIAL_MEMBERS.filter(b=>b.name==="Circa")).toEqual([expect.objectContaining({key:"service:financial:circa"})]);
  expect(FINANCIAL_MEMBERS.filter(b=>b.name==="BMW")).toEqual([expect.objectContaining({key:"service:bmw-dealership"})]);
  expect(new Set(FINANCIAL_MEMBERS.map(b=>b.key)).size).toBe(FINANCIAL_MEMBERS.length);
});
for(const grouping of ["none","district","status","tag"] as const)it(`frames both outer parcels in ${grouping}`,()=>{
  const scene=buildScene(layoutMap(catalog,[],grouping)), f=scene.financial!, d=scene.dealership!;
  const bounds=financialDistrictBounds(f,d);
  for(const parcel of [f,...f.circa?[f.circa]:[],d.lot]){
    expect(parcel.x).toBeGreaterThanOrEqual(bounds.x);
    expect(parcel.z).toBeGreaterThanOrEqual(bounds.z);
    expect(parcel.x+parcel.w).toBeLessThanOrEqual(bounds.x+bounds.w);
    expect(parcel.z+parcel.d).toBeLessThanOrEqual(bounds.z+bounds.d);
  }
});
