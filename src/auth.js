/**
 * Verify Firebase ID tokens (project "neoron") locally, without a per-request
 * round-trip to Google. RS256 against Google's cached x509 public certs.
 */
import crypto from 'node:crypto';
import { config } from './config.js';

const PROJECT = config.firebaseProject;
const ISS = `https://securetoken.google.com/${PROJECT}`;
const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certCache = { certs: null, expiresAt: 0 };
export function _clearCertCache() { certCache = { certs: null, expiresAt: 0 }; }

async function getCerts(now, fetchImpl) {
  if (certCache.certs && now < certCache.expiresAt) return certCache.certs;
  const res = await fetchImpl(CERTS_URL);
  if (!res.ok) throw new Error(`cert fetch failed: ${res.status}`);
  const certs = await res.json();
  const cc = res.headers.get('cache-control') || '';
  const m = /max-age=(\d+)/.exec(cc);
  const ttl = m ? Number(m[1]) * 1000 : 3600_000;
  certCache = { certs, expiresAt: now + ttl };
  return certs;
}

const fromB64url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const jsonB64url = (s) => JSON.parse(fromB64url(s).toString('utf8'));

export async function verifyIdToken(token, opts = {}) {
  const now = opts.now || Date.now();
  const fetchImpl = opts.fetch || fetch;
  if (typeof token !== 'string' || token.split('.').length !== 3) throw new Error('malformed token');
  const [h, p, s] = token.split('.');
  let header, payload;
  try { header = jsonB64url(h); payload = jsonB64url(p); }
  catch { throw new Error('malformed token'); }
  if (header.alg !== 'RS256') throw new Error('unexpected alg');
  if (!header.kid) throw new Error('missing kid');
  if (payload.iss !== ISS) throw new Error('bad iss');
  if (payload.aud !== PROJECT) throw new Error('bad aud');
  if (!payload.sub) throw new Error('missing sub');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) throw new Error('expired');
  const certs = await getCerts(now, fetchImpl);
  const pem = certs[header.kid];
  if (!pem) throw new Error('unknown kid');
  const v = crypto.createVerify('RSA-SHA256');
  v.update(`${h}.${p}`); v.end();
  if (!v.verify(pem, fromB64url(s))) throw new Error('bad signature');
  return { idToken: token, localId: payload.sub, email: payload.email || '' };
}

export function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return res.status(401).json({ error: 'Não autenticado.' });
  verifyIdToken(m[1])
    .then((auth) => {
      const allow = config.authorizedEmails;
      if (allow.length && !allow.includes((auth.email || '').toLowerCase())) {
        return res.status(403).json({ error: 'Acesso não autorizado.' });
      }
      req.auth = auth;
      next();
    })
    .catch(() => res.status(401).json({ error: 'Sessão inválida ou expirada.' }));
}
