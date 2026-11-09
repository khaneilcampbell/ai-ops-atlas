// Navigation and the plan for each data module (ADR-0005). Pages whose
// source isn't connected yet render from this description, so the owner can
// see what each module will show and what it needs.
import type { Connection } from './api';

export interface ModuleDef {
  path: string;
  label: string;
  icon: string;
  group: 'Business' | 'Systems' | 'Admin' | null;
  sources: Connection['key'][];
  summary: string;
  metrics: { name: string; state: 'live' | 'delayed' | 'estimated' | 'manual'; source: string }[];
}

export const MODULES: ModuleDef[] = [
  { path: '/', label: 'Overview', icon: '◎', group: null, sources: [], summary: 'The state of the business on one screen.', metrics: [] },
  {
    path: '/website', label: 'Website', icon: 'W', group: 'Business', sources: ['cloudflare'],
    summary: 'Traffic to benjaire.com from Cloudflare Web Analytics, which is cookieless and sampled.',
    metrics: [
      { name: 'Visits and page views by day, week and month', state: 'delayed', source: 'Web Analytics (GraphQL)' },
      { name: 'Top pages', state: 'delayed', source: 'Web Analytics (GraphQL)' },
      { name: 'Referrers', state: 'delayed', source: 'Web Analytics (GraphQL)' },
      { name: 'Countries', state: 'delayed', source: 'Web Analytics (GraphQL)' },
      { name: 'Devices and browsers', state: 'delayed', source: 'Web Analytics (GraphQL)' },
      { name: 'Visits in the last 15 minutes (in place of “active visitors”, which has no API)', state: 'estimated', source: 'Web Analytics (GraphQL)' },
    ],
  },
  {
    path: '/products', label: 'Products', icon: 'P', group: 'Business', sources: ['stripe', 'n8n', 'cloudflare'],
    summary: 'Benjaire Flow and future digital products: catalog, sales, refunds, downloads and conversion.',
    metrics: [
      { name: 'Catalog, prices and Payment Links', state: 'delayed', source: 'Stripe' },
      { name: 'Sales, gross revenue, refunds, fees, net revenue', state: 'delayed', source: 'Stripe balance transactions' },
      { name: 'Downloads and delivery status', state: 'delayed', source: 'n8n Ops feed (shop_orders)' },
      { name: 'Product page traffic', state: 'delayed', source: 'Web Analytics, /digital/flow' },
      { name: 'Conversion: checkouts ÷ product page visits', state: 'estimated', source: 'Stripe + Web Analytics' },
      { name: 'Product version', state: 'manual', source: 'n8n Ops feed (shop_files)' },
    ],
  },
  {
    path: '/inquiries', label: 'Inquiries', icon: 'I', group: 'Business', sources: ['n8n', 'cloudflare'],
    summary: 'Contact form and Benjaire Flow intake, as counts and timings only. No names, emails or messages leave n8n.',
    metrics: [
      { name: 'Submissions by day and topic', state: 'delayed', source: 'n8n Ops feed (flow_inquiries)' },
      { name: 'Open, won and closed inquiries', state: 'delayed', source: 'n8n Ops feed' },
      { name: 'Response time: median and 90th percentile', state: 'delayed', source: 'n8n Ops feed (flow_events)' },
      { name: 'Past the reply target', state: 'delayed', source: 'n8n Ops feed' },
      { name: 'contact@ forwarding failures', state: 'delayed', source: 'Cloudflare Email Routing analytics' },
    ],
  },
  { path: '/finance', label: 'Finance', icon: '$', group: 'Business', sources: ['stripe'], summary: '', metrics: [] },
  {
    path: '/automations', label: 'Automations', icon: 'A', group: 'Systems', sources: ['n8n'],
    summary: 'Health of every n8n workflow, with links to the run in n8n. Workflow credentials and payloads never leave n8n.',
    metrics: [
      { name: 'Total, active and inactive workflows', state: 'delayed', source: 'n8n Ops feed' },
      { name: 'Successful and failed runs, duration', state: 'delayed', source: 'n8n Ops feed' },
      { name: 'Last successful run per workflow', state: 'delayed', source: 'n8n Ops feed' },
      { name: 'Failure step and error type, with a link to the run', state: 'delayed', source: 'n8n Ops feed' },
    ],
  },
  {
    path: '/infrastructure', label: 'Infrastructure', icon: 'C', group: 'Systems', sources: ['cloudflare'],
    summary: 'Cloudflare deploys, errors and security for benjaire.com. A reachable API is not counted as a healthy site.',
    metrics: [
      { name: 'Availability: homepage content and security headers, every 5 minutes', state: 'live', source: 'Synthetic check from this Worker' },
      { name: 'Builds and deploys of benjaire-com', state: 'live', source: 'Workers Builds + Deployments API' },
      { name: 'Requests, 4xx and 5xx rates', state: 'delayed', source: 'HTTP analytics (GraphQL)' },
      { name: 'Security events, blocked and challenged requests', state: 'delayed', source: 'Firewall events (GraphQL)' },
      { name: 'Worker errors and usage', state: 'delayed', source: 'Workers analytics (GraphQL)' },
      { name: 'DNS records and changes', state: 'delayed', source: 'DNS API (read only)' },
    ],
  },
  {
    path: '/code', label: 'Code & deploys', icon: 'G', group: 'Systems', sources: ['github'],
    summary: 'Activity in the benjaire.com repository.',
    metrics: [
      { name: 'Recent commits to main', state: 'delayed', source: 'GitHub REST' },
      { name: 'Open pull requests', state: 'delayed', source: 'GitHub REST' },
      { name: 'Site CI status on main', state: 'delayed', source: 'GitHub Actions' },
    ],
  },
  { path: '/connections', label: 'Connections', icon: '⇄', group: 'Admin', sources: [], summary: '', metrics: [] },
  { path: '/audit', label: 'Audit log', icon: '≡', group: 'Admin', sources: [], summary: '', metrics: [] },
];

const RANK: Record<string, number> = { failing: 0, delayed: 1, awaiting_sync: 2, live: 3, not_connected: 4 };

/** The worst state among a module's sources, for the sidebar dot. */
export function moduleState(m: ModuleDef, conns: Connection[] | null): string | null {
  if (!conns || !m.sources.length) return null;
  const states = m.sources.map((k) => conns.find((c) => c.key === k)?.state ?? 'not_connected');
  return states.sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0];
}
