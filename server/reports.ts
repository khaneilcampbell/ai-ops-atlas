// Full agent reports (src/reports/model.ts). An agent posts its whole result to /api/hooks/reports
// with the add-only AGENT_FEED_TOKEN; the signed-in page reads them at /api/reports (behind
// Access) and the Mac app at /api/hooks/reports with its sync key. Reports live in their own
// table, so they outlast the three-day live feed: the newest KEEP_REPORTS per agent are kept.
// Each stored report also drops a one-line `agent_report` event into the live feed, so an
// open inspector refreshes as soon as a new report lands.

import { isReportAgent, MAX_REPORT_BYTES, validOpportunityReport, type StoredReport } from "../src/reports/model";
import { bearerOk, ensureSchema as ensureFeed, type D1, type LiveEnv } from "./live";

export const REPORTS_PATH = "/api/hooks/reports";
export const KEEP_REPORTS = 20;
export const READ_LIMIT = 10;

const noStore = { "cache-control": "no-store" };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: noStore });

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS agent_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS agent_reports_agent ON agent_reports(agent, id)",
];

const ready = new WeakSet<D1>();
async function ensureSchema(db: D1) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((s) => db.prepare(s)));
  ready.add(db);
}

/** POST /api/hooks/reports: one agent's full report. Add-only; it can't read anything back. */
export async function receiveReport(req: Request, env: LiveEnv, now = Date.now()): Promise<Response> {
  if (!env.LIVE || !env.AGENT_FEED_TOKEN) return reply(503, { message: "Agent reports aren't set up on the site yet (LIVE binding or AGENT_FEED_TOKEN missing)." });
  if (!bearerOk(req, env.AGENT_FEED_TOKEN)) return reply(401, { message: "The key doesn't match the site's AGENT_FEED_TOKEN." });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_REPORT_BYTES) return reply(413, { message: "Payload too large." });
  const text = await req.text();
  if (text.length > MAX_REPORT_BYTES) return reply(413, { message: "Payload too large." });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { message: "Body isn't JSON." });
  }
  if (!validOpportunityReport(body)) return reply(400, { message: "Not a valid report (see src/reports/model.ts)." });
  const db = env.LIVE;
  await ensureSchema(db);
  await ensureFeed(db);
  const at = new Date(now).toISOString();
  const top = body.ideas[0];
  const line = top ? `${body.ideas.length} ideas. Top: ${top.title} (score ${top.score}).` : "No ideas this run.";
  await db.batch([
    db.prepare("INSERT INTO agent_reports (agent, at, body) VALUES (?, ?, ?)").bind(body.agent, at, JSON.stringify(body)),
    // Only the newest few per agent; the report itself is the record, the run on GitHub the audit trail.
    db.prepare("DELETE FROM agent_reports WHERE agent = ? AND id NOT IN (SELECT id FROM agent_reports WHERE agent = ? ORDER BY id DESC LIMIT ?)").bind(body.agent, body.agent, KEEP_REPORTS),
    db.prepare("INSERT INTO events (at, source, kind, repo, delivery, body) VALUES (?, ?, ?, ?, ?, ?)").bind(at, "agent", "agent_report", null, null, JSON.stringify({ agent: body.agent, detail: line.slice(0, 300) })),
  ]);
  return reply(202, { stored: 1 });
}

/** The newest reports of one agent, newest first. */
export async function readReports(url: URL, env: LiveEnv): Promise<Response> {
  if (!env.LIVE) return reply(200, { configured: false, reports: [] });
  const agent = url.searchParams.get("agent") ?? "";
  if (!isReportAgent(agent)) return reply(400, { message: "Unknown agent." });
  await ensureSchema(env.LIVE);
  const { results } = await env.LIVE.prepare("SELECT id, at, body FROM agent_reports WHERE agent = ? ORDER BY id DESC LIMIT ?").bind(agent, READ_LIMIT).all<{ id: number; at: string; body: string }>();
  const reports: StoredReport[] = [];
  for (const r of results) {
    const body = JSON.parse(r.body);
    if (validOpportunityReport(body)) reports.push({ id: r.id, at: r.at, body });
  }
  return reply(200, { configured: true, reports });
}

/** GET /api/hooks/reports: the same reports for the Mac app, with its sync key instead of Access. */
export async function readReportsForApp(req: Request, env: LiveEnv): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Live updates aren't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readReports(new URL(req.url), env);
}
