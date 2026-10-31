import {describe,expect,it} from "vitest";
import {catalog} from "../../catalog";
import {buildConnections} from "../../lib/connections";
import {layoutMap} from "../mapLayout";
import {buildScene} from "./scene";
import {skylineProjectAnchor} from "./landmarks";

describe("Skyline project connection",()=>{
  it("anchors its declared GitHub connection to Atlas at the existing complex in every grouping",()=>{
    const link=buildConnections(catalog,{}).find(l=>l.id==="sync:skyline");
    expect(link).toMatchObject({source:{kind:"project",id:"skyline"},target:{kind:"project",id:"ai-ops-atlas"},type:"github",status:"unknown"});
    for(const group of ["none","district","status","tag"] as const){
      const scene=buildScene(layoutMap(catalog,[],group));
      const anchor=skylineProjectAnchor(scene)!;
      const park=scene.parks.find(p=>p.label==="Skyline")!;
      expect(anchor).toMatchObject({project:"skyline",x:park.x+park.w/2,z:park.z+park.d/2});
      expect(scene.towers.some(t=>t.projectId==="ai-ops-atlas")).toBe(true);
      expect(scene.towers.some(t=>t.projectId==="skyline")).toBe(false);
    }
  });
});
