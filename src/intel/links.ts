/**
 * Where each reference in a Claude review or assessment points. Claude cites facts by id
 * ("agent:commerce-loop", "alert:ai-ops-atlas:dependabot:17"); this turns those ids into a link to
 * the agent, repository or GitHub page they name, using only facts Atlas already read from GitHub.
 * A reference that does not match those facts stays plain text: nothing here guesses.
 */
import { markerLine, type FixRequest } from "../lib/fixWithClaude";
import type { AlertsFact, EcoReport, EcoReview, Facts, Report } from "./types";

export type RefTarget =
  | { kind: "agent"; id: string; label: string }
  | { kind: "repo"; repo: string; label: string; href: string }
  | { kind: "external"; href: string; label: string }
  | { kind: "text"; label: string };

export type AlertKind = "dependabot" | "code_scanning";

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const short = (repo: string) => repo.split("/").pop() ?? repo;
const GITHUB = /^https:\/\/github\.com\//;

/** GitHub's own page for one alert. */
export function alertPageUrl(repoUrl: string, kind: AlertKind, number: number): string {
  return `${repoUrl}/security/${kind === "dependabot" ? "dependabot" : "code-scanning"}/${number}`;
}

/** GitHub's list of open alerts of one kind. */
export function alertsListUrl(repoUrl: string, kind: AlertKind): string {
  return `${repoUrl}/security/${kind === "dependabot" ? "dependabot" : "code-scanning"}`;
}

/** The alert's own link from GitHub when it gave one, else GitHub's alert page for that number. */
export function alertUrl(facts: Pick<Facts, "url" | "security">, kind: AlertKind, number: number): string | null {
  const sec = facts.security[kind];
  if (sec.state !== "assessed") return null;
  const hit = (sec.data as AlertsFact).top.find((a) => a.number === number);
  if (!hit) return null;
  return hit.url && GITHUB.test(hit.url) ? hit.url : alertPageUrl(facts.url, kind, number);
}

const asKind = (k: string): AlertKind | null => (k === "dependabot" ? "dependabot" : k === "code_scanning" ? "code_scanning" : null);

/** Finds a reviewed repository by full name or by the short name the review prompt uses. */
function findRepo(report: EcoReport, name: string) {
  const x = name.trim().toLowerCase();
  return report.repos.find((e) => e.repo.toLowerCase() === x) ?? report.repos.find((e) => short(e.repo).toLowerCase() === x) ?? null;
}

const repoTarget = (repo: string, url?: string | null): RefTarget => ({ kind: "repo", repo, label: short(repo), href: url && GITHUB.test(url) ? url : `https://github.com/${repo}` });

/** A reference from the Senior Engineering Reviewer (ids from src-tauri/src/intel/review.rs). */
export function ecoRefTarget(ref: string, report: EcoReport): RefTarget {
  const text: RefTarget = { kind: "text", label: ref };
  const i = ref.indexOf(":");
  if (i < 0) return text;
  const kind = ref.slice(0, i);
  const rest = ref.slice(i + 1);
  switch (kind) {
    case "agent": {
      const a = report.context.agents.find((x) => x.id === rest);
      return a ? { kind: "agent", id: a.id, label: a.name } : text;
    }
    case "project": {
      const p = report.context.projects.find((x) => x.id === rest);
      return p && REPO.test(p.repository) ? repoTarget(p.repository, findRepo(report, p.repository)?.facts?.url) : text;
    }
    case "repo": {
      const e = findRepo(report, rest);
      return e && REPO.test(e.repo) ? repoTarget(e.repo, e.facts?.url) : text;
    }
    case "alert": {
      // alert:<repo short name>:<dependabot|code_scanning>:<number>
      const [name, k, n] = rest.split(":");
      const e = findRepo(report, name ?? "");
      const ak = asKind(k ?? "");
      const num = Number(n);
      if (!e?.facts || !ak || !Number.isInteger(num)) return text;
      const href = alertUrl(e.facts, ak, num);
      return href ? { kind: "external", href, label: ref } : text;
    }
    case "ci": {
      const e = findRepo(report, rest);
      return e?.facts ? { kind: "external", href: `${e.facts.url}/actions`, label: ref } : text;
    }
    case "wf": {
      const slash = rest.indexOf("/");
      const e = slash > 0 ? findRepo(report, rest.slice(0, slash)) : null;
      const file = rest.slice(slash + 1);
      const scans = e?.checks?.workflows.state === "assessed" ? e.checks.workflows.data : [];
      const w = scans.find((x) => x.file === file);
      if (w?.url && GITHUB.test(w.url)) return { kind: "external", href: w.url, label: ref };
      return e?.facts && w ? { kind: "external", href: `${e.facts.url}/blob/${e.facts.default_branch}/.github/workflows/${file}`, label: ref } : text;
    }
    case "protection": {
      const e = findRepo(report, rest);
      if (!e?.facts) return text;
      // Rulesets live under /rules; classic branch protection under settings.
      const rules = e.checks?.branch_rules.state === "assessed" && e.checks.branch_rules.data.source.includes("rulesets") && !e.checks.branch_rules.data.source.includes("protection");
      return { kind: "external", href: rules ? `${e.facts.url}/rules` : `${e.facts.url}/settings/branches`, label: ref };
    }
    default:
      return text;
  }
}

/** A reference from a Repository Intelligence assessment (ids from src-tauri/src/intel/prompt.rs). */
export function repoRefTarget(ref: string, report: Pick<Report, "facts">): RefTarget {
  const f = report.facts;
  const text: RefTarget = { kind: "text", label: ref };
  if (ref === "readme") return f.docs.readme ? { kind: "external", href: `${f.url}#readme`, label: ref } : text;
  const i = ref.indexOf(":");
  if (i < 0) return text;
  const kind = ref.slice(0, i);
  const rest = ref.slice(i + 1);
  const ok = (href: string | null | undefined): RefTarget => (href && GITHUB.test(href) ? { kind: "external", href, label: ref } : text);
  switch (kind) {
    case "alert": {
      const [k, n] = rest.split(":");
      const ak = asKind(k ?? "");
      return ak && Number.isInteger(Number(n)) ? ok(alertUrl(f, ak, Number(n))) : text;
    }
    case "commit":
      return ok(f.activity.recent.find((c) => c.sha.startsWith(rest))?.url);
    case "pr": {
      const p = f.activity.pr_titles.find((x) => String(x.number) === rest);
      return p ? ok(p.url ?? `${f.url}/pull/${p.number}`) : text;
    }
    case "issue": {
      const list = f.issues.state === "assessed" ? f.issues.data.recent : [];
      const it = list.find((x) => String(x.number) === rest);
      return it ? ok(it.url ?? `${f.url}/issues/${it.number}`) : text;
    }
    case "release": {
      const list = f.releases.state === "assessed" ? f.releases.data : [];
      return ok(list.find((r) => r.tag === rest)?.url);
    }
    case "run":
      return ok(f.ci.workflows.find((w) => String(w.run_id) === rest)?.url);
    case "file":
      return f.root_files.some((n) => n.replace(/\/$/, "") === rest) ? ok(`${f.url}/${f.root_files.includes(`${rest}/`) ? "tree" : "blob"}/${f.default_branch}/${rest}`) : text;
    default:
      return text;
  }
}

type Rec = EcoReview["recommendations"][number];

/**
 * The repositories a recommendation is about: the ones it names, plus the repositories of the
 * agents and alerts it cites. Only repositories that were part of the review count.
 */
export function recRepos(rec: Pick<Rec, "repos" | "evidence">, report: EcoReport): string[] {
  const out: string[] = [];
  const add = (r: string | null | undefined) => {
    if (r && REPO.test(r) && !out.some((x) => x.toLowerCase() === r.toLowerCase())) out.push(r);
  };
  for (const r of rec.repos) add(findRepo(report, r)?.repo);
  for (const ref of rec.evidence) {
    const t = ecoRefTarget(ref, report);
    if (t.kind === "repo") add(t.repo);
    else if (t.kind === "agent") add(report.context.agents.find((a) => a.id === t.id)?.repository);
    else if (ref.startsWith("alert:") || ref.startsWith("ci:") || ref.startsWith("wf:") || ref.startsWith("protection:")) add(findRepo(report, ref.split(":")[1]?.split("/")[0] ?? "")?.repo);
  }
  return out;
}

/** The evidence links worth carrying into an issue: only real GitHub pages. */
export function evidenceLinks(evidence: string[], resolve: (ref: string) => RefTarget): { label: string; url: string }[] {
  return evidence
    .map(resolve)
    .flatMap((t) => (t.kind === "external" || t.kind === "repo" ? [{ label: t.label, url: t.href }] : []))
    .slice(0, 5);
}

export interface Actionable {
  title: string;
  rationale: string;
  firstStep?: string;
  evidence: string[];
}

/** "Fix with Claude" for one AI recommendation in one repository; reuses the existing pre-filled issue flow. */
export function recFixRequest(rec: Actionable, repo: string, source: string, links: { label: string; url: string }[]): FixRequest {
  return {
    marker: recKey(rec.title, repo),
    kind: `${source} recommendation (AI-generated, not verified)`,
    title: rec.title,
    detail: rec.firstStep ? `${rec.rationale} First step: ${rec.firstStep}` : rec.rationale,
    repo,
    links,
  };
}

/**
 * "Open issue": a plain new-issue page in the repository itself, with no label, so no automation
 * picks it up. Opening it sends nothing; Khaneil reads it and presses Create.
 */
export const openIssueTitle = (req: Pick<FixRequest, "title">) => req.title.replace(/\s+/g, " ").trim().slice(0, 120);

export function openIssueUrl(req: FixRequest): string | null {
  if (!REPO.test(req.repo)) return null;
  const body = [
    `From Atlas · **${req.kind}**. Claude wrote this; check it before acting.`,
    "",
    req.detail.replace(/\s+/g, " ").trim().slice(0, 1200),
    "",
    ...(req.links ?? []).filter((l) => GITHUB.test(l.url)).map((l) => `- ${l.label}: ${l.url}`),
    ...markerLine(req.marker),
  ].join("\n");
  const q = new URLSearchParams({ title: openIssueTitle(req), body });
  return `https://github.com/${req.repo}/issues/new?${q.toString()}`;
}

/**
 * A short, stable id for one recommendation in one repository (FNV-1a of title and repo). The same
 * advice in a later review gets the same id, so Atlas can tell it was already acted on.
 */
export function recKey(title: string, repo: string): string {
  const text = `${title.replace(/\s+/g, " ").trim().toLowerCase()}|${repo.trim().toLowerCase()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
