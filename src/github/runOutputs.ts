import { githubGet } from './transport';

export interface OutputArtifact { id: number; name: string; bytes: number | null; expired: boolean | null; expiresAt?: string; url: string }
export interface OutputJob { id: number; name: string; status: string; conclusion: string | null; url: string; stepsTotal: number; steps: { name: string; status: string; conclusion: string | null }[] }
export interface RunOutputs { artifacts: OutputArtifact[]; jobs: OutputJob[]; artifactsTotal: number; jobsTotal: number; checkedAt: string; errors: string[] }
const TTL = 120_000, MAX_RUNS = 12;
const cache = new Map<string, RunOutputs>();
const pending = new Map<string, Promise<RunOutputs>>();

/** Only an observed GitHub run belonging to this exact repository may be inspected. */
export function outputRun(repo: string, url?: string): number | null {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes('..') || !url) return null;
  try {
    const u = new URL(url);
    if (u.origin !== 'https://github.com' || u.username || u.password) return null;
    const prefix = `/${repo}/actions/runs/`;
    if (!u.pathname.startsWith(prefix)) return null;
    const rest = u.pathname.slice(prefix.length);
    if (!/^[1-9]\d*(?:\/attempts\/[1-9]\d*)?\/?$/.test(rest)) return null;
    const id = Number(rest.split('/')[0]);
    return Number.isSafeInteger(id) ? id : null;
  } catch { return null; }
}
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === 'string' ? v.slice(0, 500) : '';
const idOf = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const rows = (v: unknown) => Array.isArray(v) ? v : [];
const total = (v: unknown, fallback: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= fallback ? v : fallback;

/** Two bounded, deduplicated metadata reads. No logs, file bodies, disk cache, timers or model calls. */
export function loadRunOutputs(repo: string, runId: number, refresh = false): Promise<RunOutputs> {
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  if (outputRun(repo, runUrl) !== runId) return Promise.reject(new Error('No valid workflow run is connected.'));
  const key = `${repo}/${runId}`, hit = cache.get(key);
  if (pending.has(key)) return pending.get(key)!;
  // Even manual refresh cannot repeatedly spend requests within a short click burst.
  if (hit && Date.now() - Date.parse(hit.checkedAt) < (refresh || hit.errors.length ? 15_000 : TTL)) return Promise.resolve(hit);
  if (pending.size >= 3) return Promise.reject(new Error("Other output reads are still loading. Try again shortly."));
  const base = `/repos/${repo}/actions/runs/${runId}`;
  const request = Promise.allSettled([
    githubGet(`${base}/artifacts?per_page=20`, {cache:false}),
    githubGet(`${base}/jobs?filter=latest&per_page=30`, {cache:false}),
  ]).then(([a, j]) => {
    const errors: string[] = [];
    const read = (r: PromiseSettledResult<unknown>, label: string) => {
      if (r.status === 'fulfilled') {
        const value = obj(r.value), key = label === 'Files' ? 'artifacts' : 'jobs';
        if (Array.isArray(value[key])) return value;
        errors.push(`${label}: GitHub returned an unreadable response.`);
        return {};
      }
      errors.push(`${label}: ${r.reason instanceof Error ? r.reason.message : 'Unavailable'}`);
      return {};
    };
    const ar = read(a, 'Files'), jr = read(j, 'Job results');
    const artifacts = rows(ar.artifacts).slice(0,20).flatMap(value => {
      const r = obj(value); if (!idOf(r.id)) return [];
      return [{id:r.id, name:text(r.name) || 'Unnamed artifact', bytes:typeof r.size_in_bytes === 'number' && Number.isFinite(r.size_in_bytes) && r.size_in_bytes >= 0 ? r.size_in_bytes : null, expired:typeof r.expired === "boolean" ? r.expired : null, expiresAt:typeof r.expires_at === "string" && Number.isFinite(Date.parse(r.expires_at)) ? r.expires_at : undefined, url:`${runUrl}/artifacts/${r.id}`}];
    });
    const jobs = rows(jr.jobs).slice(0,30).flatMap(value => {
      const r = obj(value); if (!idOf(r.id)) return [];
      return [{id:r.id, name:text(r.name) || 'Unnamed job', status:text(r.status), conclusion:typeof r.conclusion === 'string' ? text(r.conclusion) : null, url:`https://github.com/${repo}/actions/runs/${runId}/job/${r.id}`, stepsTotal:rows(r.steps).length, steps:rows(r.steps).slice(0,50).map(value => {const s=obj(value);return {name:text(s.name),status:text(s.status),conclusion:typeof s.conclusion === 'string' ? text(s.conclusion) : null};})}];
    });
    const result = {artifacts,jobs,artifactsTotal:total(ar.total_count,artifacts.length),jobsTotal:total(jr.total_count,jobs.length),checkedAt:new Date().toISOString(),errors};
    // Errors keep their explicit unavailable state and only a short retry cooldown.
    cache.delete(key); cache.set(key,result); while(cache.size>MAX_RUNS)cache.delete(cache.keys().next().value!);
    return result;
  }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
