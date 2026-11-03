import fs from 'node:fs';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
for (const file of fs.readdirSync('.github/workflows').filter(name => /\.ya?ml$/.test(name))) {
  yaml.load(fs.readFileSync(`.github/workflows/${file}`, 'utf8'));
}
const ci = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
assert.equal(ci.permissions.contents, 'read');
assert.deepEqual(ci.jobs.macos.needs, ['web', 'career', 'rust', 'audit', 'security']);
assert.equal(ci.jobs.career.defaults.run['working-directory'], 'ops/career');
assert.equal(ci.jobs.career.steps.find(step => step.run === 'pytest -q').env.ANTHROPIC_API_KEY, '');
assert.ok(ci.jobs.career.steps.some(step => step.name === 'Keep personal career files out of Git'));
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
