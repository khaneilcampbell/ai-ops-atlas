import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog";
import {layoutMap} from "../mapLayout";
import {buildScene,FLOOR_H} from "./scene";
import {CITY_SCALE,scaleParts} from "./cityScale";
import type {Inst} from "./models";

/** The Atlas Marketplace roof: four 1.6 storeys (twice the Atlas Hills mansion). */
const MARKETPLACE_ROOF=4*1.6;

describe("city scale", () => {
 const s=buildScene(layoutMap(catalog,[],"district"));
 it("puts every project headquarters roof above the Marketplace roof", () => {
  expect(FLOOR_H).toBeCloseTo(.32*CITY_SCALE.hq.storey);
  for(const t of s.towers)expect(t.height,t.name).toBeGreaterThan(MARKETPLACE_ROOF);
 });
 it("keeps the tool kiosks at their own size", () => {
  // Commerce's tool offices are teardrop siblings of its tower and take their whole lot (commerceAnnexPlan).
  for(const k of s.kiosks)if(k.projectId!=="commerce-pipeline")expect(k.size).toBeCloseTo(.9);
 });
 it("grows a building evenly about its base", () => {
  const parts:Inst[]=[{p:[9,0,9],s:[1,1,1]},{p:[1,0,2],s:[1,2,1]},{p:[2,1,2],s:[.5,.5,.5]}];
  scaleParts(parts,1,1,0,2,2);
  expect(parts[0]).toEqual({p:[9,0,9],s:[1,1,1]});
  expect(parts[1]).toEqual({p:[1,0,2],s:[2,4,2]});
  expect(parts[2]).toEqual({p:[3,2,2],s:[1,1,1]});
 });
});
