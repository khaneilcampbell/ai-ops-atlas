import type { HealthCheck, HealthLoad, HealthReport } from "../observability/health";

// Integration Center: one list of the services Atlas really talks to, with a status that only says
// Connected when a credential is set, and only claims "verified" when a real authenticated request
// succeeded (the site's health report, a GitHub sync, a Repository Intelligence run). Nothing here
// stores or reads a secret: the Mac app keeps keys in the Keychain (Rust side) and the hosted site
// keeps them as Cloudflare secrets, and the page only learns whether each one is set.

export type Platform = "desktop" | "web" | "local";
export type IntegrationStatus = "connected" | "disconnected" | "degraded" | "configuration_required" | "unsupported";

export const STATUS_LABEL: Record<IntegrationStatus, string> = {
  connected: "Connected",
  disconnected: "Disconnected",
  degraded: "Degraded",
  configuration_required: "Configuration Required",
  unsupported: "Unsupported",
};
export const STATUS_DOT: Record<IntegrationStatus, string> = { connected: "h-good", disconnected: "h-bad", degraded: "h-warn", configuration_required: "h-unknown", unsupported: "h-unknown" };

/**
 * What the card shows. A key that is set but that no real check has reached yet is not called
 * "Connected": it reads "Key set · not verified" with a neutral dot. It still counts as usable
 * for workflows (`usable`), because Atlas won't spend money or send email just to test a key.
 */
export function statusBadge(s: Pick<IntegrationState, "status" | "verifiedAt">): { label: string; dot: string } {
  if (s.status === "connected" && !s.verifiedAt) return { label: "Key set · not verified", dot: "h-unknown" };
  return { label: STATUS_LABEL[s.status], dot: STATUS_DOT[s.status] };
}

/** Where a person sets the credential up. `keychain` ones can be set from inside the Mac app. */
export type SetupKind = "keychain-github" | "keychain-anthropic" | "site-secret" | "settings-sync";

export interface IntegrationDef {
  id: string;
  label: string;
  category: "code" | "automation" | "hosting" | "ai-model" | "payments" | "notifications" | "atlas";
  description: string;
  /** What Atlas may do with it. Every integration is read-only unless a line says otherwise. */
  permissions: string[];
  platforms: Platform[];
  setup: Partial<Record<Platform, { kind: SetupKind; steps: string[] }>>;
  /** Existing client code that talks to it. */
  adapter: string;
}

const SITE_SECRETS = "Cloudflare dashboard > Workers & Pages > ai-ops-atlas > Settings > Variables and Secrets";

export const INTEGRATION_CATALOG: readonly IntegrationDef[] = [
  {
    id: "github",
    label: "GitHub",
    category: "code",
    description: "Repositories, commits, CI runs, issues and pull requests for every building on the map.",
    permissions: ["Read repository metadata, commits and workflow runs", "Read open issues and pull requests", "No writes: write actions need their own token and Touch ID"],
    platforms: ["desktop", "web", "local"],
    setup: {
      desktop: { kind: "keychain-github", steps: ["Create a fine-grained GitHub token with read-only Contents, Metadata and Actions access.", "Paste it here. It goes straight to the macOS Keychain; the page never keeps it."] },
      web: { kind: "site-secret", steps: [`Add GITHUB_TOKEN (read-only) in ${SITE_SECRETS}.`, "Redeploy the site, then press Check again."] },
      local: { kind: "site-secret", steps: ["The local preview reads public repositories only. Use the Mac app or the hosted site for private ones."] },
    },
    adapter: "src/github/transport.ts",
  },
  {
    id: "n8n",
    label: "n8n",
    category: "automation",
    description: "Workflow list, run status, and the restricted Step Runner that carries out allow-listed workflow steps.",
    permissions: ["Read workflows and executions (read-only API key)", "Start six allow-listed Step Runner steps, at most 20 a day", "Workflow model calls use the Anthropic credential held in n8n"],
    platforms: ["desktop", "web"],
    setup: {
      desktop: { kind: "settings-sync", steps: ["n8n keys live on the hosted site. Link this Mac to the site in Settings > Website sync, then set them there."] },
      web: { kind: "site-secret", steps: [`Add N8N_API_KEY (read-only) in ${SITE_SECRETS}.`, "For workflow steps, add N8N_BRIDGE_TOKEN and N8N_BRIDGE_CALLBACK_TOKEN and set the same values on the n8n credentials.", "Redeploy, then press Check again."] },
    },
    adapter: "src/n8n/runs.ts, src/execution/bridgeClient.ts",
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    category: "hosting",
    description: "Hosts the web version (Pages), the live database (D1), sign-in (Access) and website analytics.",
    permissions: ["Serve the site and store live events (D1)", "Verify every signed-in request (Access)", "Read website analytics (read-only token)"],
    platforms: ["desktop", "web"],
    setup: {
      desktop: { kind: "settings-sync", steps: ["Link this Mac to the hosted site in Settings > Website sync so Atlas can read the site's health."] },
      web: { kind: "site-secret", steps: [`Check ACCESS_TEAM_DOMAIN, ACCESS_AUD and ALLOWED_EMAILS in ${SITE_SECRETS}.`, "For website analytics add CLOUDFLARE_API_TOKEN (Analytics read only)."] },
    },
    adapter: "server/health.ts, server/cloudflare.ts",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    category: "ai-model",
    description: "Claude for Repository Intelligence and the Engineering Reviewer in the Mac app.",
    permissions: ["Send repository summaries to Claude for reviews you start or schedule", "Spend within the monthly cap set in Intel settings"],
    platforms: ["desktop"],
    setup: {
      desktop: { kind: "keychain-anthropic", steps: ["Create an Anthropic API key with a spend limit.", "Paste it here. It goes straight to the macOS Keychain; the page never keeps it."] },
    },
    adapter: "src/intel/api.ts (Rust: src-tauri/src/intel/claude.rs)",
  },
  {
    id: "stripe",
    label: "Stripe (via n8n)",
    category: "payments",
    description: "Paid checkouts, refunds and fees for the Business tab, read through the Atlas · Sales feed n8n workflow.",
    permissions: ["Read paid checkouts, refunds and fees (restricted read key held in n8n)", "No buyer details, no refunds or charges from Atlas"],
    platforms: ["desktop", "web"],
    setup: {
      desktop: { kind: "settings-sync", steps: ["Stripe is read through n8n with the site's Step Runner keys. Set those up first (see n8n)."] },
      web: { kind: "site-secret", steps: ["Publish the Atlas · Sales feed workflow in n8n with a restricted Stripe read key.", "The site uses N8N_BRIDGE_TOKEN to start it. Sync from Business > Finance to verify."] },
    },
    adapter: "src/business/stripeClient.ts",
  },
  {
    id: "email-alerts",
    label: "Email alerts (Resend)",
    category: "notifications",
    description: "Emails you when an agent fails or goes silent.",
    permissions: ["Send alert emails to the one address you set"],
    platforms: ["desktop", "web"],
    setup: {
      desktop: { kind: "settings-sync", steps: ["Alert email is sent by the hosted site. Set it up there."] },
      web: { kind: "site-secret", steps: [`Add RESEND_API_KEY and ALERT_EMAIL_TO in ${SITE_SECRETS}.`] },
    },
    adapter: "server/alerts.ts",
  },
  {
    id: "atlas-site",
    label: "Atlas site link",
    category: "atlas",
    description: "Lets the Mac app read the hosted site's health, n8n runs and reports with its sync key.",
    permissions: ["Read the site's reports and health", "Push this Mac's usage records"],
    platforms: ["desktop"],
    setup: { desktop: { kind: "settings-sync", steps: ["Open Settings > Website sync, enter the site address and make a key.", "Paste the key into the site's USAGE_SYNC_TOKEN secret."] } },
    adapter: "src/usage/sync.ts",
  },
];

/** Asked for often, not built. Listed so nobody mistakes them for working connections. */
export const NOT_SUPPORTED: readonly { id: string; label: string; reason: string }[] = [
  { id: "openai", label: "OpenAI", reason: "No model adapter. Atlas routes model work to Claude only." },
  { id: "google-gemini", label: "Google Gemini", reason: "No model adapter." },
  { id: "slack", label: "Slack", reason: "No notification adapter; alerts go by email." },
  { id: "shopify-direct", label: "Shopify (direct)", reason: "Publishing runs only from Khaneil's approval form in n8n, never from Atlas." },
];

export interface ProbeInput {
  platform: Platform;
  health: HealthLoad;
  /** Null while unknown. */
  githubToken: boolean | null;
  github: { loaded: number; failing: number; lastFetched: string | null; reasons: string[] };
  anthropicKey: boolean | null;
  /** Latest finished Repository Intelligence run, if any. */
  intelLast: { at: string; ok: boolean; error?: string } | null;
  siteLinked: boolean | null;
}

export interface IntegrationState {
  def: IntegrationDef;
  status: IntegrationStatus;
  /** Time of the last authenticated request that succeeded, or null when none was seen. */
  verifiedAt: string | null;
  detail: string;
  diagnostics: string[];
}

const report = (p: ProbeInput): HealthReport | null => (p.health.kind === "ok" ? p.health.report : null);
const checkOf = (r: HealthReport | null, id: string): HealthCheck | undefined => r?.checks.find((c) => c.id === id);
const credOf = (r: HealthReport | null, id: string) => r?.credentials.find((c) => c.id === id)?.configured;

/** When the site's health can't be read, nothing about site-held keys can be said. */
function siteUnknown(p: ProbeInput): Pick<IntegrationState, "status" | "detail" | "diagnostics"> | null {
  if (report(p)) return null;
  if (p.platform === "desktop" && p.siteLinked === false) return { status: "configuration_required", detail: "This Mac isn't linked to the hosted site, so site-held keys can't be checked.", diagnostics: ["Settings > Website sync has no site address or key."] };
  const h = p.health;
  const why = h.kind === "error" || h.kind === "not-configured" ? h.message : "Checking…";
  return { status: h.kind === "loading" || h.kind === "idle" ? "configuration_required" : "degraded", detail: h.kind === "loading" || h.kind === "idle" ? "Checking the site…" : "Atlas couldn't read the site's health report.", diagnostics: [why] };
}

function fromCheck(c: HealthCheck | undefined): { status: IntegrationStatus; verifiedAt: string | null } {
  if (!c) return { status: "connected", verifiedAt: null };
  if (c.state === "healthy") return { status: "connected", verifiedAt: c.checkedAt };
  if (c.state === "degraded") return { status: "degraded", verifiedAt: null };
  if (c.state === "unavailable") return { status: "disconnected", verifiedAt: null };
  return { status: "connected", verifiedAt: null };
}

export function integrationState(def: IntegrationDef, p: ProbeInput): IntegrationState {
  const base = { def, verifiedAt: null as string | null, diagnostics: [] as string[] };
  if (!def.platforms.includes(p.platform)) {
    const why = def.id === "anthropic" ? "The Claude key lives only in the Mac app's Keychain. Workflow model calls run through n8n." : def.id === "atlas-site" ? "Only the Mac app links to the hosted site." : "Not available in the local preview.";
    return { ...base, status: "unsupported", detail: why };
  }
  const r = report(p);
  switch (def.id) {
    case "github": {
      if (p.platform === "local") return { ...base, status: "unsupported", detail: "The local preview reads public repositories without a token." };
      const sync = p.github.failing ? `${p.github.failing} repositories failed their last sync.` : p.github.loaded ? `${p.github.loaded} repositories loaded.` : "No repositories loaded yet.";
      if (p.platform === "desktop") {
        if (p.githubToken === null) return { ...base, status: "configuration_required", detail: "Checking the Keychain…" };
        if (!p.githubToken) return { ...base, status: "configuration_required", detail: "No token in the Keychain. Atlas reads public data only.", diagnostics: [sync] };
        if (p.github.failing) return { ...base, status: "degraded", detail: sync, diagnostics: p.github.reasons.slice(0, 5) };
        return { ...base, status: "connected", verifiedAt: p.github.loaded ? p.github.lastFetched : null, detail: sync };
      }
      const u = siteUnknown(p);
      if (u) return { ...base, ...u };
      if (!credOf(r, "github-token")) return { ...base, status: "configuration_required", detail: "GITHUB_TOKEN isn't set on the site." };
      const c = checkOf(r, "github-api");
      return { ...base, ...fromCheck(c), detail: c?.detail ?? "Token set; no check ran.", diagnostics: p.github.failing ? p.github.reasons.slice(0, 5) : [] };
    }
    case "n8n": {
      const u = siteUnknown(p);
      if (u) return { ...base, ...u };
      if (!credOf(r, "n8n-key")) return { ...base, status: "configuration_required", detail: "N8N_API_KEY isn't set on the site." };
      const c = checkOf(r, "n8n");
      const b = checkOf(r, "n8n-bridge");
      const s = fromCheck(c);
      const bridgeBad = b && (b.state === "degraded" || b.state === "unavailable");
      const diagnostics = [b ? `Step Runner: ${b.detail}` : "", credOf(r, "n8n-bridge") ? "" : "Step Runner keys aren't set, so workflow steps can't be sent."].filter(Boolean);
      return { ...base, status: s.status === "connected" && bridgeBad ? "degraded" : s.status, verifiedAt: s.verifiedAt, detail: c?.detail ?? "Key set; no check ran.", diagnostics };
    }
    case "cloudflare": {
      const u = siteUnknown(p);
      if (u) return { ...base, ...u };
      const checks = [checkOf(r, "access"), checkOf(r, "database")].filter((c): c is HealthCheck => !!c);
      const worst = checks.find((c) => c.state === "unavailable") ?? checks.find((c) => c.state === "degraded");
      const s = worst ? fromCheck(worst) : { status: "connected" as const, verifiedAt: checks.every((c) => c.state === "healthy") && checks.length ? r!.checkedAt : null };
      const diagnostics = [...checks.map((c) => `${c.label}: ${c.detail}`), credOf(r, "cloudflare") ? "" : "CLOUDFLARE_API_TOKEN isn't set, so website analytics are off."].filter(Boolean);
      return { ...base, ...s, detail: worst?.detail ?? "The site answered and its database and sign-in checks ran.", diagnostics };
    }
    case "anthropic": {
      if (p.anthropicKey === null) return { ...base, status: "configuration_required", detail: "Checking the Keychain…" };
      if (!p.anthropicKey) return { ...base, status: "configuration_required", detail: "No Claude key in the Keychain. Repository Intelligence is off." };
      if (p.intelLast && !p.intelLast.ok) return { ...base, status: "degraded", detail: "The latest Repository Intelligence run failed.", diagnostics: [p.intelLast.error ?? "No error text."] };
      return { ...base, status: "connected", verifiedAt: p.intelLast?.ok ? p.intelLast.at : null, detail: p.intelLast ? "The latest run reached Claude." : "Key set. It's verified by the first Repository Intelligence run (Atlas doesn't spend money just to test it)." };
    }
    case "stripe": {
      const u = siteUnknown(p);
      if (u) return { ...base, ...u };
      if (!credOf(r, "n8n-bridge")) return { ...base, status: "configuration_required", detail: "The Step Runner keys aren't set on the site, so the sales feed can't be started." };
      const b = checkOf(r, "n8n-bridge");
      const s = fromCheck(b);
      return { ...base, status: s.status, verifiedAt: null, detail: "Checked only when you press Sync from Stripe in Business > Finance.", diagnostics: b ? [`Step Runner: ${b.detail}`] : [] };
    }
    case "email-alerts": {
      const u = siteUnknown(p);
      if (u) return { ...base, ...u };
      if (!credOf(r, "alerts")) return { ...base, status: "configuration_required", detail: "RESEND_API_KEY or ALERT_EMAIL_TO isn't set on the site." };
      return { ...base, status: "connected", detail: "Set. Atlas doesn't send a test email to verify it." };
    }
    case "atlas-site": {
      if (p.siteLinked === null) return { ...base, status: "configuration_required", detail: "Checking…" };
      if (!p.siteLinked) return { ...base, status: "configuration_required", detail: "No site address or sync key in Settings > Website sync." };
      if (r) return { ...base, status: "connected", verifiedAt: r.checkedAt, detail: "The site answered with its sync key." };
      return { ...base, status: "degraded", detail: "Linked, but the site didn't answer.", diagnostics: [p.health.kind === "error" ? p.health.message : "No answer yet."] };
    }
  }
  return { ...base, status: "unsupported", detail: "Unknown integration." };
}

export const integrationStates = (p: ProbeInput) => INTEGRATION_CATALOG.map((d) => integrationState(d, p));

/** Usable for workflows: connected, whether or not a check verified it yet. */
export const usable = (s: IntegrationState | undefined) => s?.status === "connected";
