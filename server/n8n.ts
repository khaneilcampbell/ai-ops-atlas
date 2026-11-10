// Live n8n runs for the Workflow Automation Plant. The signed-in page asks GET /api/n8n, the Mac
// app GET /api/hooks/n8n with its sync key. The site reads KC's n8n Cloud instance with a read-only
// API key (N8N_API_KEY, a Pages secret) and returns only a summary: workflow names, whether each is
// switched on, and its recent runs' status and times. No run data, inputs or credentials leave n8n,
// and nothing here can start, edit or stop a workflow (only GET requests are made).

import { FAILED, RUNS_PER_WORKFLOW, type N8nRun, type N8nRunStatus, type N8nSnapshot, type N8nWorkflowRuns } from "../src/n8n/types";
import { bearerOk } from "./live";
import type { CheckCache } from "./properties";

export interface N8nEnv {
  /** Read-only n8n API key (n8n Settings → n8n API, scope "Read only"). */
  N8N_API_KEY?: string;
  /** The n8n instance, e.g. https://example.app.n8n.cloud. Defaults to KC's instance. */
  N8N_BASE_URL?: string;
  /** The Mac app's sync key, for /api/hooks/n8n. */
  USAGE_SYNC_TOKEN?: string;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Fetcher = typeof fetch;

export const DEFAULT_INSTANCE = "https://khancam15.app.n8n.cloud";
/** How many recent executions one summary covers (n8n's page limit is 250). */
export const WINDOW = 250;
const TIMEOUT_MS = 15_000;
/** Reused for a minute, so both devices polling cost one upstream read per minute. */
export const TTL_SEC = 60;
const DAY_MS = 24 * 3_600_000;
const CACHE_KEY = "n8n-runs";

const STATUSES: ReadonlySet<string> = new Set(["success", "error", "crashed", "canceled", "running", "waiting", "new"]);
const noStore = { "cache-control": "no-store" };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });
const iso = (v: unknown): string | null => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

/** The instance origin from N8N_BASE_URL, or the default; only an https origin is accepted. */
export function instanceOf(env: N8nEnv): string {
  try {
    const u = new URL(env.N8N_BASE_URL?.trim() || DEFAULT_INSTANCE);
    return u.protocol === "https:" ? u.origin : DEFAULT_INSTANCE;
  } catch {
    return DEFAULT_INSTANCE;
  }
}

export function parseRun(j: J): N8nRun | null {
  const id = str(j?.id);
  if (!id) return null;
  const raw = typeof j.status === "string" ? j.status : null;
  // Older n8n versions only report finished; treat a finished run without a status as success.
  const status: N8nRunStatus = raw && STATUSES.has(raw) ? (raw as N8nRunStatus) : raw ? "unknown" : j.finished === true ? "success" : "unknown";
  return { id, status, mode: str(j.mode), startedAt: iso(j.startedAt), stoppedAt: iso(j.stoppedAt) };
}

/** Joins n8n's workflow list and recent executions into one row per workflow. Archived workflows are left out. */
export function summarize(workflows: J[], executions: J[], now: number): N8nWorkflowRuns[] {
  const byWorkflow = new Map<string, N8nRun[]>();
  for (const e of executions) {
    const wf = str(e?.workflowId);
    const run = parseRun(e);
    if (wf && run) byWorkflow.set(wf, [...(byWorkflow.get(wf) ?? []), run]);
  }
  const newest = (a: N8nRun, b: N8nRun) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "");
  return workflows
    .filter((w) => str(w?.id) && w.isArchived !== true)
    .map((w) => {
      const runs = (byWorkflow.get(str(w.id)!) ?? []).sort(newest);
      return {
        id: str(w.id)!,
        name: typeof w.name === "string" && w.name.trim() ? w.name.trim() : `Workflow ${w.id}`,
        active: w.active === true,
        runs: runs.slice(0, RUNS_PER_WORKFLOW),
        failures24h: runs.filter((r) => FAILED.has(r.status) && r.startedAt && now - Date.parse(r.startedAt) <= DAY_MS).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function getJson(fetcher: Fetcher, url: string, key: string): Promise<J> {
  const r = await fetcher(url, { headers: { "x-n8n-api-key": key, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (r.status === 401 || r.status === 403) throw new Error("n8n refused the API key. Check N8N_API_KEY on the site (read-only scope is enough).");
  if (!r.ok) throw new Error(`n8n answered ${r.status}.`);
  return (await r.json()) as J;
}

const list = (j: J): J[] => (Array.isArray(j?.data) ? j.data : []);

export async function n8nSnapshot(env: N8nEnv, cache: CheckCache | null, fetcher: Fetcher = fetch, now = Date.now()): Promise<N8nSnapshot> {
  const key = env.N8N_API_KEY?.trim();
  if (!key) return { state: "not-configured", need: "A read-only n8n API key saved on the site as the N8N_API_KEY secret." };
  const hit = (await cache?.get(CACHE_KEY)) as N8nSnapshot | null | undefined;
  if (hit) return hit;
  const base = instanceOf(env);
  const [wf, ex] = await Promise.all([getJson(fetcher, `${base}/api/v1/workflows?limit=250&excludePinnedData=true`, key), getJson(fetcher, `${base}/api/v1/executions?limit=${WINDOW}&includeData=false`, key)]);
  const executions = list(ex);
  const snap: N8nSnapshot = { state: "ok", instance: base, fetchedAt: new Date(now).toISOString(), window: executions.length, workflows: summarize(list(wf), executions, now) };
  await cache?.put(CACHE_KEY, snap, TTL_SEC);
  return snap;
}

const why = (e: unknown) => (e instanceof Error ? (e.name === "TimeoutError" ? "n8n didn't answer in time." : e.message) : "Unknown error");

/** GET /api/n8n, behind Access. */
export async function readN8n(env: N8nEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  try {
    return reply(200, await n8nSnapshot(env, cache, fetcher));
  } catch (e) {
    return reply(502, { message: why(e) });
  }
}

/** GET /api/hooks/n8n: the same for the Mac app, with its sync key instead of Access. */
export async function readN8nForApp(req: Request, env: N8nEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readN8n(env, cache, fetcher);
}
