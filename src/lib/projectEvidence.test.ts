import {expect,it} from "vitest";
import {projectEvidence} from "./projectEvidence";
import {catalog} from "../catalog";
import type {RepoSnapshot} from "../github/types";
it("keeps partial and stale evidence separate for multi-repository projects",()=>{
 const project={...catalog.projects[0],repository:'owner/one',repositories:['owner/two']};
 const snapshot={fetchedAt:'2026-01-01',runs:[],commits:[]} as unknown as RepoSnapshot;
 const rows=projectEvidence(project,{...catalog,agents:[]},{'owner/one':{kind:'error',message:'Unavailable',data:snapshot}},Date.parse('2026-02-01'));
 expect(rows.find(r=>r.name==='owner/one')?.stale).toBe(true);
 expect(rows.find(r=>r.name==='owner/two')?.attention).toContain('unavailable');
 expect(projectEvidence(project,{...catalog,agents:[]},{},0).every(r=>!r.snapshot)).toBe(true);
});
