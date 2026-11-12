import { ALERT_LABEL, type AlertKind, type RepoAlerts, type SecuritySnapshot } from "./types";

// Security incidents for the Security Operations Center: the open GitHub alerts that need KC now,
// raised from the same counts the Security alerts list shows (src/security/alerts.ts). Atlas sees
// counts and severities only, never alert details, so an incident says how many and where to look.
// - Any open secret scanning alert is critical: a leaked secret has no severity and must be rotated.
// - Critical Dependabot or code scanning alerts are critical; high ones are warnings.
// - Medium and low alerts stay in the alerts list, not here. A feed that couldn't be read raises
//   nothing, and is never counted as clear.

export type IncidentSeverity = "critical" | "warning";

export interface SecurityIncident {
  /** Stable for this repository, feed and level, so the list keys and order stay put. */
  key: string;
  repo: string;
  kind: AlertKind;
  severity: IncidentSeverity;
  title: string;
  detail: string;
  /** Where to act on it on GitHub. */
  url: string;
}

const PAGE_PATH: Record<AlertKind, string> = { dependabot: "dependabot", "code-scanning": "code-scanning", "secret-scanning": "secret-scanning" };
const plural = (n: number, more: boolean, word: string) => `${n}${more ? "+" : ""} ${word}${n === 1 && !more ? "" : "s"}`;

/** The incidents one repository's alert counts raise, most severe first. */
export function repoIncidents(r: RepoAlerts): SecurityIncident[] {
  const out: SecurityIncident[] = [];
  const url = (k: AlertKind) => `https://github.com/${r.repo}/security/${PAGE_PATH[k]}`;
  const name = r.repo.split("/")[1] ?? r.repo;

  const secrets = r.feeds["secret-scanning"];
  if (secrets.state === "ok" && secrets.open > 0) {
    out.push({
      key: `${r.repo}:secret-scanning:critical`, repo: r.repo, kind: "secret-scanning", severity: "critical",
      title: `Exposed secret in ${name}`,
      detail: `${plural(secrets.open, secrets.more, "open secret scanning alert")}. Rotate the secret, then close the alert on GitHub.`,
      url: url("secret-scanning"),
    });
  }
  for (const kind of ["dependabot", "code-scanning"] as const) {
    const f = r.feeds[kind];
    if (f.state !== "ok") continue;
    const critical = f.severity.critical ?? 0;
    const high = f.severity.high ?? 0;
    if (critical > 0) {
      out.push({
        key: `${r.repo}:${kind}:critical`, repo: r.repo, kind, severity: "critical",
        title: `Critical ${ALERT_LABEL[kind]} alert in ${name}`,
        detail: `${plural(critical, false, "critical alert")}${high ? `, ${high} high` : ""}.`,
        url: url(kind),
      });
    } else if (high > 0) {
      out.push({
        key: `${r.repo}:${kind}:high`, repo: r.repo, kind, severity: "warning",
        title: `High ${ALERT_LABEL[kind]} alert in ${name}`,
        detail: `${plural(high, false, "high alert")}.`,
        url: url(kind),
      });
    }
  }
  return out;
}

const RANK: Record<IncidentSeverity, number> = { critical: 0, warning: 1 };
const KIND_RANK: Record<AlertKind, number> = { "secret-scanning": 0, "code-scanning": 1, dependabot: 2 };

/** Every open security incident across the snapshot, critical first, then secrets, then by repository. */
export function securityIncidents(snap: SecuritySnapshot | null | undefined): SecurityIncident[] {
  if (snap?.state !== "ok") return [];
  return snap.repos
    .flatMap(repoIncidents)
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.repo.localeCompare(b.repo));
}
