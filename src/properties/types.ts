// What the site checks return (server/properties.ts), shared by the server and the page.
//
// Every check says where its answer came from and when. A check that can't run says why
// (`error`) or what it needs (`not-configured`); none of them fills a gap with a guess.

export type Check<T> =
  | { state: "ok"; source: string; checkedAt: string; data: T }
  | { state: "error"; source: string; checkedAt: string; message: string }
  | { state: "not-configured"; source: string; need: string };

export interface DomainInfo {
  registrar: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  /** EPP status codes, e.g. "client transfer prohibited". */
  status: string[];
  nameservers: string[];
  /** The registry says the delegation is DNSSEC-signed. Null when it didn't say. */
  dnssec: boolean | null;
}

export interface DnsInfo {
  a: string[];
  aaaa: string[];
  ns: string[];
  mx: string[];
  caa: string[];
  /** What www.<domain> answers with (CNAME target or addresses). */
  www: string[];
  /** The resolver validated DNSSEC for the apex A answer. */
  validated: boolean;
}

export interface TlsInfo {
  issuer: string | null;
  notBefore: string;
  notAfter: string;
  /** Names on the certificate. */
  names: string[];
  /** Unexpired certificates logged for the domain; several is normal during a renewal. */
  current: number;
}

export interface ProbeInfo {
  /** HTTP status of the final response, after redirects. */
  status: number;
  ms: number;
  finalUrl: string;
  /** Answered through Cloudflare's network (cf-ray header present). */
  cloudflare: boolean;
  hsts: boolean;
}

export interface PerfInfo {
  strategy: "mobile";
  /** Lighthouse performance score, 0 to 100. */
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  /** Real-user field data from the Chrome UX Report; null when the site has too little traffic. */
  field: { lcpP75: number | null; inpP75: number | null; clsP75: number | null; overall: string | null } | null;
  reportUrl: string;
}

export interface TrafficInfo {
  requests24h: number;
  /** Page views (Cloudflare can't sum unique visitors across hours). */
  visits24h: number | null;
  threats24h: number | null;
}

export interface UptimeInfo {
  /** Percent over the window the status page reports. */
  uptime24h: number | null;
  up: boolean | null;
  lastChange: string | null;
}

export interface EdgeEvent {
  at: string;
  action: string;
  actor: string | null;
}

export interface SiteSnapshot {
  domain: string;
  checks: {
    domain: Check<DomainInfo>;
    dns: Check<DnsInfo>;
    tls: Check<TlsInfo>;
    probe: Check<ProbeInfo>;
    performance: Check<PerfInfo>;
    /** Cloudflare analytics: requests, visits, threats. Needs a read-only API token. */
    traffic: Check<TrafficInfo>;
    /** Cloudflare audit log: DNS, rule and deploy changes. Needs the same token. */
    edgeEvents: Check<EdgeEvent[]>;
    /** Uptime history from a self-hosted Uptime Kuma status page. */
    uptime: Check<UptimeInfo>;
  };
}

export type CheckName = keyof SiteSnapshot["checks"];
