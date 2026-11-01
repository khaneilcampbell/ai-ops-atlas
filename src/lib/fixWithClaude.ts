/**
 * Fix with Claude: turns one Mission Control item into a pre-filled GitHub issue link. Opening the
 * link sends nothing; KC presses Create in the browser, and the `claude-fix` label starts the
 * Claude Code scheduled task described in ops/fix-with-claude/README.md.
 */

/** Every request lands in Atlas's own repository, so there is one queue, one label and one trigger. */
export const FIX_QUEUE_REPO = "khaneilcampbell/ai-ops-atlas";
export const FIX_LABEL = "claude-fix";

/** GitHub refuses very long new-issue links; stay well under its limit. */
export const MAX_URL = 6000;
const MAX_FIELD = 600;

export interface FixRequest {
  /** What kind of item this is, in plain words ("Failing workflow", "Agent needs attention"). */
  kind: string;
  title: string;
  detail: string;
  /** The repository the fix belongs in (owner/name). */
  repo: string;
  /** Evidence: run, profile or repository links. */
  links?: { label: string; url: string }[];
}

const clip = (s: string, n = MAX_FIELD) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

const REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function fixIssueTitle(r: FixRequest): string {
  return clip(`Fix: ${r.title} (${r.repo})`, 120);
}

export function fixIssueBody(r: FixRequest, now = new Date()): string {
  const links = (r.links ?? []).filter((l) => /^https:\/\//.test(l.url)).slice(0, 5);
  return [
    "Sent from Atlas with **Fix with Claude**. Claude follows `ops/fix-with-claude/prompt.md` and opens one small pull request, or explains here why it stopped. KC merges.",
    "",
    `- **Item:** ${clip(r.kind, 60)}`,
    `- **Title:** ${clip(r.title, 200)}`,
    `- **What Atlas saw:** ${clip(r.detail)}`,
    `- **Repository:** ${REPO.test(r.repo) ? r.repo : "unknown"}`,
    ...links.map((l) => `- **${clip(l.label, 40)}:** ${l.url}`),
    `- **Seen at:** ${now.toISOString()}`,
  ].join("\n");
}

/** The new-issue link, or null when the repository name is not a plain owner/name. */
export function fixIssueUrl(r: FixRequest, now = new Date()): string | null {
  if (!REPO.test(r.repo)) return null;
  const q = new URLSearchParams({ title: fixIssueTitle(r), body: fixIssueBody(r, now), labels: FIX_LABEL });
  const url = `https://github.com/${FIX_QUEUE_REPO}/issues/new?${q.toString()}`;
  if (url.length <= MAX_URL) return url;
  // Too long (many links or a long detail): drop the links, they are the least essential part.
  const short = new URLSearchParams({ title: fixIssueTitle(r), body: fixIssueBody({ ...r, links: [] }, now), labels: FIX_LABEL });
  return `https://github.com/${FIX_QUEUE_REPO}/issues/new?${short.toString()}`;
}
