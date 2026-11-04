import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {MAX_CHECKPOINT_BYTES,parseCheckpoint} from './checkpoint';
const raw=readFileSync('ops/benjaire-production/evidence/job.json','utf8');
it('reads the merged runner fixture without retaining arbitrary fields',()=>{
 const record=JSON.parse(raw);record.secret='do not display';
 const result=parseCheckpoint(JSON.stringify(record));
 expect(result.status).toBe('awaiting approval');expect(result.fixture).toBe(true);expect(JSON.stringify(result)).not.toContain('do not display');
});
it('does not reuse approval for another version',()=>{
 const record=JSON.parse(raw);record.approval={hash:'0'.repeat(64)};
 expect(parseCheckpoint(JSON.stringify(record)).approved).toBe(false);
 record.approval.hash=record.review_hash;expect(parseCheckpoint(JSON.stringify(record)).approved).toBe(true);
 record.review_hash='1'.repeat(64);expect(parseCheckpoint(JSON.stringify(record)).approved).toBe(false);
});
it('rejects malformed, oversized, unsupported source and paid-call metadata',()=>{
 expect(()=>parseCheckpoint('x'.repeat(MAX_CHECKPOINT_BYTES+1))).toThrow();
 for(const change of [{model_calls:1},{job_id:'bad'},{observed_at:'bad'},{stage:'publish'},{execution_source:'external'},{artifacts:{'../x':'0'.repeat(64)}}]) expect(()=>parseCheckpoint(JSON.stringify({...JSON.parse(raw),...change}))).toThrow();
});
