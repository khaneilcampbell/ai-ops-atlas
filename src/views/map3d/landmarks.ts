import {TERRACE_H,type Scene3D} from "./scene";

/** The custom Skyline complex is the visual home of its registered project. */
export function skylineProjectAnchor(scene:Scene3D) {
  const park=scene.parks.find(p=>p.label==="Skyline");
  return park?{x:park.x+park.w/2,z:park.z+park.d/2,y0:TERRACE_H,y1:TERRACE_H+4.93,w:3.5,d:1.1,project:"skyline"}:undefined;
}
