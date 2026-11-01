import { fixIssueUrl, type FixRequest } from "../lib/fixWithClaude";
import { openExternal } from "./bits";
import { Icon } from "./Icon";

/**
 * "Fix with Claude" for one item. A plain link to a pre-filled, labeled GitHub issue: nothing is
 * sent until KC presses Create in the browser, and Claude Code picks the issue up from there
 * (ops/fix-with-claude/README.md). Holds no token, so it works the same on the web and iPhone.
 */
export function FixWithClaude({ request }: { request: FixRequest }) {
  const href = fixIssueUrl(request);
  if (!href) return null;
  return (
    <a
      className="btn small fix-claude"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      title="Opens a pre-filled GitHub issue. After you press Create, Claude reproduces the problem and opens one small pull request for you to merge."
      aria-label={`Fix with Claude: ${request.title}`}
      onClick={(e) => openExternal(e, href)}
    >
      <Icon name="spark" size={12} /> Fix with Claude
    </a>
  );
}
