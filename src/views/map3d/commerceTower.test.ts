import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,DISTRICT_MIN_SIZE,DISTRICT_HQ_SHARE,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {towerTop} from './models';
import {isRibbonTower} from './ribbonTowerPlan';
import {plazaRings} from './streetGraph';
import {TRANSPORT} from './transportScale';
import {COMMERCE,commerceScale,crownTrees,footprint,isCommerceTower,planAt,podiumHeight,podiumRing,podiumStorey,poolRing,ribbonWindow,roofShare,roofTrees,signedArea,teardrop,twistAt} from './commerceTowerPlan';
import {commerceGeometry,commerceTriangles} from './commerceTowerGeometry';

const GROUPINGS:GroupBy[]=['none','district','status','tag'];
const inside=(p:[number,number],poly:[number,number][])=>{let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,zi]=poly[i],[xj,zj]=poly[j];if((zi>p[1])!==(zj>p[1])&&p[0]<(xj-xi)*(p[1]-zi)/(zj-zi)+xi)c=!c;}return c;};

describe('Commerce Pipeline teardrop tower',()=>{
 it('is Commerce Pipeline only, at the size its widened district gives it',()=>{
  expect(isCommerceTower('commerce-pipeline')).toBe(true);expect(isCommerceTower('benjaire-site')).toBe(false);
  for(const grouping of GROUPINGS){
   const scene=buildScene(layoutMap(catalog,[],grouping)),t=scene.towers.find(t=>isCommerceTower(t.projectId))!;
   expect(t.name).toBe('Product & Growth Tower');expect(t.size).toBeCloseTo(DISTRICT_MIN_SIZE[COMMERCE.projectId]*DISTRICT_HQ_SHARE[COMMERCE.projectId]*.92,3);expect(t.size).toBeGreaterThan(COMMERCE.refSize);
  }
 });
 it('widens the Commerce district where it stands, so Benjaire HQ keeps its place',()=>{
  expect(DISTRICT_MIN_SIZE['commerce-pipeline']).toBe(10);
  for(const grouping of GROUPINGS){
   const L=layoutMap(catalog,[],grouping),c=L.districts.find(d=>d.project.id==='commerce-pipeline')!,b=L.districts.find(d=>d.project.id==='benjaire-site')!;
   expect(c.size).toBe(10);
   // Where the two share a neighborhood, Benjaire HQ still comes first, the Commerce district beside or below it.
   if(b.group===c.group)expect(b.ox+b.size<=c.ox||b.oy+b.size<=c.oy,grouping).toBe(true);
   // No district overlaps another, and each keeps a street's gap.
   for(const d of L.districts)for(const e of L.districts)if(d!==e){
    const apart=d.ox+d.size<=e.ox||e.ox+e.size<=d.ox||d.oy+d.size<=e.oy||e.oy+e.size<=d.oy;expect(apart,`${d.project.id} / ${e.project.id}`).toBe(true);
   }
  }
 });
 it('draws a true teardrop that twists in an S as it rises',()=>{
  const plan=teardrop();expect(plan).toHaveLength(COMMERCE.ring);expect(signedArea(plan)).toBeLessThan(0);
  // Round at one end, a soft point at the other: wider than it is tall across its axis, longer than wide.
  const xs=plan.map(p=>p[0]),zs=plan.map(p=>p[1]);
  expect(Math.max(...xs)-Math.min(...xs)).toBeGreaterThan(1.4*(Math.max(...zs)-Math.min(...zs)));
  expect(twistAt(0)).toBe(0);expect(twistAt(1)).toBeCloseTo(COMMERCE.twist);
  // Eased: slow at the base and crown, fastest through the middle.
  expect(twistAt(.5)-twistAt(.4)).toBeGreaterThan(twistAt(.1)-twistAt(0));
  for(const t of [0,.5,1])expect(signedArea(planAt(t))).toBeLessThan(0);
  // The gold ribbon winds round the plan as it rises.
  expect(ribbonWindow(.25)[0]).not.toBe(ribbonWindow(.75)[0]);
  // The roof is cut on a slope, highest at the point (index 0).
  expect(roofShare(0)).toBe(1);expect(roofShare(COMMERCE.ring/2)).toBeCloseTo(1-COMMERCE.slope);
 });
 it('stays on its plinth, so the plaza, tool offices, roads and links stay put',()=>{
  for(const k of [.8,1,1.2])for(const [x,z] of footprint(k)){expect(Math.abs(x)).toBeLessThanOrEqual(COMMERCE.plinth*k);expect(Math.abs(z)).toBeLessThanOrEqual(COMMERCE.plinth*k);}
  for(const grouping of GROUPINGS){
   const scene=buildScene(layoutMap(catalog,[],grouping)),t=scene.towers.find(t=>isCommerceTower(t.projectId))!;
   for(const kiosk of scene.kiosks.filter(k=>k.projectId===t.projectId)){
    const gap=Math.max(Math.abs(kiosk.x-t.x),Math.abs(kiosk.z-t.z))-kiosk.size/2;expect(gap).toBeGreaterThan(COMMERCE.plinth);
   }
  }
 });
 it('runs its street ring just outside the plinth, and no street crosses the building (option A, 2026-11-24)',()=>{
  for(const grouping of GROUPINGS){
   const scene=buildScene(layoutMap(catalog,[],grouping)),t=scene.towers.find(t=>isCommerceTower(t.projectId))!,ring=plazaRings(scene).get(t.projectId)!;
   const rim=COMMERCE.plinth*commerceScale(t.size),inner=Math.min(t.x-ring.x0,ring.x1-t.x,t.z-ring.z0,ring.z1-t.z)-TRANSPORT.cityWidth/2;
   expect(inner,grouping).toBeGreaterThan(rim);
   // Every road and bridge road keeps its carriageway off the plinth.
   const roads=[...scene.transportConnections.map(c=>c.road),...scene.carBridges.flatMap(b=>b.roads)];
   for(const r of roads)for(let i=1;i<r.length;i++){const [a,b]=[r[i-1],r[i]],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.05);
    for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;expect(Math.max(Math.abs(x-t.x),Math.abs(z-t.z))-TRANSPORT.cityWidth/2,`${grouping} road at ${x.toFixed(2)},${z.toFixed(2)}`).toBeGreaterThan(rim);}}
  }
 });
 it('keeps the pool and the olive trees on the podium roof, clear of the tower',()=>{
  const tower=planAt(0,1,COMMERCE.finDepth);
  for(const p of poolRing())expect(inside(p,tower)).toBe(false);
  const trees=roofTrees();expect(trees.length).toBeGreaterThanOrEqual(4);
  for(const tr of trees){expect(inside([tr.x,tr.z],tower)).toBe(false);expect(tr.y).toBeCloseTo(podiumHeight());}
 });
 it('stands with the headquarters: under Benjaire HQ, Atlas HQ and the Financial District\'s tallest towers',()=>{
  for(const grouping of GROUPINGS){
   const scene=buildScene(layoutMap(catalog,[],grouping)),c=scene.towers.find(t=>isCommerceTower(t.projectId))!;
   const b=scene.towers.find(t=>isRibbonTower(t.projectId))!,atlas=scene.towers.find(t=>t.identity.landmark)!;
   expect(towerTop(c)).toBeLessThan(towerTop(b));expect(towerTop(c)).toBeLessThan(towerTop(atlas));
   for(const k of scene.kiosks)expect(k.height!).toBeLessThan(c.customHeight!);
   if(scene.financial)expect(Math.max(...scene.financial.buildings.filter(f=>f.id!=='circa').map(f=>f.height))).toBeGreaterThan(towerTop(c));
  }
 });
 it('steps its podium back as it rises, with the pool and roof garden on the top storey (Business District pass, 2026-11-25)',()=>{
  const F=COMMERCE.podium.floors.length;
  expect(podiumStorey(0)).toEqual(podiumRing());
  for(let l=1;l<F;l++){const lower=podiumStorey(l-1),upper=podiumStorey(l);for(const p of upper)expect(inside(p,lower)||lower.some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-9)).toBe(true);}
  expect(COMMERCE.podium.setback[F-1]).toBeGreaterThan(COMMERCE.podium.setback[0]);
  const top=podiumStorey(F-1);for(const p of poolRing())expect(inside(p,top)).toBe(true);
  for(const tr of roofTrees())expect(inside([tr.x,tr.z],top)).toBe(true);
  // The roof garden stands on the tower's sloped roof, inside its outline.
  const H=COMMERCE.height,trees=crownTrees(1,H),roof=planAt(1);expect(trees.length).toBeGreaterThanOrEqual(5);
  for(const tr of trees){expect(inside([tr.x,tr.z],roof)).toBe(true);expect(tr.y).toBeGreaterThan(H*(1-COMMERCE.slope)-1e-9);expect(tr.y).toBeLessThanOrEqual(H);}
  // The bronze ribbon's edges are their own part, drawn in bronze.
  expect(commerceGeometry(1).lips.getAttribute('position').count).toBeGreaterThan(0);
  expect(readFileSync(join(__dirname,'CommerceTower.tsx'),'utf8')).toMatch(/geo\.lips\} material=\{mats\.bronze\}/);
 });
 it('stays inside its performance budget: merged meshes, a few instances, no lights or frame loop',()=>{
  const g=commerceGeometry(1,COMMERCE.height*2);
  const meshes=Object.values(g).filter(v=>v&&typeof v==='object'&&'attributes' in v);
  // 15 since the grounds round the podium (2026-11-24) became one flat vertex-coloured mesh.
  expect(meshes.length).toBeLessThanOrEqual(15);
  expect(commerceTriangles(g)).toBeLessThan(30000);
  const source=readFileSync(join(__dirname,'CommerceTower.tsx'),'utf8');
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);expect(source).not.toMatch(/useFrame/);
  expect((source.match(/<Instanced /g)??[]).length).toBeLessThanOrEqual(2);
  // The lightest quality level drops the fins.
  expect(source).toMatch(/finsOn=quality<3/);
  // No image or model files: everything is drawn from numbers.
  expect(source).not.toMatch(/\.(png|jpe?g|webp|glb|gltf)['"]/);
  expect(readdirSync(__dirname).filter(f=>/^commercetower/i.test(f)).length).toBeGreaterThanOrEqual(3);
 });
});
