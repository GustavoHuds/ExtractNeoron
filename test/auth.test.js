import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyIdToken, _clearCertCache } from '../src/auth.js';

const PROJECT = 'neoron';
const ISS = `https://securetoken.google.com/${PROJECT}`;
const KID = 'test-kid-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function makeToken({ alg = 'RS256', kid = KID, iss = ISS, aud = PROJECT, sub = 'uid-123',
  email = 'a@b.com', exp, iat, sign = true } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss, aud, sub, email, iat: iat ?? now, exp: exp ?? now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  let sig = '';
  if (sign && alg === 'RS256') {
    const s = crypto.createSign('RSA-SHA256'); s.update(signingInput); s.end();
    sig = b64url(s.sign(privateKey));
  }
  return `${header}.${payload}.${sig}`;
}

const fakeFetch = async () => ({
  ok: true,
  headers: { get: (k) => (k.toLowerCase() === 'cache-control' ? 'public, max-age=3600' : null) },
  json: async () => ({ [KID]: publicKey }),
});

test('accepts a valid RS256 token', async () => {
  _clearCertCache();
  const auth = await verifyIdToken(makeToken(), { fetch: fakeFetch });
  assert.equal(auth.localId, 'uid-123');
  assert.equal(auth.email, 'a@b.com');
});

test('rejects wrong audience', async () => {
  _clearCertCache();
  await assert.rejects(() => verifyIdToken(makeToken({ aud: 'evil' }), { fetch: fakeFetch }), /aud/);
});

test('rejects wrong issuer', async () => {
  _clearCertCache();
  await assert.rejects(() => verifyIdToken(makeToken({ iss: 'https://evil' }), { fetch: fakeFetch }), /iss/);
});

test('rejects expired token', async () => {
  _clearCertCache();
  const past = Math.floor(Date.now() / 1000) - 10;
  await assert.rejects(() => verifyIdToken(makeToken({ exp: past }), { fetch: fakeFetch }), /expired/);
});

test('rejects alg none (alg confusion)', async () => {
  _clearCertCache();
  await assert.rejects(() => verifyIdToken(makeToken({ alg: 'none', sign: false }), { fetch: fakeFetch }), /alg/);
});

test('rejects tampered signature', async () => {
  _clearCertCache();
  const tok = makeToken();
  const bad = tok.slice(0, -4) + 'AAAA';
  await assert.rejects(() => verifyIdToken(bad, { fetch: fakeFetch }), /signature/);
});

test('rejects malformed token', async () => {
  _clearCertCache();
  await assert.rejects(() => verifyIdToken('not-a-jwt', { fetch: fakeFetch }), /malformed/);
});

test('rejects unknown kid', async () => {
  _clearCertCache();
  await assert.rejects(() => verifyIdToken(makeToken({ kid: 'other' }), { fetch: fakeFetch }), /kid/);
});
