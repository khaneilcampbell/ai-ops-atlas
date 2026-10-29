import fs from 'node:fs';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
const ci = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
assert.equal(ci.permissions.contents, 'read');
assert.deepEqual(ci.jobs.macos.needs, ['web', 'rust', 'audit', 'security']);
assert.equal(ci.jobs.sign.environment, 'macos-signing');
assert.equal(ci.jobs.sign.needs, 'macos');
assert.equal(ci.jobs.publish.needs, 'sign');
for (const [name, job] of Object.entries(ci.jobs)) {
  if (JSON.stringify(job).includes('secrets.')) assert.equal(name, 'sign');
  if (job.permissions?.contents === 'write') assert.equal(name, 'publish');
  assert.ok(job['timeout-minutes'] > 0);
  for (const step of job.steps ?? []) {
    if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
    if (step.uses?.startsWith('actions/checkout@')) assert.equal(step.with?.['persist-credentials'], false);
  }
}
console.log('Security workflow policy passed');
