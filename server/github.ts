// The read-only GitHub paths the web build may ask for, and nothing else. These match the
// requests src/github makes; anything outside them (writes, other owners, other APIs) is refused.

export interface GithubEnv {
  GITHUB_TOKEN?: string;
  /** Comma-separated owners whose repositories may be read. */
  ALLOWED_OWNERS?: string;
}

const NAME = "[A-Za-z0-9_.-]+";
const REPO_PATH = new RegExp(`^/repos/(${NAME})/(${NAME})(?:/(?:languages|commits|actions/runs|actions/workflows/${NAME}/runs))?$`);
const USER_REPOS = new RegExp(`^/users/(${NAME})/repos$`);

export function owners(env: GithubEnv): string[] {
  return (env.ALLOWED_OWNERS ?? "khaneilcampbell").split(",").map((o) => o.trim().toLowerCase()).filter(Boolean);
}

/** Returns why a path is refused, or null when it may be fetched. */
export function refusal(path: string, env: GithubEnv): string | null {
  if (path.includes("..") || path.includes("//")) return "Path not allowed.";
  if (path === "/user/repos") return env.GITHUB_TOKEN ? null : "No token configured.";
  const m = REPO_PATH.exec(path) ?? USER_REPOS.exec(path);
  if (!m) return "Path not allowed.";
  return owners(env).includes(m[1].toLowerCase()) ? null : "Owner not allowed.";
}

const PASS_HEADERS = ["etag", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "content-type"];

export async function proxyGithub(path: string, search: string, req: Request, env: GithubEnv, fetcher: typeof fetch = fetch): Promise<Response> {
  const refused = refusal(path, env);
  if (refused) return Response.json({ message: refused }, { status: 403, headers: { "cache-control": "no-store" } });

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ai-ops-atlas-web",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  const inm = req.headers.get("if-none-match");
  if (inm) headers["If-None-Match"] = inm;

  const r = await fetcher(`https://api.github.com${path}${search}`, { headers });
  const out = new Headers({ "cache-control": "private, no-store", "x-atlas-authed": env.GITHUB_TOKEN ? "1" : "0" });
  for (const h of PASS_HEADERS) {
    const v = r.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(r.status === 304 ? null : r.body, { status: r.status, headers: out });
}
