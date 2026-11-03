// The websites Atlas watches as live properties. Each one belongs to the project building it is
// drawn as, so the building's panel becomes that site's dashboard. The site checks on the server
// (server/properties.ts) only ever look up domains listed here.
//
// This list lives in code rather than in the manifests for now: the server needs it as an
// allowlist, and the command center design (docs/command-center.md) moves buildings to places,
// which is where a `property` resource will be declared later.

/** Where Atlas reads a site's production deploys from. Both are read-only GitHub requests. */
export type DeploySource =
  /** Cloudflare Workers Builds reports each build as a check run on the commit it built. */
  | { kind: "check-runs"; /** Check runs whose name starts with this are the deploy. */ name: string }
  /** GitHub Pages records each publish as a GitHub deployment with statuses. */
  | { kind: "deployments"; environment: string };

export interface WebProperty {
  id: string;
  /** The catalog project whose building shows this dashboard. */
  projectId: string;
  /** Apex domain, lower case. */
  domain: string;
  url: string;
  /** The repository whose default branch deploys the site. */
  repository: string;
  host: string;
  deploy: DeploySource;
  /** The Cloudflare Worker that serves the site, so its changes show in the events tile. */
  cloudflareWorker?: string;
  /** Where KC goes to look at or retry a failed deploy. */
  deployConsole: { label: string; url: string };
}

export const PROPERTIES: readonly WebProperty[] = [
  {
    id: "benjaire-com",
    projectId: "benjaire-site",
    domain: "benjaire.com",
    url: "https://benjaire.com",
    repository: "khaneilcampbell/benjaire.com",
    host: "Cloudflare Workers",
    // Workers Builds deploys main with `npx wrangler deploy` (benjaire.com README) and posts a
    // check run named "Workers Builds: benjaire-com" on the commit.
    deploy: { kind: "check-runs", name: "Workers Builds" },
    cloudflareWorker: "benjaire-com",
    deployConsole: { label: "Cloudflare builds", url: "https://dash.cloudflare.com/?to=/:account/workers/services/view/benjaire-com/production/builds" },
  },
  {
    id: "khaneilcampbell-com",
    projectId: "portfolio-site",
    domain: "khaneilcampbell.com",
    url: "https://khaneilcampbell.com",
    repository: "khaneilcampbell/khaneilcampbell.com",
    host: "GitHub Pages",
    deploy: { kind: "deployments", environment: "github-pages" },
    deployConsole: { label: "GitHub Pages deployments", url: "https://github.com/khaneilcampbell/khaneilcampbell.com/deployments/github-pages" },
  },
];

export const PROPERTY_DOMAINS: readonly string[] = PROPERTIES.map((p) => p.domain);

export const propertyForProject = (projectId: string) => PROPERTIES.find((p) => p.projectId === projectId) ?? null;
export const propertyByDomain = (domain: string) => PROPERTIES.find((p) => p.domain === domain.toLowerCase()) ?? null;
