import { githubGet } from "./transport";

export interface DiscoveredRepo {
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
}

type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toRepo(r: J): DiscoveredRepo {
  return { fullName: r.full_name, private: !!r.private, fork: !!r.fork, archived: !!r.archived };
}

/**
 * Lists every repository owned by the given accounts. Public repositories come from the
 * account's public list; with a token, /user/repos adds the private ones you own.
 */
export async function discoverRepos(owners: string[], withToken: boolean): Promise<DiscoveredRepo[]> {
  const wanted = new Set(owners.map((o) => o.toLowerCase()));
  const lists = await Promise.all([
    ...owners.map((o) => githubGet(`/users/${encodeURIComponent(o)}/repos?type=owner&per_page=100&sort=pushed`) as Promise<J[]>),
    ...(withToken ? [githubGet("/user/repos?affiliation=owner&per_page=100&sort=pushed") as Promise<J[]>] : []),
  ]);
  const byName = new Map<string, DiscoveredRepo>();
  for (const r of lists.flat().map(toRepo)) {
    if (wanted.has(r.fullName.split("/")[0].toLowerCase())) byName.set(r.fullName.toLowerCase(), r);
  }
  return [...byName.values()];
}
