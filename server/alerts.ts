// Email alerts for pipeline runs, sent by the site the moment a failure is reported, so KC
// hears about it with Atlas closed. Off until RESEND_API_KEY, ALERT_EMAIL_TO and
// ALERT_EMAIL_FROM are all set. Same rhythm as the commerce pipeline's own alerts.py: one email
// when an agent starts failing, a reminder at most every 12 hours while it keeps failing, and a
// "recovered" email on its next successful report.

import type { D1 } from "./live";

export interface AlertEnv {
  /** A Resend API key with sending access. */
  RESEND_API_KEY?: string;
  /** Where alerts go. */
  ALERT_EMAIL_TO?: string;
  /** A sender on a domain verified in Resend, for example "Atlas <alerts@benjaire.com>". */
  ALERT_EMAIL_FROM?: string;
}

export const REMIND_MS = 12 * 3_600_000;
const TIMEOUT_MS = 5_000;

export interface PipelineRun {
  project: string;
  agents: string[];
  phase: string;
  status: string;
  detail: string;
  at: string;
}

const SCHEMA = "CREATE TABLE IF NOT EXISTS alert_state (agent TEXT PRIMARY KEY, failing INTEGER NOT NULL, emailed_at TEXT NOT NULL)";
const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.prepare(SCHEMA).run();
  ready.add(db);
}

export const alertsConfigured = (env: AlertEnv) => !!(env.RESEND_API_KEY && env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM);

type Send = (subject: string, text: string) => Promise<boolean>;

function resend(env: AlertEnv, fetcher: typeof fetch): Send {
  return async (subject, text) => {
    try {
      const r = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: env.ALERT_EMAIL_FROM, to: [env.ALERT_EMAIL_TO], subject, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return r.ok;
    } catch {
      return false;
    }
  };
}

const ATLAS = "https://ai-ops-atlas.pages.dev/";

function failureText(run: PipelineRun, agent: string, reminder: boolean) {
  return [
    `${agent} (${run.project}) reported a failure${reminder ? " again" : ""}.`,
    "",
    `Phase: ${run.phase}`,
    run.detail ? `Detail: ${run.detail}` : null,
    `Reported at: ${run.at}`,
    "",
    reminder ? "It has kept failing; the next reminder comes in 12 hours at the earliest." : "You'll get a reminder every 12 hours while it keeps failing, and an email when it recovers.",
    `Open Atlas: ${ATLAS}`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/**
 * Emails about one pipeline report when it starts or continues a failure, or ends one. Returns
 * the agents it emailed about. Never throws: a failed email must not lose the report.
 */
export async function alertOnRun(db: D1, env: AlertEnv, run: PipelineRun, now: number, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (!alertsConfigured(env) || (run.status !== "failed" && run.status !== "ok")) return [];
  try {
    await ensureSchema(db);
    const send = resend(env, fetcher);
    const sent: string[] = [];
    for (const agent of run.agents) {
      const { results } = await db.prepare("SELECT failing, emailed_at FROM alert_state WHERE agent = ?").bind(agent).all<{ failing: number; emailed_at: string }>();
      const prev = results[0];
      if (run.status === "failed") {
        const due = !prev || !prev.failing || now - Date.parse(prev.emailed_at) >= REMIND_MS;
        if (!due) continue;
        const reminder = !!prev?.failing;
        if (!(await send(`Atlas alert: ${agent} ${reminder ? "is still failing" : "failed"}`, failureText(run, agent, reminder)))) continue;
        await db.prepare("INSERT OR REPLACE INTO alert_state (agent, failing, emailed_at) VALUES (?, 1, ?)").bind(agent, new Date(now).toISOString()).run();
        sent.push(agent);
      } else if (prev?.failing) {
        if (!(await send(`Atlas: ${agent} recovered`, `${agent} (${run.project}) reported a successful run at ${run.at} after failing.\n\nPhase: ${run.phase}\nOpen Atlas: ${ATLAS}`))) continue;
        await db.prepare("INSERT OR REPLACE INTO alert_state (agent, failing, emailed_at) VALUES (?, 0, ?)").bind(agent, new Date(now).toISOString()).run();
        sent.push(agent);
      }
    }
    return sent;
  } catch {
    return [];
  }
}
