import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';
import {catalog} from '../../catalog';
import {layoutMap,type GroupBy} from '../mapLayout';
import {buildScene} from './scene';
import {FLOOR_BASE,towerTop} from './models';
import {HQ} from './atlasHqPlan';
import {CC,ccBay,ccDoor,ccEntrance,ccFootprint,ccGrounds,ccLedges,ccOutline,ccRoof,ccTop} from './commandCenterPlan';
import {HQ_INTERIOR} from '../office/atlasHqInteriorPlan';
import {HQ_PALETTE} from './atlasHqPalette';

/** The Blender model as the map loads it: its JSON chunk, read without three.js. */
const GLB=join(__dirname,'../../../public/models/map/command-center.glb');
function glb(){
 const b=readFileSync(GLB),len=b.readUInt32LE(12);
 type Accessor={count:number;min?:number[];max?:number[]};
 const j=JSON.parse(b.subarray(20,20+len).toString('utf8')) as {meshes:{name:string;primitives:{attributes:{POSITION:number};indices:number}[]}[];accessors:Accessor[];images?:{name:string;mimeType:string;bufferView:number}[];bufferViews:{byteLength:number}[];extensionsUsed?:string[]};
 const meshes=j.meshes.map(m=>{const p=m.primitives[0],pos=j.accessors[p.attributes.POSITION];return {name:m.name,primitives:m.primitives.length,triangles:j.accessors[p.indices].count/3,min:pos.min!,max:pos.max!};});
 const images=(j.images??[]).map(i=>({name:i.name,mime:i.mimeType,bytes:j.bufferViews[i.bufferView].byteLength}));
 return {bytes:b.length,meshes,images,extensions:j.extensionsUsed??[]};
}

describe('Atlas Command Center',()=>{
 it('fits inside the old square footprint, so the parcel, plaza, roads and links stay put',()=>{
  for(const k of [.8,1,1.3])for(const [x,z] of ccFootprint(k)){
   expect(Math.abs(x)).toBeLessThanOrEqual(HQ.refSize*k/2);
   expect(Math.abs(z)).toBeLessThanOrEqual(HQ.refSize*k/2);
  }
 });
 it('is the lobby and four office floors you walk through inside, at the interior\'s proportions and the neighbours\' size',()=>{
  expect(CC.floors).toBe(HQ_INTERIOR.floors-1);
  // The interior's storeys at 10 interior units per map unit of plan: the interior's own proportions.
  expect(CC.lobby*10).toBeCloseTo(HQ_INTERIOR.lobbyHeight);
  expect(CC.storey*10).toBeCloseTo(HQ_INTERIOR.height);
  // Outside it stands as tall as the Agent Operations Center (Khaneil, 2026-11-17): its roof within
  // one storey of that building's roof, with fourteen office floors; the four inside stay.
  const towers=buildScene(layoutMap(catalog,[],'district')).towers;
  const hq=towers.find(t=>t.projectId==='ai-ops-atlas')!,kk=hq.size/HQ.refSize;
  const agentOps=towers.find(t=>t.projectId==='intelligence-hub')!;
  expect(agentOps.name).toBe('Agent Operations Center');
  expect(Math.abs(ccRoof(kk)-(agentOps.customHeight??agentOps.height))).toBeLessThan(CC.storey*kk);
  expect(CC.outsideFloors).toBe(14);
  // A stone ledge over the lobby and over each office floor outside; the last one is the roof.
  const k=1.4,l=ccLedges(k);
  expect(l).toHaveLength(CC.outsideFloors+1);expect(l[0]).toBeCloseTo(CC.lobby*k);expect(l[CC.outsideFloors]).toBeCloseTo(ccRoof(k));
  // The plan keeps the floor plates' proportions: wider than deep, rounded corners.
  expect(CC.roundness).toBe(HQ_INTERIOR.roundness);
 });
 it('puts its nameplate, selection box and inside view on its real roof, for every grouping',()=>{
  for(const grouping of ['none','district','status','tag'] as GroupBy[]){
   const scene=buildScene(layoutMap(catalog,[],grouping)),hq=scene.towers.find(t=>t.projectId==='ai-ops-atlas')!;
   expect(hq.identity.landmark).toBe(true);
   expect(towerTop(hq)).toBeCloseTo(FLOOR_BASE+ccTop(hq.size/HQ.refSize)+.04);
   // The shared opening glass doors stand in the stone bay's face, centred on it.
   const door=ccDoor(hq,FLOOR_BASE),k=hq.size/HQ.refSize;
   expect(door.p[0]).toBeCloseTo(hq.x);expect(door.p[2]-hq.z).toBeGreaterThanOrEqual(ccBay(k).front);
   expect(door.s[0]).toBeLessThan(ccBay(k).w);
  }
 });
 it('is a light Blender model: one mesh per material, small baked textures, no decoders, under the old triangle budget',()=>{
  const m=glb();
  expect(m.meshes.map(x=>x.name).sort()).toEqual(['cc_brass','cc_frame','cc_glass','cc_hedge','cc_lawn','cc_lobby','cc_roof','cc_stone']);
  for(const x of m.meshes)expect(x.primitives).toBe(1);
  expect(m.meshes.reduce((n,x)=>n+x.triangles,0)).toBeLessThan(14000);
  // Baked in Blender: every solid part's colour (stone, brass, palette with its occlusion), the brass
  // roughness, the glass's occlusion and the window glow on the slabs and sills. Capped so the
  // map's 8 MB budget keeps its room.
  expect(m.images.map(i=>i.name).sort()).toEqual(['cc_brass_color','cc_brass_roughness','cc_frame_color','cc_frame_glow','cc_glass_occlusion','cc_hedge_color','cc_lawn_color','cc_lobby_occlusion','cc_roof_color','cc_stone_color','cc_stone_glow']);
  for(const i of m.images)expect(i.bytes,i.name).toBeLessThan(600_000);
  expect(m.images.reduce((n,i)=>n+i.bytes,0)).toBeLessThan(1_200_000);
  // JPEG or PNG only: decodeEmbeddedTextures reads those without blob: URLs, which the CSP blocks.
  // (A WebP or KTX2 texture would go through GLTFLoader's own blob: path and vanish when hosted.)
  for(const i of m.images)expect(i.mime).toMatch(/^image\/(jpeg|png)$/);
  // No Draco or Meshopt: their decoders need a CDN or WebAssembly, which the CSP does not allow.
  expect(m.extensions.filter(e=>/draco|meshopt|webp|basisu|avif/i.test(e))).toEqual([]);
  expect(m.bytes).toBeLessThan(2_000_000);
  const source=readFileSync(join(__dirname,'AtlasHq.tsx'),'utf8');
  // Every load of the model (the preload and the hook) decodes its textures the CSP-safe way.
  expect(source.match(/useGLTF(\.preload)?\(CC_MODEL_URL,false,false,decodeEmbeddedTextures\)/g)).toHaveLength(2);
  expect(source).not.toMatch(/<(point|spot|directional|ambient|hemisphere|rectArea)Light/);
  expect(source).not.toMatch(/useFrame/);
  const e=ccEntrance(2),gr=ccGrounds(2);expect(e.boxes.length+e.lamps.length+gr.boxes.length+gr.blobs.length+gr.trunks.length).toBeLessThan(80);
 });
 it('matches the plan the map places everything by: footprint, storeys, roof and entrance bay',()=>{
  const by=Object.fromEntries(glb().meshes.map(x=>[x.name,x]));
  const xs=ccOutline(1).map(([x])=>x),zs=ccOutline(1).map(([,z])=>z);
  // The glass line is the plan's outline, from the ground to the roof.
  for(const part of ['cc_lobby','cc_glass']){
   expect(by[part].min[0]).toBeCloseTo(Math.min(...xs),3);expect(by[part].max[0]).toBeCloseTo(Math.max(...xs),3);
   expect(by[part].min[2]).toBeCloseTo(Math.min(...zs),3);expect(by[part].max[2]).toBeCloseTo(Math.max(...zs),3);
  }
  expect(by.cc_lobby.min[1]).toBeCloseTo(0,4);expect(by.cc_lobby.max[1]).toBeCloseTo(CC.lobby,4);
  expect(by.cc_glass.max[1]).toBeCloseTo(ccRoof(1),4);
  // The stone bay's top is the building's top, and its face is where the doors and nameplate go.
  expect(by.cc_stone.max[1]).toBeCloseTo(ccTop(1)+.02,3);
  expect(by.cc_stone.max[2]).toBeGreaterThanOrEqual(ccBay(1).front);
  expect(by.cc_stone.max[2]).toBeLessThan(ccBay(1).front+.02);
  // Slabs stand proud of the glass by the plan's amount, and nothing leaves the old square.
  expect(by.cc_stone.max[0]).toBeCloseTo(CC.a+CC.slab,2);
  for(const x of Object.values(by))for(const i of [0,2]){expect(Math.abs(x.min[i])).toBeLessThanOrEqual(HQ.refSize/2);expect(Math.abs(x.max[i])).toBeLessThanOrEqual(HQ.refSize/2);}
 });
 it('rebuilds from a Blender script kept next to the editable source',()=>{
  const dir=join(__dirname,'../../../assets/command-center');
  expect(readdirSync(dir).sort()).toEqual(['build.json','build_command_center.py','command-center.blend','textures']);
  // The stone's source: Poly Haven's Marble 01 (CC0), credited in docs/command-center-redesign.
  expect(readdirSync(join(dir,'textures'))).toEqual(['marble_01_diff_1k.jpg']);
  const script=readFileSync(join(dir,'build_command_center.py'),'utf8');
  expect(script).toContain('public/models/map/command-center.glb'.split('/').pop());
  expect(script).toMatch(/LOBBY = 3\.3 \/ 10/);expect(script).toMatch(/STOREY = 2\.7 \/ 10/);expect(script).toMatch(new RegExp(`FLOORS = ${CC.outsideFloors}\\n`));
 });
 it('keeps brass restrained: lobby mullions and one line in the model, the door header, canopy and its columns outside it',()=>{
  // Header, canopy and its two slim columns.
  expect(ccEntrance(1).boxes.filter(b=>b[6]===HQ_PALETTE.brass)).toHaveLength(4);
  const brass=glb().meshes.find(x=>x.name==='cc_brass')!;
  // Nothing brass above the lobby.
  expect(brass.max[1]).toBeLessThanOrEqual(CC.lobby+1e-4);
 });
 it('keeps the Blender file and the GLB in step with the script: a design change means a rebuild',()=>{
  const dir=join(__dirname,'../../../assets/command-center');
  const sha=(f:string)=>createHash('sha256').update(readFileSync(f)).digest('hex');
  const stamp=JSON.parse(readFileSync(join(dir,'build.json'),'utf8')) as {script:string;blend:string;glb:string};
  // If one of these fails, run `npm run model:command-center` and commit all three files.
  expect(sha(join(dir,'build_command_center.py')),'script changed since the last build').toBe(stamp.script);
  expect(sha(join(dir,'command-center.blend')),'.blend changed without a rebuild').toBe(stamp.blend);
  expect(sha(GLB),'GLB changed without a rebuild').toBe(stamp.glb);
 });
 it('has file names that stay distinct on a case-insensitive Mac disk',()=>{
  const seen=new Map<string,string>();
  for(const f of readdirSync(__dirname)){const low=f.toLowerCase();expect(seen.get(low)??f).toBe(f);seen.set(low,f);}
 });
});
