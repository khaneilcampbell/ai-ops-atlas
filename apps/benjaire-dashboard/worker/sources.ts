// Integration catalog and connection status. Pure, so freshness rules are
// unit-tested. A source is never shown as healthy just because a credential
// exists: it needs a recent successful sync (ADR-0005 §5).

export type SourceKey = 'cloudflare' | 'github' | 'n8n' | 'stripe';

export type ConnectionState = 'not_connected' | 'awaiting_sync' | 'live' | 'delayed' | 'failing';

export interface SourceDef {
  key: SourceKey;
  name: string;
  /** Worker secrets (and vars) that must all be set before the source can run. */
  requires: string[];
  /** Least-privilege access the credential needs. Shown on the Connections page. */
  permissions: string[];
  /** What the dashboard reads from it. */
  provides: string[];
  /** Expected collection interval in minutes. */
  intervalMin: number;
  docs: string;
}

export const SOURCES: SourceDef[] = [
  {
    key: 'cloudflare',
    name: 'Cloudflare',
    requires: ['CF_API_TOKEN', 'CF_ACCOUNT_ID', 'CF_ZONE_ID'],
    permissions: [
      'Account · Account Analytics · Read',
      'Account · Workers Scripts · Read',
      'Account · Workers Builds · Read',
      'Zone (benjaire.com) · Analytics · Read',
      'Zone (benjaire.com) · DNS · Read',
    ],
    provides: ['Website traffic', 'Builds and deploys', 'HTTP errors', 'Security events', 'Worker errors', 'DNS records', 'Email Routing delivery'],
    intervalMin: 5,
    docs: 'https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/',
  },
  {
    key: 'github',
    name: 'GitHub',
    requires: ['GITHUB_TOKEN'],
    permissions: ['Repository khaneilcampbell/benjaire.com only', 'Contents · Read', 'Pull requests · Read', 'Actions · Read', 'Metadata · Read'],
    provides: ['Recent commits', 'Open pull requests', 'Site CI status'],
    intervalMin: 10,
    docs: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token',
  },
  {
    key: 'n8n',
    name: 'n8n',
    requires: ['N8N_FEED_SECRET'],
    permissions: ['Shared signing secret only. No n8n API key is stored here.'],
    provides: ['Workflow health', 'Execution history', 'Inquiry counts and response times', 'Product downloads'],
    intervalMin: 60,
    docs: 'https://docs.n8n.io/',
  },
  {
    key: 'stripe',
    name: 'Stripe',
    requires: ['STRIPE_RESTRICTED_KEY'],
    permissions: ['Restricted key, Read only: Balance, Charges, Refunds, Checkout Sessions, Products, Prices, Payment Links'],
    provides: ['Sales', 'Gross and net revenue', 'Refunds', 'Fees'],
    intervalMin: 15,
    docs: 'https://docs.stripe.com/keys#create-restricted-api-secret-key',
  },
];

export interface LastRun {
  source: string;
  status: 'running' | 'ok' | 'error';
  started_at: string;
  finished_at: string | null;
  last_ok_at: string | null;
}

export interface ConnectionStatus {
  key: SourceKey;
  name: string;
  state: ConnectionState;
  configured: boolean;
  missing: string[];
  last_ok_at: string | null;
  last_error: boolean;
  permissions: string[];
  provides: string[];
  interval_min: number;
  docs: string;
}

/**
 * Live within 2 intervals of the last success, delayed after that, and
 * failing once 6 intervals pass or the latest run errored.
 */
export function connectionStatus(def: SourceDef, env: Record<string, unknown>, run: LastRun | undefined, now: Date = new Date()): ConnectionStatus {
  const missing = def.requires.filter((name) => typeof env[name] !== 'string' || !(env[name] as string).trim());
  const base = {
    key: def.key,
    name: def.name,
    configured: missing.length === 0,
    missing,
    last_ok_at: run?.last_ok_at ?? null,
    last_error: run?.status === 'error',
    permissions: def.permissions,
    provides: def.provides,
    interval_min: def.intervalMin,
    docs: def.docs,
  };
  if (missing.length) return { ...base, state: 'not_connected' };
  if (!run?.last_ok_at) return { ...base, state: run?.status === 'error' ? 'failing' : 'awaiting_sync' };

  const ageMin = (now.getTime() - new Date(run.last_ok_at).getTime()) / 60_000;
  let state: ConnectionState = ageMin <= def.intervalMin * 2 ? 'live' : 'delayed';
  if (run.status === 'error' || ageMin > def.intervalMin * 6) state = 'failing';
  return { ...base, state };
}
