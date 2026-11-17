// Organization integration credentials. Encrypted with AES-GCM under the site secret
// TENANT_VAULT_KEY (a Cloudflare Pages secret, like every other Atlas credential), with
// "<org id>|<integration id>|<key version>" as additional data: a ciphertext copied into another
// organization's row fails to decrypt. The API only ever returns a redacted view (provider, label,
// scopes, a short fingerprint, status); the plaintext is decrypted only inside the server when an
// adapter for that same organization needs it.

import type { D1 } from "../live";
import { audit, first, newId, nowIso, type Authorized, type TenantEnv } from "./core";
import type { Result } from "./repo";

export const PROVIDERS = ["github", "n8n", "cloudflare", "anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];
const isProvider = (v: unknown): v is Provider => typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

/** Least privilege: the scopes each provider may be given. Anything else is refused. */
export const ALLOWED_SCOPES: Record<Provider, readonly string[]> = {
  github: ["contents:read", "metadata:read", "actions:read", "pull_requests:read", "issues:read"],
  n8n: ["workflow:read", "execution:read", "webhook:step-runner"],
  cloudflare: ["pages:read", "analytics:read"],
  anthropic: ["messages"],
  openai: ["responses"],
};

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const KEY_VERSION = 1;

async function vaultKey(env: TenantEnv): Promise<CryptoKey | null> {
  const raw = env.TENANT_VAULT_KEY;
  if (!raw) return null;
  let bytes: Uint8Array;
  try {
    bytes = unb64(raw.trim());
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const aad = (orgId: string, id: string, v: number) => new TextEncoder().encode(`${orgId}|${id}|${v}`);

async function fingerprint(secret: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)));
  return [...h.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function seal(env: TenantEnv, orgId: string, id: string, secret: string) {
  const key = await vaultKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(orgId, id, KEY_VERSION) }, key, new TextEncoder().encode(secret)));
  return { ciphertext: b64(ct), iv: b64(iv), keyVersion: KEY_VERSION, fingerprint: await fingerprint(secret) };
}

interface IntegrationRow {
  id: string;
  provider: Provider;
  label: string;
  scopes: string;
  ciphertext: string | null;
  iv: string | null;
  key_version: number;
  fingerprint: string | null;
  status: "active" | "revoked";
  last_check_at: string | null;
  last_check: string | null;
  created_at: string;
  updated_at: string;
  rotated_at: string | null;
}

export const redacted = (r: IntegrationRow) => ({
  id: r.id,
  provider: r.provider,
  label: r.label,
  scopes: JSON.parse(r.scopes) as string[],
  status: r.status,
  credential: r.ciphertext ? `set (…${r.fingerprint})` : "not set",
  lastCheckAt: r.last_check_at,
  lastCheck: r.last_check,
  createdAt: r.created_at,
  rotatedAt: r.rotated_at,
});

export async function listIntegrations(db: D1, a: Authorized) {
  const { results } = await db.prepare("SELECT * FROM org_integrations WHERE org_id = ? ORDER BY created_at").bind(a.org.id).all<IntegrationRow>();
  return results.map(redacted);
}

function scopesProblem(provider: Provider, scopes: unknown): string | null {
  if (!Array.isArray(scopes) || !scopes.length) return "Pick at least one scope.";
  const bad = scopes.filter((s) => !ALLOWED_SCOPES[provider].includes(s as string));
  return bad.length ? `Not allowed for ${provider}: ${bad.join(", ")}.` : null;
}

export async function addIntegration(db: D1, env: TenantEnv, a: Authorized, input: { provider?: unknown; label?: unknown; scopes?: unknown; secret?: unknown }, now: number): Promise<Result<{ id: string }>> {
  if (!isProvider(input.provider)) return { ok: false, status: 400, message: `Provider must be one of ${PROVIDERS.join(", ")}.` };
  const problem = scopesProblem(input.provider, input.scopes);
  if (problem) return { ok: false, status: 400, message: problem };
  if (typeof input.secret !== "string" || input.secret.length < 8 || input.secret.length > 4096) return { ok: false, status: 400, message: "Paste the credential (8 to 4096 characters)." };
  const id = newId("int");
  const sealed = await seal(env, a.org.id, id, input.secret);
  if (!sealed) return { ok: false, status: 503, message: "The site has no valid TENANT_VAULT_KEY, so credentials can't be stored." };
  const at = nowIso(now);
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim().slice(0, 80) : input.provider;
  await db
    .prepare("INSERT INTO org_integrations (org_id, id, provider, label, scopes, ciphertext, iv, key_version, fingerprint, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)")
    .bind(a.org.id, id, input.provider, label, JSON.stringify(input.scopes), sealed.ciphertext, sealed.iv, sealed.keyVersion, sealed.fingerprint, at, at)
    .run();
  await audit(db, { orgId: a.org.id, actor: a.userId, action: "integration.add", target: id, outcome: "allowed", detail: { provider: input.provider } }, now);
  return { ok: true, value: { id } };
}

export async function rotateIntegration(db: D1, env: TenantEnv, a: Authorized, id: string, secret: unknown, now: number): Promise<Result<null>> {
  if (typeof secret !== "string" || secret.length < 8 || secret.length > 4096) return { ok: false, status: 400, message: "Paste the new credential." };
  const row = await first<IntegrationRow>(db, "SELECT * FROM org_integrations WHERE org_id = ? AND id = ?", a.org.id, id);
  if (!row) return { ok: false, status: 404, message: "No such integration." };
  const sealed = await seal(env, a.org.id, id, secret);
  if (!sealed) return { ok: false, status: 503, message: "The site has no valid TENANT_VAULT_KEY." };
  const at = nowIso(now);
  await db
    .prepare("UPDATE org_integrations SET ciphertext = ?, iv = ?, key_version = ?, fingerprint = ?, status = 'active', rotated_at = ?, updated_at = ? WHERE org_id = ? AND id = ?")
    .bind(sealed.ciphertext, sealed.iv, sealed.keyVersion, sealed.fingerprint, at, at, a.org.id, id)
    .run();
  await audit(db, { orgId: a.org.id, actor: a.userId, action: "integration.rotate", target: id, outcome: "allowed" }, now);
  return { ok: true, value: null };
}

/** Revoking erases the stored ciphertext at once. The provider-side key should be revoked there too. */
export async function revokeIntegration(db: D1, a: Authorized, id: string, now: number): Promise<Result<null>> {
  const at = nowIso(now);
  const r = await first(db, "SELECT id FROM org_integrations WHERE org_id = ? AND id = ?", a.org.id, id);
  if (!r) return { ok: false, status: 404, message: "No such integration." };
  await db.prepare("UPDATE org_integrations SET ciphertext = NULL, iv = NULL, fingerprint = NULL, status = 'revoked', updated_at = ? WHERE org_id = ? AND id = ?").bind(at, a.org.id, id).run();
  await audit(db, { orgId: a.org.id, actor: a.userId, action: "integration.revoke", target: id, outcome: "allowed" }, now);
  return { ok: true, value: null };
}

/**
 * The plaintext for an adapter running for this organization. Only server code calls this, with
 * an organization id it got from an authorized request or a dispatch record, never from a body.
 */
export async function openCredential(db: D1, env: TenantEnv, orgId: string, id: string): Promise<string | null> {
  const row = await first<IntegrationRow>(db, "SELECT * FROM org_integrations WHERE org_id = ? AND id = ? AND status = 'active'", orgId, id);
  if (!row?.ciphertext || !row.iv) return null;
  const key = await vaultKey(env);
  if (!key) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(row.iv), additionalData: aad(orgId, id, row.key_version) }, key, unb64(row.ciphertext));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

export type Checker = (provider: Provider, secret: string) => Promise<{ ok: boolean; detail: string }>;

/** A real, read-only connection check per provider. No check: the result says "not checked", never "connected". */
export const defaultChecker: Checker = async (provider, secret) => {
  const endpoints: Partial<Record<Provider, { url: string; headers: Record<string, string> }>> = {
    github: { url: "https://api.github.com/user", headers: { authorization: `Bearer ${secret}`, "user-agent": "atlas-tenancy", accept: "application/vnd.github+json" } },
    cloudflare: { url: "https://api.cloudflare.com/client/v4/user/tokens/verify", headers: { authorization: `Bearer ${secret}` } },
  };
  const e = endpoints[provider];
  if (!e) return { ok: false, detail: "not checked: Atlas has no read-only check for this provider yet" };
  try {
    const r = await fetch(e.url, { headers: e.headers });
    return { ok: r.ok, detail: r.ok ? "connected" : `provider answered ${r.status}` };
  } catch {
    return { ok: false, detail: "provider unreachable" };
  }
};

export async function checkIntegration(db: D1, env: TenantEnv, a: Authorized, id: string, now: number, checker: Checker = defaultChecker): Promise<Result<{ ok: boolean; detail: string }>> {
  const row = await first<IntegrationRow>(db, "SELECT provider FROM org_integrations WHERE org_id = ? AND id = ?", a.org.id, id);
  if (!row) return { ok: false, status: 404, message: "No such integration." };
  const secret = await openCredential(db, env, a.org.id, id);
  const result = secret ? await checker(row.provider, secret) : { ok: false, detail: "no usable credential" };
  await db.prepare("UPDATE org_integrations SET last_check_at = ?, last_check = ? WHERE org_id = ? AND id = ?").bind(nowIso(now), result.detail, a.org.id, id).run();
  if (!result.ok) await audit(db, { orgId: a.org.id, actor: a.userId, action: "integration.check_failed", target: id, outcome: "error", detail: { result: result.detail } }, now);
  return { ok: true, value: result };
}
