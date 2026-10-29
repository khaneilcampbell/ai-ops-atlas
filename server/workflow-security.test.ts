import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { needs?: string | string[]; if?: string; environment?: string; permissions?: Record<string, string>; steps: Step[] };
const workflow = (name: string) => load(readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8')) as { permissions: Record<string, string>; jobs: Record<string, Job> };

describe('release credential boundaries', () => {
  it('keeps signing secrets behind a main-only protected job after validation', () => {
    const { jobs } = workflow('ci');
    expect(jobs.macos.needs).toEqual(['web', 'rust', 'audit', 'security']);
    expect(jobs.sign.needs).toBe('macos');
    expect(jobs.sign.environment).toBe('macos-signing');
    expect(jobs.sign.if).toContain("github.event_name == 'push'");
    expect(jobs.sign.if).toContain("github.ref == 'refs/heads/main'");
    for (const [name, job] of Object.entries(jobs)) {
      if (JSON.stringify(job).includes('secrets.')) expect(name).toBe('sign');
    }
    expect(jobs.sign.permissions?.contents).not.toBe('write');
    const signing = jobs.sign.steps.filter(s => JSON.stringify(s.env ?? {}).includes('secrets.'));
    expect(signing).toHaveLength(1);
    expect(signing[0].run).not.toMatch(/npm ci|tauri build|cargo /);
  });
  it.each(['ci', 'release'])('%s only gives write permission to an artifact-only publishing job', name => {
    const w = workflow(name);
    expect(w.permissions).toEqual({ contents: 'read' });
    for (const [id, job] of Object.entries(w.jobs)) {
      if (job.permissions?.contents === 'write') {
        expect(id).toBe('publish');
        expect(job.needs).toBe(name === 'ci' ? 'sign' : 'macos');
        expect(JSON.stringify(job)).not.toMatch(/actions\/checkout|npm ci|npx |cargo |secrets\./);
      }
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/checkout@')) expect(step.with?.['persist-credentials']).toBe(false);
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      }
    }
  });
});
