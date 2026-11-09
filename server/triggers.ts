// Event-driven agent runs. The site already receives GitHub webhooks and pipeline reports
// (server/live.ts); these rules decide which of them are worth waking an agent for, so nothing
// has to check on a timer. Plain code, no model:
//
//   - a workflow on a repository's default branch starts failing (a failed deploy, release or CI)
//   - a new issue opened by an allowed author (the repo is public; strangers never wake an agent)
//   - a pipeline outside Atlas reports a failed phase
//
// A failure wakes an agent once, when it starts. Repeats while it keeps failing do nothing, and the
// next success clears it. At most MAX_PER_DAY wakes a day. Each decision is stored as a `trigger`
// event in the live feed, so Atlas shows what fired and why. The wake itself is a POST to a
// Claude Code routine's fire URL; until TRIGGER_FIRE_URL and TRIGGER_FIRE_TOKEN are set the
// trigger is recorded as "ready" and KC starts it from Atlas with Fix with Claude.

import type { D1 } from "./live";

export interface TriggerEnv {
  /** The routine's /fire URL (claude.ai/code/routines → Edit → API trigger). */
  TRIGGER_FIRE_URL?: string;
  /** The routine's API token. */
  TRIGGER_FIRE_TOKEN?: string;
  /** Repositories that may wake an agent, comma separated. Default: khaneilcampbell/ai-ops-atlas. */
  TRIGGER_REPOS?: string;
  /** GitHub logins whose new issues wake an agent. Default: khaneilcampbell. */
  TRIGGER_ISSUE_AUTHORS?: string;
}

export const MAX_PER_DAY = 5;
const DAY_MS = 86_400_000;
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const DEPLOY = /deploy|release|pages|production|publish/i;

export type TriggerKind = "deploy" | "ci" | "issue" | "automation";

/** A meaningful change: `failing` true starts (or continues) a problem, false ends one. */
export interface Signal {
  key: string;
  kind: TriggerKind;
  failing: boolean;
  repo: string | null;
  title: string;
  url: string | null;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const list = (v: string | undefined, fallback: string) =>
  (v || fallback)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** What a stored live event means for agents, or null when it means nothing. */
export function signalFrom(kind: string, repo: string | null, body: J, env: TriggerEnv): Signal | null {
  const repos = list(env.TRIGGER_REPOS, "khaneilcampbell/ai-ops-atlas");
  if (kind === "agent_run") {
    if (body.status !== "failed" && body.status !== "ok") return null;
    const agent = String(body.agents?.[0] ?? body.project);
    return { key: `agent:${body.project}:${agent}`, kind: "automation", failing: body.status === "failed", repo: null, title: `${agent} ${body.status === "failed" ? "failed" : "recovered"} in ${body.phase}${body.detail ? `: ${body.detail}` : ""}`, url: null };
  }
  if (!repo || !repos.includes(repo.toLowerCase())) return null;
  if (kind === "workflow_run") {
    const r = body.run ?? {};
    if (body.action !== "completed" || !r.name || !body.default_branch || r.head_branch !== body.default_branch) return null;
    const failing = FAILED.has(r.conclusion);
    if (!failing && r.conclusion !== "success") return null;
    const deploy = DEPLOY.test(`${r.name} ${r.path ?? ""}`);
    return { key: `run:${repo}:${r.path ?? r.name}`, kind: deploy ? "deploy" : "ci", failing, repo, title: `${r.name} ${failing ? "failed" : "passed"} on ${r.head_branch}`, url: r.html_url ?? null };
  }
  if (kind === "issue") {
    if (body.action !== "opened" || !list(env.TRIGGER_ISSUE_AUTHORS, "khaneilcampbell").includes(String(body.author).toLowerCase())) return null;
    // Fix with Claude requests already start their own run when KC labels them.
    if (Array.isArray(body.labels) && body.labels.includes("claude-fix")) return null;
    return { key: `issue:${repo}#${body.number}`, kind: "issue", failing: true, repo, title: `New issue #${body.number}: ${body.title}`, url: body.url ?? null };
  }
  return null;
}

export interface TriggerState {
  failing: boolean;
  firedAt: string | null;
}

/**
 * Wake an agent only when a problem starts: not while it keeps failing, never after it recovered,
 * and not past the daily cap. Returns why not, or null to wake.
 */
export function whyNot(s: Signal, prev: TriggerState | null, firedToday: number): string | null {
  if (!s.failing) return "recovered";
  if (prev?.failing || (s.kind === "issue" && prev)) return "already triggered";
  if (firedToday >= MAX_PER_DAY) return `daily cap of ${MAX_PER_DAY} reached`;
  return null;
}

/** The text a woken routine receives. It reaches the run as untrusted data; the routine checks it on GitHub. */
export function firePayload(s: Signal): string {
  return [`Atlas event trigger (${s.kind}).`, `Repository: ${s.repo ?? "none (pipeline outside GitHub)"}`, `What happened: ${s.title}`, s.url ? `Link: ${s.url}` : null].filter(Boolean).join("\n");
}

export interface TriggerRecord {
  key: string;
  kind: TriggerKind;
  title: string;
  url: string | null;
  /** fired: the routine was started. ready: no routine set up, start it from Atlas. failed: the start call failed. */
  state: "fired" | "ready" | "failed";
  session: string | null;
}

/** A start call that failed doesn't count: the next failure event tries again. */
const forget = (db: D1, key: string) => db.prepare("DELETE FROM trigger_state WHERE key = ?").bind(key).run();

const SCHEMA = "CREATE TABLE IF NOT EXISTS trigger_state (key TEXT PRIMARY KEY, failing INTEGER NOT NULL, fired_at TEXT)";
const ready = new WeakSet<D1>();

/**
 * Applies the rules to one stored event. Returns the trigger to record in the feed, or null when
 * nothing should wake. Never throws: a trigger problem must not lose the event.
 */
export async function evaluate(db: D1, env: TriggerEnv, kind: string, repo: string | null, body: J, now: number, fetcher: typeof fetch = fetch): Promise<TriggerRecord | null> {
  const s = signalFrom(kind, repo, body, env);
  if (!s) return null;
  try {
    if (!ready.has(db)) {
      await db.prepare(SCHEMA).run();
      ready.add(db);
    }
    const { results } = await db.prepare("SELECT failing, fired_at FROM trigger_state WHERE key = ?").bind(s.key).all<{ failing: number; fired_at: string | null }>();
    const prev = results[0] ? { failing: !!results[0].failing, firedAt: results[0].fired_at } : null;
    const since = new Date(now - DAY_MS).toISOString();
    const { results: day } = await db.prepare("SELECT COUNT(*) AS n FROM trigger_state WHERE fired_at >= ?").bind(since).all<{ n: number }>();
    const reason = whyNot(s, prev, day[0]?.n ?? 0);
    // Issues are one-shot: never remember them as "failing", or a second issue could never wake.
    const failing = s.failing && s.kind !== "issue" ? 1 : 0;
    if (reason) {
      if (!s.failing && prev?.failing) await db.prepare("INSERT OR REPLACE INTO trigger_state (key, failing, fired_at) VALUES (?, 0, ?)").bind(s.key, prev.firedAt).run();
      return null;
    }
    const at = new Date(now).toISOString();
    await db.prepare("INSERT OR REPLACE INTO trigger_state (key, failing, fired_at) VALUES (?, ?, ?)").bind(s.key, failing, at).run();
    const base = { key: s.key, kind: s.kind, title: s.title, url: s.url };
    if (!env.TRIGGER_FIRE_URL || !env.TRIGGER_FIRE_TOKEN) return { ...base, state: "ready", session: null };
    try {
      const r = await fetcher(env.TRIGGER_FIRE_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${env.TRIGGER_FIRE_TOKEN}`, "anthropic-version": "2023-06-01", "anthropic-beta": "experimental-cc-routine-2026-04-01", "content-type": "application/json" },
        body: JSON.stringify({ text: firePayload(s) }),
        signal: AbortSignal.timeout(5_000),
      });
      const j = r.ok ? ((await r.json().catch(() => ({}))) as J) : {};
      if (!r.ok) await forget(db, s.key);
      return { ...base, state: r.ok ? "fired" : "failed", session: typeof j.claude_code_session_url === "string" ? j.claude_code_session_url : null };
    } catch {
      await forget(db, s.key);
      return { ...base, state: "failed", session: null };
    }
  } catch {
    return null;
  }
}
