import type { Deploy } from "../properties/deploys";
import { PROPERTIES, type DeploySource } from "../properties/registry";

// Where this workspace's software runs, and where Atlas reads each one's production deploys from.
// The websites come from the property registry (their dashboards already poll them). Atlas itself
// is added here, not to the registry, because the registry is the site checks' server allowlist.

export interface HostTarget {
  id: string;
  name: string;
  /** "Cloudflare Workers", "GitHub Pages"… */
  host: string;
  /** The repository whose default branch it deploys from. */
  repository: string;
  deploy: DeploySource;
  /** Where KC goes to look at or retry a deploy. */
  console: { label: string; url: string };
  /** Set when a website dashboard already polls this host's deploys. */
  propertyId?: string;
}

export const ATLAS_REPOSITORY = "khaneilcampbell/ai-ops-atlas";

export const HOSTS: readonly HostTarget[] = [
  ...PROPERTIES.map((p): HostTarget => ({ id: p.id, name: p.domain, host: p.host, repository: p.repository, deploy: p.deploy, console: p.deployConsole, propertyId: p.id })),
  {
    id: "atlas-web",
    name: "Atlas web",
    host: "Cloudflare Pages",
    repository: ATLAS_REPOSITORY,
    // The Pages GitHub integration posts a "Cloudflare Pages" check run on each commit it builds.
    deploy: { kind: "check-runs", name: "Cloudflare Pages" },
    console: { label: "Cloudflare Pages deployments", url: "https://dash.cloudflare.com/?to=/:account/pages/view/ai-ops-atlas" },
  },
  {
    id: "atlas-mac",
    name: "Atlas Mac app",
    host: "Signed update on GitHub Releases",
    repository: ATLAS_REPOSITORY,
    // CI's last main job signs the build and publishes it as the main-build release.
    deploy: { kind: "check-runs", name: "Publish signed main build", ignoreSkipped: true },
    console: { label: "main-build release", url: `https://github.com/${ATLAS_REPOSITORY}/releases/tag/main-build` },
  },
];

export type HostHealth = "live" | "failing" | "deploying" | "unknown";

export interface HostStatus {
  health: HostHealth;
  /** The newest deploy that finished or is running (cancelled ones are passed over). */
  latest: Deploy | null;
  /** The newest successful deploy: what is being served now, as far as Atlas has seen. */
  live: Deploy | null;
}

/**
 * A host's state from its newest deploys. Only what was observed counts: with no deploy seen it is
 * unknown, never live. A failed newest deploy means the previous version is still being served.
 */
export function hostStatus(deploys: readonly Deploy[] | null): HostStatus {
  const list = [...(deploys ?? [])].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).filter((d) => d.state !== "cancelled");
  const latest = list[0] ?? null;
  const live = list.find((d) => d.state === "success") ?? null;
  const health: HostHealth = !latest ? "unknown" : latest.state === "failure" ? "failing" : latest.state === "success" ? "live" : "deploying";
  return { health, latest, live };
}

/** Every host's deploys in one list, newest first, labelled with the host. */
export function recentDeploys(byHost: ReadonlyMap<string, readonly Deploy[] | null>, limit = 8): (Deploy & { hostId: string; hostName: string })[] {
  return HOSTS.flatMap((h) => (byHost.get(h.id) ?? []).map((d) => ({ ...d, hostId: h.id, hostName: h.name })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}
