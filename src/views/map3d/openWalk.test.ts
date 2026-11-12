import {expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {openWalk} from './connectionGeometry';
import {roadIntersections} from './highway';
import {planGalleriaLife} from './galleriaLifePlan';
import {TRANSPORT} from './transportScale';
import type {Pt} from './roads';

// Khaneil, 2026-11-08: a raised walk stood across the road and pavement like a wall.
for(const g of ['district','status','tag','none'] as GroupBy[])it(`opens every station walk where a road or the Galleria's driveway crosses it: ${g}`,()=>{
 const s=buildScene(layoutMap(catalog,[],g)),life=planGalleriaLife(s);
 const roads:Pt[][]=[...s.transportConnections.map(c=>c.road),...(life?.driveways??[]).map(d=>[d.a,d.b])],radius=TRANSPORT.cityWidth/2+.06;
 let crossings=0;
 for(const st of s.communityRail?.loop?.stops??[])for(let i=1;i<st.walk.length;i++){
  const p=st.walk[i-1],q=st.walk[i];if(p[1]!==0||q[1]!==0)continue;
  const a:Pt=[p[0],p[2]],b:Pt=[q[0],q[2]],pieces=openWalk(a,b,TRANSPORT.walkWidth,.075,.03,'#e3dfd2',roads,radius,0);
  for(const x of roads.flatMap(r=>roadIntersections(r,[a,b]))){crossings++;
   // No remaining piece of walk covers the crossing: each piece's ends stay outside the opening.
   for(const w of pieces){const half=w.s[2]/2,dx=Math.sin(w.r??0),dz=Math.cos(w.r??0),along=(x[0]-w.p[0])*dx+(x[1]-w.p[2])*dz,across=Math.abs((x[0]-w.p[0])*dz-(x[1]-w.p[2])*dx);
    if(across<radius-.01)expect(Math.abs(along)).toBeGreaterThan(half);}
  }
 }
 if(g==='district')expect(crossings).toBeGreaterThan(0);
});
