// Integration contracts: one standard description of every data source a module can connect to.
// A module type names its connectors by these ids (catalog.ts), and integrations.test.ts checks
// that every named connector has a contract and that each contract's code exists.
//
// Rule for every contract, current and future: credentials never live in the web view. They are
// held by the desktop shell (the Keychain, read only by Rust) or by the hosted site's server
// functions. Anything that writes is authorized there, not in the page.

export const INTEGRATION_IDS = ["github", "agent-feed", "live-feed", "atlas-intel", "usage-sync", "n8n", "github-security"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];

/** Where an integration's credentials are held. "none" means it needs none to read. */
export type CredentialHolder = "desktop-keychain" | "site-server" | "none";

export interface IntegrationContract {
  id: IntegrationId;
  version: string;
  label: string;
  /** The data Atlas reads from it, in plain words. */
  provides: string[];
  /** Every integration is read-only today; write actions go through src/actions with approval. */
  access: "read";
  /** Where credentials are held on the Mac app and on the hosted site. */
  credentials: { desktop: CredentialHolder; web: CredentialHolder };
  /** The client code that talks to it (checked to exist). */
  client: string;
}

const V = "1.0.0";

const CONTRACTS: IntegrationContract[] = [
  {
    id: "github", version: V, label: "GitHub",
    provides: ["Repository metadata", "Commits", "Workflow runs and CI status", "Open issues and pull requests"],
    access: "read", credentials: { desktop: "desktop-keychain", web: "site-server" }, client: "src/github/transport.ts",
  },
  {
    id: "agent-feed", version: V, label: "Agent reports feed",
    provides: ["Phase results reported by pipelines outside Atlas"],
    access: "read", credentials: { desktop: "desktop-keychain", web: "site-server" }, client: "src/live/feed.ts",
  },
  {
    id: "live-feed", version: V, label: "Live updates",
    provides: ["GitHub webhook events", "Agent runs recorded by the Mac app"],
    access: "read", credentials: { desktop: "desktop-keychain", web: "site-server" }, client: "src/live/feed.ts",
  },
  {
    id: "atlas-intel", version: V, label: "Atlas Intel",
    provides: ["Repository Intelligence runs and reports", "Engineering review findings"],
    access: "read", credentials: { desktop: "desktop-keychain", web: "site-server" }, client: "src/intel/api.ts",
  },
  {
    id: "usage-sync", version: V, label: "API usage sync",
    provides: ["Recorded AI and API usage", "Estimated spend"],
    access: "read", credentials: { desktop: "desktop-keychain", web: "site-server" }, client: "src/usage/sync.ts",
  },
  {
    id: "n8n", version: V, label: "n8n",
    provides: ["Workflow names and whether each is switched on", "Recent run status and times"],
    // The read-only n8n API key is a site secret on both: the Mac app asks the site with its sync key.
    access: "read", credentials: { desktop: "site-server", web: "site-server" }, client: "src/n8n/runs.ts",
  },
  {
    id: "github-security", version: V, label: "GitHub security alerts",
    provides: ["Open Dependabot, code scanning and secret scanning alert counts", "Alert severities"],
    // The site's GITHUB_TOKEN reads alerts on both; the Mac app asks the site with its sync key, so alert reads never use the Mac's token.
    access: "read", credentials: { desktop: "site-server", web: "site-server" }, client: "src/security/alerts.ts",
  },
];

export const INTEGRATIONS: Readonly<Record<IntegrationId, IntegrationContract>> = Object.fromEntries(CONTRACTS.map((c) => [c.id, c])) as Record<IntegrationId, IntegrationContract>;
export const INTEGRATION_SOURCE: readonly IntegrationContract[] = CONTRACTS;

export function isIntegration(id: unknown): id is IntegrationId {
  return typeof id === "string" && (INTEGRATION_IDS as readonly string[]).includes(id);
}

export function integrationLabel(id: string): string {
  return isIntegration(id) ? INTEGRATIONS[id].label : id;
}
