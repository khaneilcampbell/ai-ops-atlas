// Open GitHub security alerts per repository, as the site's server function counts them
// (server/security.ts). Counts and severities only: no advisory text, file paths, secret types or
// locations leave GitHub, and nothing here can dismiss, fix or reopen an alert.

/** The three GitHub alert feeds Atlas counts. */
export type AlertKind = "dependabot" | "code-scanning" | "secret-scanning";
export const ALERT_KINDS: readonly AlertKind[] = ["dependabot", "code-scanning", "secret-scanning"];
export const ALERT_LABEL: Record<AlertKind, string> = { dependabot: "Dependabot", "code-scanning": "Code scanning", "secret-scanning": "Secret scanning" };

export type Severity = "critical" | "high" | "medium" | "low";
export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

/**
 * One feed for one repository.
 * - ok: GitHub answered; `open` is the number of open alerts seen (capped at PAGE, see `more`).
 * - off: GitHub says the feature isn't enabled for this repository.
 * - no-access: the site's token isn't allowed to read this feed.
 * - error: GitHub couldn't be read right now.
 */
export type AlertFeed =
  | { state: "ok"; open: number; more: boolean; severity: Partial<Record<Severity, number>> }
  | { state: "off" | "no-access" | "error"; reason: string };

export interface RepoAlerts {
  repo: string;
  feeds: Record<AlertKind, AlertFeed>;
}

export type SecuritySnapshot =
  | { state: "ok"; fetchedAt: string; repos: RepoAlerts[] }
  | { state: "not-configured"; need: string };

/** Alerts read per feed per repository; more than this shows as "100+". */
export const PAGE = 100;
/** The most repositories one request may ask about. */
export const MAX_REPOS = 20;
export const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
