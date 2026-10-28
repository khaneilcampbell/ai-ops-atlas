import { describe, expect, it } from "vitest";
import { verifyAccess } from "./access";

const TEAM = "https://kc.cloudflareaccess.com";
const AUD = "aud-123";
const env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
const NOW = 1_800_000_000_000;

const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const bytes = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

async function setup() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pub = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
  const sign = async (claims: Record<string, unknown>, kid = "k1") => {
    const body = `${enc({ alg: "RS256", kid })}.${enc(claims)}`;
    return `${body}.${bytes(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(body)))}`;
  };
  const certs = async (url: string) => {
    expect(url).toBe(`${TEAM}/cdn-cgi/access/certs`);
    return { keys: [pub] };
  };
  return { sign, certs };
}

const good = { aud: [AUD], iss: TEAM, exp: NOW / 1000 + 600, email: "kc@example.com" };

describe("verifyAccess", () => {
  it("accepts a valid token", async () => {
    const { sign, certs } = await setup();
    expect(await verifyAccess(await sign(good), env, NOW, certs)).toEqual({ ok: true, email: "kc@example.com" });
  });

  it("fails closed with a clear answer when the signing keys can't be fetched", async () => {
    const { sign } = await setup();
    const down = async () => {
      throw new Error("certs 502");
    };
    expect(await verifyAccess(await sign(good), env, NOW, down)).toMatchObject({ ok: false, status: 503 });
  });

  it("fails closed when Access isn't configured", async () => {
    const { sign, certs } = await setup();
    expect(await verifyAccess(await sign(good), {}, NOW, certs)).toMatchObject({ ok: false, status: 503 });
  });

  it("rejects missing, expired, wrong-audience and wrong-issuer tokens", async () => {
    const { sign, certs } = await setup();
    expect(await verifyAccess(null, env, NOW, certs)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyAccess(await sign({ ...good, exp: NOW / 1000 - 1 }), env, NOW, certs)).toMatchObject({ ok: false, status: 401 });
    expect(await verifyAccess(await sign({ ...good, aud: ["other"] }), env, NOW, certs)).toMatchObject({ ok: false, status: 403 });
    expect(await verifyAccess(await sign({ ...good, iss: "https://evil.cloudflareaccess.com" }), env, NOW, certs)).toMatchObject({ ok: false, status: 403 });
    expect(await verifyAccess(await sign(good, "nope"), env, NOW, certs)).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects a tampered token", async () => {
    const { sign, certs } = await setup();
    const [h, , s] = (await sign(good)).split(".");
    const forged = `${h}.${enc({ ...good, email: "someone@else.com" })}.${s}`;
    expect(await verifyAccess(forged, env, NOW, certs)).toMatchObject({ ok: false, reason: "Invalid token signature." });
  });

  it("applies the optional email allowlist", async () => {
    const { sign, certs } = await setup();
    expect(await verifyAccess(await sign(good), { ...env, ALLOWED_EMAILS: "kc@example.com" }, NOW, certs)).toMatchObject({ ok: true });
    expect(await verifyAccess(await sign(good), { ...env, ALLOWED_EMAILS: "other@example.com" }, NOW, certs)).toMatchObject({ ok: false, status: 403 });
  });
});
