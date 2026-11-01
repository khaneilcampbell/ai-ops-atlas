import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('./transport',()=>({githubGet:vi.fn()}));
const {githubGet}=await import('./transport');
const get=vi.mocked(githubGet);
const fresh=async()=>{vi.resetModules();return import('./runOutputs');};
beforeEach(()=>{get.mockReset();vi.useRealTimers();});
describe('workflow output reads',()=>{
 it('accepts only the exact repository and positive safe run IDs',async()=>{
  const {outputRun}=await fresh();
  expect(outputRun('o/r','https://github.com/o/r/actions/runs/42/attempts/2')).toBe(42);
  for(const url of ['https://evil.test/o/r/actions/runs/42','https://github.com/o/other/actions/runs/42','https://github.com/o/r/actions/runs/0','https://github.com/o/r/actions/runs/9007199254740992','https://github.com/o/r/actions/runs/42/logs'])expect(outputRun('o/r',url)).toBeNull();
 });
 it('deduplicates concurrent opens and reuses metadata without persisting response bodies',async()=>{
  const {loadRunOutputs}=await fresh();get.mockResolvedValue({artifacts:[],jobs:[],total_count:0});
  const [a,b]=await Promise.all([loadRunOutputs('o/r',42),loadRunOutputs('o/r',42)]);
  expect(a).toBe(b);expect(get).toHaveBeenCalledTimes(2);
  await loadRunOutputs('o/r',42);await loadRunOutputs('o/r',42,true);expect(get).toHaveBeenCalledTimes(2);
  expect(get).toHaveBeenCalledWith('/repos/o/r/actions/runs/42/artifacts?per_page=20',{cache:false});
 });
 it('shows files even if job permissions fail, preserves expired status and constructs trusted links',async()=>{
  const {loadRunOutputs}=await fresh();get.mockImplementation(async path=>{if(path.includes('/jobs?'))throw new Error('Actions read permission required');return {artifacts:[{id:7,name:'documents',size_in_bytes:2048,expired:true,archive_download_url:'https://evil.test'}],total_count:1};});
  const data=await loadRunOutputs('o/r',42);expect(data.artifacts[0]).toMatchObject({expired:true,url:'https://github.com/o/r/actions/runs/42/artifacts/7'});expect(data.errors).toEqual(['Job results: Actions read permission required']);
 });
 it('distinguishes unreadable/failed responses from an empty successful result',async()=>{
  const {loadRunOutputs}=await fresh();get.mockResolvedValue({message:'unexpected'});const data=await loadRunOutputs('o/r',42);expect(data.errors).toHaveLength(2);expect(data.artifacts).toEqual([]);
 });
 it('bounds lists and never trusts response-provided job URLs',async()=>{
  const {loadRunOutputs}=await fresh();get.mockResolvedValue({artifacts:Array.from({length:50},(_,i)=>({id:i+1,name:'file'})),jobs:[{id:2,name:'Render',status:'completed',conclusion:'success',html_url:'javascript:alert(1)',steps:Array.from({length:80},()=>({name:'Check',status:'completed',conclusion:'success'}))}],total_count:50});const data=await loadRunOutputs('o/r',42);expect(data.artifacts).toHaveLength(20);expect(data.jobs[0].steps).toHaveLength(50);expect(data.jobs[0].url).toBe('https://github.com/o/r/actions/runs/42/job/2');
 });
 it('refreshes after cooldown, reuses completed reads for two minutes and limits error retries',async()=>{
  vi.useFakeTimers();const {loadRunOutputs}=await fresh();get.mockResolvedValue({artifacts:[],jobs:[]});await loadRunOutputs('o/r',42);vi.advanceTimersByTime(16_000);await loadRunOutputs('o/r',42);expect(get).toHaveBeenCalledTimes(2);await loadRunOutputs('o/r',42,true);expect(get).toHaveBeenCalledTimes(4);vi.advanceTimersByTime(121_000);get.mockRejectedValue(new Error('Unavailable'));await loadRunOutputs('o/r',42);await loadRunOutputs('o/r',42,true);expect(get).toHaveBeenCalledTimes(6);vi.useRealTimers();
 });
});

it('bounds the memory cache and concurrent network reads',async()=>{
 const {loadRunOutputs}=await fresh();get.mockResolvedValue({artifacts:[],jobs:[]});
 for(let id=1;id<=13;id++)await loadRunOutputs('o/r',id);
 await loadRunOutputs('o/r',1);expect(get).toHaveBeenCalledTimes(28);
 const resolves:((value:unknown)=>void)[]=[];
 get.mockImplementation(()=>new Promise(resolve=>resolves.push(resolve)));
 const first=[100,101,102].map(id=>loadRunOutputs('o/r',id));
 await expect(loadRunOutputs('o/r',103)).rejects.toThrow('Other output reads');
 for(const resolve of resolves)resolve({artifacts:[],jobs:[]});await Promise.all(first);
});
