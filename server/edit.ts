// POST /api/edit: the hosted site's version of the Mac app's "propose an edit". It changes one
// text file on a new atlas-edit/ branch and opens a pull request into the default branch, using
// a separate token (GITHUB_EDIT_TOKEN) that only this function reads. The read-only proxy keeps
// its own token. Off until both GITHUB_EDIT_TOKEN and EDIT_REPOS are set.
//
// The page shows the full diff and asks before it calls this; Cloudflare Access has already
// checked who is signed in. Requests must come from the site itself (same origin, JSON, and the
// X-Atlas-Edit header), so another site can't make a signed-in browser send one.

import { owners, type GithubEnv } from "./github";
import { branchName, encodePath, oneLine, pullBody, requestRefusal, MAX_TITLE, type EditOutcome, type EditRequest } from "./editRules";

export interface EditEnv extends GithubEnv {
  /** Fine-grained token with Contents and Pull requests: read and write, on EDIT_REPOS only. */
  GITHUB_EDIT_TOKEN?: string;
  /** Comma-separated owner/name repositories the site may open edit pull requests on. */
  EDIT_REPOS?: string;
}

const noStore = { "cache-control": "no-store" };
const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 20_000;

export function editRepos(env: EditEnv): string[] {
  if (!env.GITHUB_EDIT_TOKEN) return [];
  const allowed = owners(env);
  return (env.EDIT_REPOS ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r && allowed.includes(r.split("/")[0].toLowerCase()));
}

/** What the page needs to know: whether edits are on, and where. Never the token. */
export function editStatus(env: EditEnv): Response {
  const repos = editRepos(env);
  return Response.json({ enabled: repos.length > 0, repos }, { headers: noStore });
}

function outcome(stage: EditOutcome["stage"], reason: string | null, message: string, extra: Partial<EditOutcome> = {}): EditOutcome {
  return { stage, reason, message, pull_number: null, pull_url: null, branch: null, ...extra };
}

const reply = (status: number, o: EditOutcome) => Response.json(o, { status, headers: noStore });

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Gh {
  status: number;
  body: J;
}

function failure(step: string, r: Gh): { reason: string; message: string } | null {
  if (r.status >= 200 && r.status < 300) return null;
  const detail = typeof r.body?.message === "string" ? `: ${r.body.message}` : "";
  if (r.status === 401) return { reason: "token_rejected", message: "GitHub rejected the site's edit token. It may have expired; replace GITHUB_EDIT_TOKEN in Cloudflare." };
  if (r.status === 403 || r.status === 404)
    return { reason: "forbidden", message: `GitHub refused to ${step}${detail}. Check that GITHUB_EDIT_TOKEN has Contents and Pull requests: read and write on this repository.` };
  if (r.status === 409) return { reason: "stale_file", message: `GitHub refused to ${step}${detail}. The file changed on GitHub while you were editing; reload it and try again.` };
  if (r.status === 422) return { reason: "github_refused", message: `GitHub refused to ${step}${detail}.` };
  return { reason: "github_error", message: `GitHub returned ${r.status} when asked to ${step}${detail}.` };
}

function decodeBase64Utf8(b64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Same-origin, JSON, with the site's own header: what a page on another site can't send. */
export function crossSiteRefusal(req: Request): string | null {
  const url = new URL(req.url);
  const origin = req.headers.get("origin");
  if (!origin || origin !== url.origin) return "Edits must come from the Atlas site itself.";
  if (req.headers.get("x-atlas-edit") !== "1") return "Missing the Atlas edit header.";
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return "Edits must be sent as JSON.";
  return null;
}

export async function proposeEdit(req: Request, env: EditEnv, fetcher: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<Response> {
  const cross = crossSiteRefusal(req);
  if (cross) return reply(403, outcome("refused", "cross_site", cross));
  const repos = editRepos(env);
  if (repos.length === 0) return reply(403, outcome("refused", "disabled", "Editing from the website is off. Set GITHUB_EDIT_TOKEN and EDIT_REPOS on the Cloudflare Pages project to turn it on."));

  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply(413, outcome("refused", "too_large", "That edit is too large to send."));
  let body: EditRequest;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, outcome("refused", "invalid_request", "The edit wasn't valid JSON."));
  }
  const bad = requestRefusal(body);
  if (bad) return reply(400, outcome("refused", bad.reason, bad.message));
  const repo = body.repo;
  if (!repos.some((r) => r.toLowerCase() === repo.toLowerCase())) return reply(403, outcome("refused", "repo_not_enabled", `${repo} isn't in EDIT_REPOS, so the website can't edit it.`));

  const gh = async (method: string, path: string, payload?: unknown): Promise<Gh> => {
    const r = await fetcher(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-ops-atlas-web",
        Authorization: `Bearer ${env.GITHUB_EDIT_TOKEN}`,
        ...(payload ? { "Content-Type": "application/json" } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as J };
  };

  // Read-only checks first: the repository, its default branch, and that the file is still the
  // version the person edited.
  let meta: Gh, head: Gh, file: Gh;
  try {
    meta = await gh("GET", "");
    if (meta.status !== 200) return reply(502, outcome("refused", "preflight_failed", `Couldn't read ${repo} from GitHub (status ${meta.status}).`));
    if (String(meta.body.full_name ?? "").toLowerCase() !== repo.toLowerCase()) return reply(409, outcome("refused", "repo_mismatch", "GitHub returned a different repository. It may have been renamed."));
    if (meta.body.archived) return reply(409, outcome("refused", "archived", "This repository is archived."));
    const base = String(meta.body.default_branch ?? "");
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(base) || base.includes("..")) return reply(502, outcome("refused", "preflight_failed", "GitHub didn't report a usable default branch."));
    head = await gh("GET", `/git/ref/heads/${base}`);
    file = await gh("GET", `/contents/${encodePath(body.path)}?ref=${encodeURIComponent(base)}`);
  } catch {
    return reply(502, outcome("refused", "preflight_failed", "Couldn't reach GitHub. Nothing was changed."));
  }
  const base = String(meta.body.default_branch);
  const baseCommit = String(head.body?.object?.sha ?? "");
  if (head.status !== 200 || !/^[0-9a-f]{40}$/i.test(baseCommit)) return reply(502, outcome("refused", "preflight_failed", "GitHub didn't report the default branch's commit."));
  if (file.status === 404) return reply(404, outcome("refused", "not_found", `GitHub can't find ${body.path}.`));
  if (file.status !== 200 || file.body.type !== "file") return reply(409, outcome("refused", "not_a_file", "That path isn't a file."));
  if (String(file.body.sha).toLowerCase() !== body.base_sha.toLowerCase())
    return reply(409, outcome("refused", "stale_file", `${body.path} changed on ${base} since you opened it. Reload it to start from the current version.`));
  const old = decodeBase64Utf8(String(file.body.content ?? ""));
  if (old === null) return reply(409, outcome("refused", "binary", "Only text files can be edited in Atlas."));
  if (old === body.content) return reply(409, outcome("refused", "no_change", "Nothing changed, so there's nothing to send."));

  const title = oneLine(body.title ?? "", MAX_TITLE) || `Edit ${body.path} from Atlas`;
  const branch = branchName(body.path, now());
  const left = (m: string) => `${m} The branch ${branch} was created and can be deleted on GitHub.`;
  try {
    let r = await gh("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseCommit });
    let f = failure("create the branch", r);
    if (f) return reply(502, outcome("failed", f.reason, f.message));
    r = await gh("PUT", `/contents/${encodePath(body.path)}`, { message: title, content: encodeBase64Utf8(body.content), sha: body.base_sha, branch });
    f = failure("commit the file", r);
    if (f) return reply(502, outcome("failed", f.reason, left(f.message), { branch }));
    r = await gh("POST", "/pulls", { title, head: branch, base, body: pullBody(body.note ?? ""), maintainer_can_modify: true });
    f = failure("open the pull request", r);
    if (f) return reply(502, outcome("failed", f.reason, left(f.message), { branch }));
    const number = Number(r.body.number) || null;
    return reply(
      201,
      outcome("opened", null, `Opened pull request #${number} on ${repo} into ${base}. Nothing is merged until you merge it.`, {
        branch,
        pull_number: number,
        pull_url: typeof r.body.html_url === "string" ? r.body.html_url : null,
      }),
    );
  } catch {
    return reply(504, outcome("unknown", "unknown", `GitHub didn't answer in time. It may or may not have created ${branch}; check the repository's branches and pull requests before trying again.`, { branch }));
  }
}
