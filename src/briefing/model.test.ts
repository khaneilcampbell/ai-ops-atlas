import {expect,it} from "vitest";
import {briefingGenerator} from "./model";
import type {AtlasEvent} from "../lib/activity";
const now=Date.parse('2026-11-04T12:00:00Z');
const event=(id:string,result:AtlasEvent['result'],at='2026-11-04T10:00:00Z'):AtlasEvent=>({id,result,at,title:'CI',detail:'',kind:'ci',repo:'owner/repo',url:'https://github.com/owner/repo/actions/runs/1'});
it('deduplicates replay, preserves completed outcomes, caches unchanged evidence',()=>{
 const generate=briefingGenerator(),events=[event('1','failure'),event('1','running')];
 const a=generate(events,{},24,{},now);expect(a.changes).toHaveLength(1);expect(a.actions).toHaveLength(1);
 expect(generate(events,{},24,{},now)).toBe(a);
});
it('does not recommend resolved workflow failures; bounds recommendations',()=>{
 const events=[event('old','failure'),event('new','success','2026-11-04T11:00:00Z')];
 expect(briefingGenerator()(events,{},24,{},now).actions).toHaveLength(0);
 const failures=Array.from({length:6},(_,i)=>({...event(String(i),'failure'),title:`Workflow ${i}`}));
 expect(briefingGenerator()(failures,{},24,{},now).actions).toHaveLength(3);
});
it('identifies missing sources and excludes invalid, future and out-of-period records',()=>{
 const report=briefingGenerator()([event('old','failure','2026-10-01'),event('future','failure','2027-01-01'),event('bad','failure','invalid')],{'owner/repo':{kind:'error',message:'unknown'}},24,{},now);
 expect(report.changes).toHaveLength(0);expect(report.coverage[0]).toMatchObject({checked:null,stale:true,unavailable:true});
});
