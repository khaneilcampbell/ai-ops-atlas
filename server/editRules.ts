// The rules every in-app edit follows, shared by the page (to explain a refusal early), the
// hosted site's /api/edit function, and mirrored in src-tauri/src/actions/edit.rs for the Mac
// app. An edit changes one text file on a new atlas-edit/ branch and opens a pull request into
// the default branch. Nothing here can write to the default branch or merge.

export const EDIT_BRANCH_PREFIX = "atlas-edit/";
/** Large enough for any README or config file, small enough to review in the app. */
export const MAX_FILE_BYTES = 512 * 1024;
const MAX_PATH = 300;
export const MAX_TITLE = 120;
export const MAX_NOTE = 2000;

const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const SEGMENT_RE = /^[A-Za-z0-9\-_.@+ ]+$/;

export function validRepo(repo: string): boolean {
  return REPO_RE.test(repo) && !repo.endsWith("/.") && !repo.endsWith("/..");
}

/**
 * A repository-relative file path the editor may change. Plain segments only, nothing inside
 * `.git`, and no workflow files: those run with the repository's secrets and need a broader token.
 */
export function validPath(path: string): boolean {
  if (!path || path.length > MAX_PATH || path.startsWith("/") || path.endsWith("/")) return false;
  const ok = path.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && seg.toLowerCase() !== ".git" && SEGMENT_RE.test(seg));
  return ok && !path.toLowerCase().startsWith(".github/workflows/");
}

/** Why a path can't be edited, in words, or null when it can. */
export function pathRefusal(path: string): string | null {
  if (path.toLowerCase().startsWith(".github/workflows/")) return "Workflow files can't be edited in Atlas: they run with the repository's secrets.";
  return validPath(path) ? null : "Atlas can't edit that path. Use letters, digits, spaces and - _ . @ + in each part.";
}

export function encodePath(path: string): string {
  return path
    .split("/")
    .map((seg) => seg.replace(/ /g, "%20").replace(/@/g, "%40").replace(/\+/g, "%2B"))
    .join("/");
}

export const validSha = (sha: string) => /^[0-9a-f]{40}$/i.test(sha);

/** `atlas-edit/<file-name>-<UTC time>`, unique per second and per file. */
export function branchName(path: string, now: Date): string {
  const file = path.split("/").pop() ?? path;
  const slug =
    file
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "file";
  const t = now.toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "-");
  return `${EDIT_BRANCH_PREFIX}${slug}-${t}`;
}

export function oneLine(text: string, max: number): string {
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, max);
}

export function pullBody(note: string): string {
  const n = note.trim().slice(0, MAX_NOTE);
  return `${n ? `${n}\n\n` : ""}Opened from the AI Ops Atlas editor. One file changed; nothing was merged.`;
}

/** What the page sends to propose an edit. */
export interface EditRequest {
  repo: string;
  path: string;
  /** The blob sha of the file the person edited, as GitHub reported it. */
  base_sha: string;
  content: string;
  title?: string | null;
  note?: string | null;
}

export type EditStage = "refused" | "cancelled" | "attempted" | "opened" | "failed" | "unknown";

export interface EditOutcome {
  stage: EditStage;
  reason: string | null;
  message: string;
  audit_id?: string;
  pull_number: number | null;
  pull_url: string | null;
  branch: string | null;
}

/** Problems with the request itself, before anything is read from GitHub. */
export function requestRefusal(req: EditRequest): { reason: string; message: string } | null {
  if (!validRepo(req.repo)) return { reason: "invalid_repo", message: "That isn't a valid owner/name repository." };
  const p = pathRefusal(req.path);
  if (p) return { reason: "invalid_path", message: p };
  if (!validSha(req.base_sha)) return { reason: "invalid_request", message: "The editor didn't say which version of the file it changed." };
  if (typeof req.content !== "string") return { reason: "invalid_request", message: "The new text is missing." };
  if (new TextEncoder().encode(req.content).length > MAX_FILE_BYTES) return { reason: "too_large", message: `Files over ${MAX_FILE_BYTES / 1024} KB can't be edited in Atlas.` };
  if (req.content.includes("\0")) return { reason: "binary", message: "Only text files can be edited in Atlas." };
  return null;
}
