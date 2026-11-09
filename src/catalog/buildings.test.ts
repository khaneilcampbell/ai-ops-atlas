import {expect,it} from "vitest";
import {BUILDING_INTERIORS} from "./buildings";
import {WORKPLACE_BUILDINGS} from "./workplaces";

it("has no interiors left for the removed Skyline shops",()=>{
  for(const name of ["Reasoning Lab","Model Lab","Starbucks","Smashburger","Chipotle","Zara","Halden Branch"])expect(BUILDING_INTERIORS[name],name).toBeUndefined();
  expect(WORKPLACE_BUILDINGS).toEqual(["Atlas Marketplace","Benjaire Marketing Agency"]);
});
