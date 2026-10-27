import type { GithubEnv } from "../../server/github";

// Tells the page whether a server-side GitHub token is set, without revealing anything about it.
export const onRequestGet = ({ env }: { env: GithubEnv }) => Response.json({ token: !!env.GITHUB_TOKEN }, { headers: { "cache-control": "no-store" } });
