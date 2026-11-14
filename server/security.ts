// Open GitHub security alerts for the Security Operations Center. The signed-in page asks
// GET /api/security?repos=…, the Mac app GET /api/hooks/security?repos=… with its sync key. The site
// reads GitHub with its own GITHUB_TOKEN (a Pages secret) and returns only counts per severity for
// each repository's Dependabot, code scanning and secret scanning alerts. No alert text, file path,
// secret type or location is returned, and only GET requests are made, so nothing can be dismissed.

import { ALERT_KINDS, MAX_REPOS, PAGE, REPO_RE, SEVERITIES, type AlertFeed, type AlertKind, type RepoAlerts, type SecuritySnapshot, type Severity } from "../src/security/types";
import { owners, type GithubEnv } from "./github";
import { bearerOk } from "./live";
import type { CheckCache } from "./properties";
import { reply, type Json as J } from "./http";

export interface SecurityEnv extends GithubEnv {
  /** The Mac app's sync key, for /api/hooks/security. */
  USAGE_SYNC_TOKEN?: string;
}

type Fetcher = typeof fetch;

const TIMEOUT_MS = 15_000;
/** Reused for ten minutes: alerts change slowly and each repository costs three GitHub requests. */
export const TTL_SEC = 600;

const PATH: Record<AlertKind, string> = {
  dependabot: "dependabot/alerts",
  "code-scanning": "code-scanning/alerts",
  "secret-scanning": "secret-scanning/alerts",
};

/** The repositories asked for, kept only when they are well formed and belong to an allowed owner. */
export function requestedRepos(search: string | URLSearchParams, env: GithubEnv): string[] {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const allowed = owners(env);
  const seen = new Set<string>();
  for (const raw of (params.get("repos") ?? "").split(",")) {
    const repo = raw.trim();
    if (REPO_RE.test(repo) && !repo.includes("..") && allowed.includes(repo.split("/")[0].toLowerCase())) seen.add(repo);
  }
  return [...seen].sort().slice(0, MAX_REPOS);
}

/** The severity GitHub reports for one alert, from the fields each feed uses. */
export function severityOf(kind: AlertKind, a: J): Severity | null {
  const raw = kind === "dependabot" ? a?.security_advisory?.severity ?? a?.security_vulnerability?.severity
    : kind === "code-scanning" ? a?.rule?.security_severity_level ?? a?.rule?.severity
    : null;
  const s = typeof raw === "string" ? raw.toLowerCase() : null;
  if (s === "moderate") return "medium";
  if (s === "error") return "high";
  if (s === "warning") return "medium";
  if (s === "note") return "low";
  return SEVERITIES.includes(s as Severity) ? (s as Severity) : null;
}

/** Counts a page of alerts. Only the severity of each is looked at. */
export function countAlerts(kind: AlertKind, alerts: J[]): AlertFeed {
  const severity: Partial<Record<Severity, number>> = {};
  for (const a of alerts) {
    const s = severityOf(kind, a);
    if (s) severity[s] = (severity[s] ?? 0) + 1;
  }
  return { state: "ok", open: alerts.length, more: alerts.length >= PAGE, severity };
}

async function readFeed(fetcher: Fetcher, token: string, repo: string, kind: AlertKind): Promise<AlertFeed> {
  let r: Response;
  try {
    r = await fetcher(`https://api.github.com/repos/${repo}/${PATH[kind]}?state=open&per_page=${PAGE}`, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "ai-ops-atlas-web", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { state: "error", reason: e instanceof Error && e.name === "TimeoutError" ? "GitHub didn't answer in time." : "The site couldn't reach GitHub." };
  }
  if (r.ok) {
    const body = await r.json().catch(() => null);
    return Array.isArray(body) ? countAlerts(kind, body as J[]) : { state: "error", reason: "GitHub sent something Atlas couldn't read." };
  }
  const message = String(((await r.json().catch(() => null)) as J | null)?.message ?? "");
  // GitHub answers 404 (or 403 with this wording) when the feature is switched off for the repository.
  if (/disabled|not enabled|must be enabled|no analysis found/i.test(message)) return { state: "off", reason: "Not switched on for this repository." };
  if (r.status === 403 || r.status === 401 || r.status === 404) return { state: "no-access", reason: "The site's GitHub token can't read these alerts." };
  return { state: "error", reason: `GitHub answered ${r.status}.` };
}

export async function securitySnapshot(repos: string[], env: SecurityEnv, cache: CheckCache | null, fetcher: Fetcher = fetch, now = Date.now()): Promise<SecuritySnapshot> {
  const token = env.GITHUB_TOKEN?.trim();
  if (!token) return { state: "not-configured", need: "A GitHub token saved on the site as the GITHUB_TOKEN secret, allowed to read Dependabot, code scanning and secret scanning alerts." };
  const key = `security:${repos.join(",")}`;
  const hit = (await cache?.get(key).catch(() => null)) as SecuritySnapshot | null | undefined;
  if (hit) return hit;
  const rows: RepoAlerts[] = await Promise.all(repos.map(async (repo) => {
    const feeds = await Promise.all(ALERT_KINDS.map((k) => readFeed(fetcher, token, repo, k)));
    return { repo, feeds: Object.fromEntries(ALERT_KINDS.map((k, i) => [k, feeds[i]])) as Record<AlertKind, AlertFeed> };
  }));
  const snap: SecuritySnapshot = { state: "ok", fetchedAt: new Date(now).toISOString(), repos: rows };
  // A snapshot with a failed read is kept only briefly, so a GitHub blip clears on the next poll.
  const failed = rows.some((r) => ALERT_KINDS.some((k) => r.feeds[k].state === "error"));
  await cache?.put(key, snap, failed ? 60 : TTL_SEC).catch(() => undefined);
  return snap;
}

/** GET /api/security, behind Access. */
export async function readSecurity(req: Request, env: SecurityEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  const repos = requestedRepos(new URL(req.url).searchParams, env);
  if (!repos.length) return reply(400, { message: "Ask for at least one repository, as ?repos=owner/name." });
  return reply(200, await securitySnapshot(repos, env, cache, fetcher));
}

/** GET /api/hooks/security: the same for the Mac app, with its sync key instead of Access. */
export async function readSecurityForApp(req: Request, env: SecurityEnv, cache: CheckCache | null, fetcher: Fetcher = fetch): Promise<Response> {
  if (!env.USAGE_SYNC_TOKEN) return reply(503, { message: "Website sync isn't set up on the site yet (USAGE_SYNC_TOKEN missing)." });
  if (!bearerOk(req, env.USAGE_SYNC_TOKEN)) return reply(401, { message: "The sync key doesn't match the site's USAGE_SYNC_TOKEN." });
  return readSecurity(req, env, cache, fetcher);
}
