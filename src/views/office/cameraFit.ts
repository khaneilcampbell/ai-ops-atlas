/** Fit the complete cutaway using projected corners instead of a fixed zoom offset. */
export function cutawayCameraRadius(w:number,d:number,aspect:number,phi=1.05,theta=Math.PI/4){
  const tan=Math.tan(32*Math.PI/360),sin=Math.sin,cos=Math.cos;
  let radius=0;
  for(const x of [-w/2-0.7,w*0.65])for(const y of [-0.25,16.5])for(const z of [-d/2-0.2,d/2+2.5]){
    const py=y-8.1,pz=z-0.9;
    const depth=x*sin(phi)*sin(theta)+py*cos(phi)+pz*sin(phi)*cos(theta);
    const horizontal=x*cos(theta)-pz*sin(theta);
    const vertical=-x*cos(phi)*sin(theta)+py*sin(phi)-pz*cos(phi)*cos(theta);
    radius=Math.max(radius,Math.abs(horizontal)/(tan*Math.max(0.2,aspect))+depth,Math.abs(vertical)/tan+depth);
  }
  return radius*1.1;
}
