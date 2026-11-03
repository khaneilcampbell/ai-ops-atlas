import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, tokenFrom, verifyAccessJwt, type AccessConfig } from './access.ts';

const TEAM = 'benjaire.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const config: AccessConfig = { teamDomain: TEAM, aud: AUD, allowedEmails: ['owner@example.com'] };
const now = 1_800_000_000;

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

const pair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const otherPair = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1' };
const jwks = async () => ({ keys: [jwk] });

async function sign(claims: Record<string, unknown>, opts: { key?: CryptoKey; header?: Record<string, unknown> } = {}) {
  const head = enc(opts.header ?? { alg: 'RS256', kid: 'k1', typ: 'JWT' });
  const body = enc(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const good = { iss: `https://${TEAM}`, aud: [AUD], email: 'Owner@Example.com', exp: now + 600, iat: now, nbf: now };

test('accepts a valid token from an allowed email', async () => {
  const r = await verifyAccessJwt(await sign(good), config, jwks, now);
  assert.deepEqual(r, { ok: true, identity: { email: 'owner@example.com' } });
});

test('fails closed when Access is not configured', async () => {
  assert.equal((await verifyAccessJwt(await sign(good), null, jwks, now)).ok, false);
  assert.equal(parseConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: '', ALLOWED_EMAILS: 'a@b.c' }), null);
  assert.equal(parseConfig({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ALLOWED_EMAILS: ' ' }), null);
});

const reject = async (name: string, token: string | Promise<string> | null, reason: string, cfg: AccessConfig = config) =>
  test(`rejects ${name}`, async () => {
    const r = await verifyAccessJwt(await token, cfg, jwks, now);
    assert.deepEqual(r, { ok: false, reason });
  });

await reject('a missing token', null, 'missing-token');
await reject('garbage', 'not.a.jwt.at.all', 'malformed-token');
await reject('a token signed by another key', sign(good, { key: otherPair.privateKey }), 'bad-signature');
await reject('an unknown key id', sign(good, { header: { alg: 'RS256', kid: 'nope' } }), 'unknown-key');
await reject('alg none', sign(good, { header: { alg: 'none', kid: 'k1' } }), 'unsupported-alg');
await reject('HS256', sign(good, { header: { alg: 'HS256', kid: 'k1' } }), 'unsupported-alg');
await reject('another issuer', sign({ ...good, iss: 'https://evil.cloudflareaccess.com' }), 'bad-issuer');
await reject('another audience', sign({ ...good, aud: ['other-app'] }), 'bad-audience');
await reject('an expired token', sign({ ...good, exp: now - 120 }), 'expired');
await reject('a token without exp', sign({ ...good, exp: undefined }), 'expired');
await reject('a token not yet valid', sign({ ...good, nbf: now + 600 }), 'not-yet-valid');
await reject('an email not on the list', sign({ ...good, email: 'someone@else.com' }), 'email-not-allowed');
await reject('a token with no email (service token)', sign({ ...good, email: undefined }), 'email-not-allowed');

test('rejects a tampered payload', async () => {
  const [h, , s] = (await sign(good)).split('.');
  const r = await verifyAccessJwt(`${h}.${enc({ ...good, email: 'owner@example.com', exp: now + 99999 })}.${s}`, config, jwks, now);
  assert.deepEqual(r, { ok: false, reason: 'bad-signature' });
});

test('fails closed when the key set cannot be fetched', async () => {
  const r = await verifyAccessJwt(await sign(good), config, async () => { throw new Error('down'); }, now);
  assert.deepEqual(r, { ok: false, reason: 'jwks-unavailable' });
});

test('reads the token from the header, then the cookie', () => {
  assert.equal(tokenFrom(new Request('https://x', { headers: { 'Cf-Access-Jwt-Assertion': 'abc' } })), 'abc');
  assert.equal(tokenFrom(new Request('https://x', { headers: { Cookie: 'a=1; CF_Authorization=def; b=2' } })), 'def');
  assert.equal(tokenFrom(new Request('https://x')), null);
});
