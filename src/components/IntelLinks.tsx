import { useAtlas } from "../state";
import type { RefTarget } from "../intel/links";
import { openIssueUrl } from "../intel/links";
import type { FixRequest } from "../lib/fixWithClaude";
import { ExternalLink } from "./bits";
import { FixWithClaude } from "./FixWithClaude";
import { Icon } from "./Icon";

/**
 * Claude's citations, each linked to what it names: agents and repositories open inside Atlas,
 * alerts, workflows and files open on GitHub. Ids that match no fact stay plain text.
 */
export function RefLinks({ refs, grounded, resolve }: { refs: string[]; grounded: boolean; resolve?: (ref: string) => RefTarget }) {
  const { select } = useAtlas();
  if (!grounded) return <span className="ref ungrounded">no supporting reference</span>;
  return (
    <>
      {refs.map((r) => {
        const t = resolve ? resolve(r) : ({ kind: "text", label: r } as RefTarget);
        if (t.kind === "agent")
          return (
            <button key={r} type="button" className="ref ref-link" title={`Open agent ${t.label} (${r})`} onClick={() => select({ kind: "agent", id: t.id })}>
              {t.label}
            </button>
          );
        if (t.kind === "repo")
          return (
            <button key={r} type="button" className="ref ref-link" title={`Open repository ${t.repo}`} onClick={() => select({ kind: "repo", id: t.repo })}>
              {r}
            </button>
          );
        if (t.kind === "external")
          return (
            <ExternalLink key={r} href={t.href} className="ref ref-link">
              {r}
            </ExternalLink>
          );
        return (
          <span key={r} className="ref">
            {r}
          </span>
        );
      })}
    </>
  );
}

/** A repository chip that opens the repository inside Atlas. */
export function RepoLink({ repo }: { repo: string }) {
  const { select } = useAtlas();
  return (
    <button type="button" className="chip chip-link" title={`Open ${repo}`} onClick={() => select({ kind: "repo", id: repo })}>
      {repo.split("/").pop()}
    </button>
  );
}

/**
 * Hand-off for one recommendation: "Fix with Claude" (the existing labeled-issue flow) and a plain
 * "Open issue" in the repository. Both are links to GitHub's new-issue page; nothing is sent or
 * changed until KC presses Create there.
 */
export function RecActions({ requests, reason }: { requests: FixRequest[]; reason?: string }) {
  if (!requests.length) return reason ? <div className="muted small">{reason}</div> : null;
  const many = requests.length > 1;
  return (
    <div className="rec-actions">
      {requests.map((req) => {
        const issue = openIssueUrl(req);
        return (
          <span key={req.repo} className="rec-action">
            {many && <span className="muted small">{req.repo.split("/").pop()}:</span>}
            <FixWithClaude request={req} />
            {issue && (
              <ExternalLink href={issue} className="btn small open-issue">
                <Icon name="external" size={12} /> Open issue
              </ExternalLink>
            )}
          </span>
        );
      })}
    </div>
  );
}
