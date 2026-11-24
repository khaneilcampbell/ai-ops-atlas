// Atlas Executive routes.
//
//   /api/executive/*            Khaneil, through Cloudflare Access (checked by the middleware)
//     GET  overview             goals, tasks, approvals, events, spend
//     POST goals                {objective, budgetUsd?}: submit a goal
//     POST goals/<id>/pause | resume | cancel
//     POST tick                 "Check now": the same reconciliation the schedule runs
//     GET  engineering          Engineering Operations: incidents, executions, QA, pull requests, costs
//   /api/hooks/executive-result  n8n: ATLAS_WORKFLOW_RESULT / ATLAS_EXECUTIVE_ERROR (N8N_BRIDGE_CALLBACK_TOKEN)
//   /api/hooks/executive-tick    n8n schedule: ATLAS_EXECUTIVE_SCHEDULE (same key); also sweeps for missed CI failures
//   /api/hooks/engineering-result the runner's report job (ATLAS_ENGINEERING_CALLBACK_TOKEN)
//
// Bodies are never logged. The database is the one from the data foundation (server/data/db.ts).

import { MAX_RESULT_BYTES, parseResult } from "../../src/executive/control/contracts";
import { isUuid } from "../../src/data/records";
import { connectionStringOf, DbUnavailable, withDb, type Db, type DbEnv } from "../data/db";
import { reply } from "../http";
import { bearerOk, type D1 } from "../live";
import { stopRefusal } from "../opsControl";
import { advance, cancelGoal, ExecRefusal, overview, pauseGoal, receiveResult, resumeGoal, submitGoal, tick, type Deps, type ExecutionAdapter } from "./engine";
import { n8nAdapter, n8nConfigured, type N8nExecEnv } from "./n8nAdapter";
import { loadRoster, type RosterEnv } from "./roster";
import { githubReader, type GithubReader, type GithubReadEnv } from "../engineering/github";
import { ingestWebhook, reconcile, type IntakeDeps } from "../engineering/intake";
import { engineeringOverview } from "../engineering/overview";
import { qaRunner } from "../engineering/qaRunner";

export interface ExecutiveEnv extends DbEnv, N8nExecEnv, RosterEnv, GithubReadEnv {
  LIVE?: D1;
  /** "true" switches automatic CI repair on. Off: failures are recorded and escalated to Khaneil. */
  ATLAS_ENGINEERING_ENABLED?: string;
  /** Key the repository runner's report job posts results with (repo secret of the same name). */
  ATLAS_ENGINEERING_CALLBACK_TOKEN?: string;
  /** Optional model tiers, e.g. "routine=sonnet,complex=opus". */
  ATLAS_ENGINEERING_MODELS?: string;
}

export const engineeringEnabled = (env: ExecutiveEnv) => (env.ATLAS_ENGINEERING_ENABLED ?? "").trim().toLowerCase() === "true";

/** Test seams: a database, adapter and registry other than the site's. */
export interface Seams {
  db?: Db;
  adapter?: ExecutionAdapter;
  roster?: Deps["roster"];
  stop?: Deps["stop"];
  now?: () => number;
  names?: Map<string, string>;
  github?: GithubReader;
}

const MAX_BODY = 8_000;

async function readJson(req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return { ok: false, res: reply(413, { message: "Payload too large." }) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: reply(413, { message: "Payload too large." }) };
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: reply(400, { message: "Body isn't JSON." }) };
  }
}

function stopOf(env: ExecutiveEnv): Deps["stop"] {
  // Fails closed: without the stop switch's database, nothing is sent.
  return async () => (env.LIVE ? stopRefusal(env.LIVE) : "The emergency stop state can't be read (LIVE isn't bound), so nothing is sent.");
}

async function withDeps<T>(env: ExecutiveEnv, seams: Seams, fn: (d: IntakeDeps, names: Map<string, string>) => Promise<T>): Promise<T> {
  let names = seams.names ?? new Map<string, string>();
  const roster: Deps["roster"] =
    seams.roster ??
    (async () => {
      const r = await loadRoster(env);
      names = r.names;
      return r.roster;
    });
  const github = seams.github ?? githubReader(env);
  const build = (db: Db): IntakeDeps => ({
    db,
    adapter: seams.adapter ?? n8nAdapter(env),
    roster,
    stop: seams.stop ?? stopOf(env),
    ...(seams.now ? { now: seams.now } : {}),
    // Atlas QA runs inside the site, reading GitHub with the site's own read-only token.
    local: { "qa-validation": qaRunner(db, github, seams.now) },
    github,
    enabled: engineeringEnabled(env),
    models: env.ATLAS_ENGINEERING_MODELS,
  });
  if (seams.db) return fn(build(seams.db), names);
  if (!connectionStringOf(env)) throw new DbUnavailable("The Atlas database isn't set up on the site (ATLAS_DB).");
  return withDb(env, (db) => fn(build(db), names));
}

function failure(e: unknown): Response {
  if (e instanceof ExecRefusal) return reply(e.status, { message: e.message });
  if (e instanceof DbUnavailable) return reply(503, { message: e.message });
  const msg = e instanceof Error ? e.message : String(e);
  // Missing tables: migration 0002 hasn't been applied yet.
  if (/exec_goals|exec_tasks|eng_incidents|eng_executions|template_inputs|relation .* does not exist|column .* does not exist/i.test(msg))
    return reply(503, { message: "The Executive's tables aren't in the database yet (apply db/migrations/0002_executive.sql and 0004_engineering.sql)." });
  throw e;
}

export async function forOwner(req: Request, env: ExecutiveEnv, path: string, seams: Seams = {}): Promise<Response> {
  const owner = (req.headers.get("cf-access-authenticated-user-email") ?? "Khaneil").slice(0, 120);
  const parts = path.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && path === "overview")
      return reply(200, await withDeps(env, seams, (d, names) => overview(d, { database: true, n8n: d.adapter.configured, schedule: n8nConfigured(env) || !!seams.adapter }, names)));
    if (req.method === "GET" && path === "engineering")
      return reply(
        200,
        await withDeps(env, seams, async (d) => {
          const roster = await d.roster().catch(() => []);
          return engineeringOverview(d.db, { database: true, n8n: d.adapter.configured, github: d.github.configured, runnerCallback: callbackConfigured(env), enabled: engineeringEnabled(env) }, roster);
        }),
      );
    if (req.method !== "POST") return reply(405, { message: "Use GET overview, GET engineering or POST." });
    const body = await readJson(req, MAX_BODY);
    if (!body.ok) return body.res;
    if (path === "goals") return reply(201, { goal: await withDeps(env, seams, (d) => submitGoal(d, body.value, owner)) });
    if (path === "tick") return reply(200, await withDeps(env, seams, (d) => tick(d, owner)));
    if (parts[0] === "goals" && parts.length === 3 && isUuid(parts[1])) {
      const id = parts[1].toLowerCase();
      const act = parts[2];
      if (act === "pause") await withDeps(env, seams, (d) => pauseGoal(d, id, owner));
      else if (act === "resume") await withDeps(env, seams, (d) => resumeGoal(d, id, owner));
      else if (act === "cancel") await withDeps(env, seams, (d) => cancelGoal(d, id, owner));
      else if (act === "advance") await withDeps(env, seams, (d) => advance(d, id, owner));
      else return reply(404, { message: "Unknown goal action." });
      return reply(200, { ok: true });
    }
    return reply(404, { message: "No such Executive route." });
  } catch (e) {
    return failure(e);
  }
}

/** n8n's calls. The callback key is the one the step runner already uses (N8N_BRIDGE_CALLBACK_TOKEN). */
const callbackConfigured = (env: ExecutiveEnv) => (env.ATLAS_ENGINEERING_CALLBACK_TOKEN ?? "").trim().length >= 32;

export async function forHook(req: Request, env: ExecutiveEnv, which: "result" | "tick" | "engineering-result", seams: Seams = {}): Promise<Response> {
  if (req.method !== "POST") return reply(405, { message: "Use POST." });
  if (which === "engineering-result") {
    // The repository runner's report job. Its own key, so it can only post engineering results, and
    // each one must still match an attempt Atlas dispatched (task, attempt, keys, nonce). QA then
    // checks GitHub itself, so even a forged report can't pass a change.
    if (!callbackConfigured(env)) return reply(503, { message: "ATLAS_ENGINEERING_CALLBACK_TOKEN isn't set on the site." });
    if (!bearerOk(req, env.ATLAS_ENGINEERING_CALLBACK_TOKEN)) return reply(401, { message: "The key doesn't match the site's ATLAS_ENGINEERING_CALLBACK_TOKEN." });
    try {
      const body = await readJson(req, MAX_RESULT_BYTES);
      if (!body.ok) return body.res;
      const parsed = parseResult(body.value);
      if (!parsed.ok) return reply(400, { message: parsed.error });
      const out = await withDeps(env, seams, async (d) => {
        const [t] = await d.db.query<{ capability: string }>("SELECT capability FROM atlas.exec_tasks WHERE id = $1", [parsed.value.taskId]);
        if (!t || t.capability !== "engineering.implement_fix") return { status: 403, body: { stored: false, message: "This key may only report engineering runs." } };
        return receiveResult(d, parsed.value);
      });
      return reply(out.status, out.body);
    } catch (e) {
      return failure(e);
    }
  }
  if (!n8nConfigured(env) && !seams.adapter) return reply(503, { message: "The Executive's n8n keys aren't set up on the site." });
  if (!bearerOk(req, env.N8N_BRIDGE_CALLBACK_TOKEN)) return reply(401, { message: "The key doesn't match the site's N8N_BRIDGE_CALLBACK_TOKEN." });
  try {
    if (which === "tick")
      return reply(
        200,
        await withDeps(env, seams, async (d) => {
          const report = await tick(d, "n8n schedule");
          // ATLAS_GITHUB_MONITOR's reconciliation: missed CI failures. Never fails the tick.
          const engineering = await reconcile(d).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
          return { ...report, engineering };
        }),
      );
    const body = await readJson(req, MAX_RESULT_BYTES);
    if (!body.ok) return body.res;
    const parsed = parseResult(body.value);
    if (!parsed.ok) return reply(400, { message: parsed.error });
    const out = await withDeps(env, seams, (d) => receiveResult(d, parsed.value));
    return reply(out.status, out.body);
  } catch (e) {
    return failure(e);
  }
}

/** A verified GitHub App delivery (server/live.ts checked the signature). Runs after the reply. */
export async function forGithubEvent(env: ExecutiveEnv, event: string, payload: unknown, seams: Seams = {}): Promise<unknown> {
  if (event !== "workflow_run" || (!connectionStringOf(env) && !seams.db)) return null;
  try {
    return await withDeps(env, seams, (d) => ingestWebhook(d, event, payload));
  } catch (e) {
    // The webhook's own reply already went out; the reconciliation sweep catches what this missed.
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
