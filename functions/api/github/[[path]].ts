import { proxyGithub, type GithubEnv } from "../../../server/github";

// GET /api/github/<GitHub REST path>. Read-only: other methods are refused.
export const onRequestGet = async ({ request, env }: { request: Request; env: GithubEnv }) => {
  const url = new URL(request.url);
  return proxyGithub(url.pathname.replace(/^\/api\/github/, ""), url.search, request, env);
};

export const onRequest = () => Response.json({ message: "Read-only." }, { status: 405, headers: { allow: "GET" } });
