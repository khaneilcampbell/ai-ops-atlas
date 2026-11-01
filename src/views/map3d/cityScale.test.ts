import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene,FLOOR_H} from "./scene";
import {CITY_SCALE,scaleParts,shopHeight} from "./cityScale";
import type {Inst} from "./models";

/** The Atlas Marketplace roof: four 1.6 storeys (twice Atlas Mansion). */
const MARKETPLACE_ROOF=4*1.6;

describe("city scale", () => {
 const s=buildScene(layoutMap(catalog,[],"district"));
 it("puts every project headquarters roof above the Marketplace roof", () => {
  expect(FLOOR_H).toBeCloseTo(.32*CITY_SCALE.hq.storey);
  for(const t of s.towers)expect(t.height,t.name).toBeGreaterThan(MARKETPLACE_ROOF);
 });
 it("grows the Skyline shops, not the tool kiosks", () => {
  const chipotle=s.retail.find(k=>k.name==="Chipotle")!,anthropic=s.retail.find(k=>k.name==="Anthropic")!;
  expect(chipotle.size).toBeCloseTo(.85*CITY_SCALE.shop);
  expect(shopHeight(anthropic)).toBeCloseTo(2.9*CITY_SCALE.shop);
  for(const k of s.kiosks)expect(k.size).toBeCloseTo(.9);
 });
 it("keeps the Skyline shops apart", () => {
  for(const a of s.retail)for(const b of s.retail)if(a!==b)
   expect(Math.abs(a.x-b.x)>(a.size+b.size)/2+.3||Math.abs(a.z-b.z)>(a.size+b.size)*.4+.3,`${a.name} / ${b.name}`).toBe(true);
 });
 it("grows a building evenly about its base", () => {
  const parts:Inst[]=[{p:[9,0,9],s:[1,1,1]},{p:[1,0,2],s:[1,2,1]},{p:[2,1,2],s:[.5,.5,.5]}];
  scaleParts(parts,1,1,0,2,2);
  expect(parts[0]).toEqual({p:[9,0,9],s:[1,1,1]});
  expect(parts[1]).toEqual({p:[1,0,2],s:[2,4,2]});
  expect(parts[2]).toEqual({p:[3,2,2],s:[1,1,1]});
 });
});
