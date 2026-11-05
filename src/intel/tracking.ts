/**
 * What happened to a recommendation after KC pressed Fix with Claude or Open issue. Atlas never
 * creates those issues itself, so it finds them again with read-only GitHub GETs: by the hidden
 * `atlas-rec:<id>` line Atlas puts in the issue body, or by the exact title it pre-filled. A fix
 * pull request is found from the issue's timeline (Claude's PR says "Fixes #N").
 */
import { githubGet } from "../github/transport";
import { FIX_LABEL, FIX_QUEUE_REPO, fixIssueTitle, type FixRequest } from "../lib/fixWithClaude";
import { openIssueTitle } from "./links";

export interface GhIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  state_reason?: string | null;
  html_url: string;
  created_at: string;
  pull_request?: { merged_at?: string | null } | null;
}

export interface LinkedPr {
  number: number;
  repo: string;
  url: string;
  state: "open" | "merged" | "closed";
}

export interface Tracked {
  /** "fix": the labeled Fix with Claude issue in the Atlas queue; "issue": a plain issue in the repository; "codex": a pull request from a pasted Codex prompt. */
  via: "fix" | "issue" | "codex";
  repo: string;
  number: number;
  url: string;
  state: "open" | "closed";
  stateReason: string | null;
  pr: LinkedPr | null;
}

const markerOf = (key: string) => `atlas-rec:${key}`;

/** The newest real issue (not a pull request) that carries the marker or the exact pre-filled title. */
export function findIssue(issues: GhIssue[], key: string, title: string): GhIssue | null {
  const want = title.trim().toLowerCase();
  const hits = issues.filter((i) => !i.pull_request && ((i.body ?? "").includes(markerOf(key)) || i.title.trim().toLowerCase() === want));
  hits.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return hits[0] ?? null;
}

/** The newest pull request whose body carries the marker (a Codex fix from a copied prompt). */
export function findPr(items: GhIssue[], key: string): GhIssue | null {
  const hits = items.filter((i) => i.pull_request && (i.body ?? "").includes(markerOf(key)));
  hits.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return hits[0] ?? null;
}

interface TimelineEvent {
  event?: string;
  source?: { issue?: { number?: number; html_url?: string; state?: string; pull_request?: { merged_at?: string | null } | null; repository?: { full_name?: string } } };
}

/** The pull request that references the issue, preferring merged, then open. */
export function linkedPr(events: TimelineEvent[]): LinkedPr | null {
  const prs: LinkedPr[] = [];
  for (const e of events) {
    const i = e.event === "cross-referenced" ? e.source?.issue : undefined;
    if (!i?.pull_request || typeof i.number !== "number" || !i.html_url) continue;
    const repo = i.repository?.full_name ?? i.html_url.replace(/^https:\/\/github\.com\//, "").split("/pull/")[0];
    prs.push({ number: i.number, repo, url: i.html_url, state: i.pull_request.merged_at ? "merged" : i.state === "open" ? "open" : "closed" });
  }
  const rank = { merged: 0, open: 1, closed: 2 } as const;
  prs.sort((a, b) => rank[a.state] - rank[b.state]);
  return prs[0] ?? null;
}

const short = (r: string) => r.split("/").pop() ?? r;
const ref = (repo: string, n: number, here: string) => (repo.toLowerCase() === here.toLowerCase() ? `#${n}` : `${short(repo)}#${n}`);

/** One plain line for a tracked item, and whether the advice counts as handled. */
export function trackedLabel(t: Tracked, recRepo: string): { text: string; url: string; done: boolean } {
  if (t.pr?.state === "merged") return { text: `Fixed in PR ${ref(t.pr.repo, t.pr.number, recRepo)}`, url: t.pr.url, done: true };
  if (t.pr?.state === "open") return { text: `${t.via === "codex" ? "Codex PR" : "PR"} ${ref(t.pr.repo, t.pr.number, recRepo)} open`, url: t.pr.url, done: false };
  if (t.via === "codex") return { text: `Codex PR ${ref(t.repo, t.number, recRepo)} closed without merging`, url: t.url, done: false };
  const issue = `${t.via === "fix" ? "Fix request" : "Issue"} ${ref(t.repo, t.number, recRepo)}`;
  if (t.state === "open") return { text: `${issue} open`, url: t.url, done: false };
  if (t.stateReason === "not_planned") return { text: `${issue} closed as not planned`, url: t.url, done: true };
  return { text: `${issue} closed`, url: t.url, done: true };
}

export type TrackingResult = { byKey: Record<string, Tracked[]>; error: string | null };

const MAX_TIMELINES = 20;

/** Reads the issue lists once per repository and matches every request against them. GET only. */
export async function loadTracking(requests: FixRequest[], get: (path: string) => Promise<unknown> = (p) => githubGet(p, { cache: false })): Promise<TrackingResult> {
  const lists = new Map<string, Promise<GhIssue[]>>();
  const errors: string[] = [];
  const list = (path: string) => {
    if (!lists.has(path))
      lists.set(
        path,
        get(path).then(
          (b) => (Array.isArray(b) ? (b as GhIssue[]) : []),
          (e) => {
            errors.push(String(e instanceof Error ? e.message : e));
            return [];
          },
        ),
      );
    return lists.get(path)!;
  };
  const queuePath = `/repos/${FIX_QUEUE_REPO}/issues?labels=${FIX_LABEL}&state=all&per_page=100`;
  const byKey: Record<string, Tracked[]> = {};
  const found: Tracked[] = [];
  for (const req of requests) {
    if (!req.marker || byKey[req.marker]) continue;
    const [queue, own] = await Promise.all([list(queuePath), list(`/repos/${req.repo}/issues?state=all&per_page=100`)]);
    const out: Tracked[] = [];
    const fix = findIssue(queue, req.marker, fixIssueTitle(req));
    if (fix) out.push({ via: "fix", repo: FIX_QUEUE_REPO, number: fix.number, url: fix.html_url, state: fix.state, stateReason: fix.state_reason ?? null, pr: null });
    const issue = findIssue(own, req.marker, openIssueTitle(req));
    if (issue && !(req.repo.toLowerCase() === FIX_QUEUE_REPO && fix?.number === issue.number))
      out.push({ via: "issue", repo: req.repo, number: issue.number, url: issue.html_url, state: issue.state, stateReason: issue.state_reason ?? null, pr: null });
    const pr = findPr(own, req.marker);
    if (pr)
      out.push({ via: "codex", repo: req.repo, number: pr.number, url: pr.html_url, state: pr.state, stateReason: null, pr: { number: pr.number, repo: req.repo, url: pr.html_url, state: pr.pull_request?.merged_at ? "merged" : pr.state === "open" ? "open" : "closed" } });
    byKey[req.marker] = out;
    found.push(...out);
  }
  await Promise.all(
    found.filter((t) => t.via !== "codex").slice(0, MAX_TIMELINES).map(async (t) => {
      try {
        const events = await get(`/repos/${t.repo}/issues/${t.number}/timeline?per_page=100`);
        t.pr = Array.isArray(events) ? linkedPr(events as TimelineEvent[]) : null;
      } catch {
        // The issue itself is still shown; only the PR link is missing.
      }
    }),
  );
  return { byKey, error: errors.length ? [...new Set(errors)].join("; ") : null };
}
