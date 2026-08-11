# ExtractNeoron Production Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn ExtractNeoron into a secure, multi-user LAN dashboard: per-person Neoron web login with browser auto-login, a full security pass, fixed leads contrast, and a reimagined readable metrics page with a complete per-attendant view — plus a unified header.

**Architecture:** Browser-direct Firebase auth (password → Google over TLS only; browser stores the refresh token). The Node/Express server is stateless and gates every `/api/*` route with a locally-verified Firebase ID token (`Bearer`). Extraction/timeline use the caller's token. Charts are hand-drawn SVG (no third-party JS).

**Tech Stack:** Node 22 (ESM), Express, ExcelJS, built-in `node:test` + `node:assert`, browser ES modules, `node:crypto` for RS256 verification.

> **Commit policy:** The user's standing rule is *never commit unless explicitly asked*. Commit steps are included for a professional TDD cadence, but the implementer MUST get the user's go-ahead before running any `git commit`. Batch them if the user prefers.

---

## File Structure

**New files**
- `src/auth.js` — Firebase ID-token verifier (RS256 + cert cache) and `requireAuth` middleware.
- `src/sanitize.js` — server-side cell/formula-injection neutralizer.
- `public/auth.js` — browser login / auto-login / refresh / `authFetch` (ES module).
- `public/charts.js` — reusable SVG chart module (bars, line, hbars) with axes/labels.
- `test/auth.test.js`, `test/sanitize.test.js`, `test/timeline-agg.test.js` — unit tests.
- `SECURITY.md` — audit report + residual risks.

**Modified files**
- `src/firestore.js` — export `API_KEY`/`PROJECT`; keep `signIn()` for CLI only.
- `src/extractor.js` — `extractNegociando(auth)` accepts caller token; sanitize CSV cells.
- `src/timeline.js` — `buildTimeline(auth)` accepts caller token; add per-attendant monthly + first-response aggregation (extract pure helper `aggregateAttendants`).
- `src/xlsx.js` — neutralize formula-injection in string cells.
- `src/server.js` — `requireAuth` on all `/api/*`; security headers; sanitized errors; pass `req.auth` down.
- `src/config.js` — `.env` Neoron creds become optional.
- `public/index.html`, `public/timeline.html` — unified header, login overlay, module scripts.
- `public/app.js`, `public/timeline.js` — use `authFetch`, login gate, header user chip/logout, redesigned metrics render, fixed leads render.
- `public/style.css` — fix `.motivo.t-quente`; header, login, metrics styles.
- `Iniciar-ExtractNeoron.bat` — drop `.env` credential prompt.
- `.env.example`, `README.md` — document login flow; `.env` creds are `discover.js`-only.
- `package.json` — add `"test": "node --test"`.

---

## Phase 0 — Test harness

### Task 0: Wire up the test runner

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Add test script**

In `package.json`, add to `"scripts"`:

```json
    "test": "node --test"
```

- [ ] **Step 2: Verify runner works**

Run: `npm test`
Expected: exits 0 with "tests 0" (no test files yet) — confirms `node --test` runs.

- [ ] **Step 3: Commit** *(ask first — see commit policy)*

```bash
git add package.json
git commit -m "chore: add node:test runner script"
```

---

## Phase 1 — Auth backend (TDD)

### Task 1: Firebase ID-token verifier

**Files:**
- Create: `src/auth.js`
- Test: `test/auth.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/auth.test.js`:

```js
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

// Injected fetch returning our test cert map with a long max-age.
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/auth.test.js`
Expected: FAIL — `Cannot find module '../src/auth.js'`.

- [ ] **Step 3: Implement `src/auth.js`**

```js
/**
 * Verify Firebase ID tokens (project "neoron") locally, without a per-request
 * round-trip to Google. RS256 against Google's cached x509 public certs.
 */
import crypto from 'node:crypto';

const PROJECT = 'neoron';
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
    .then((auth) => { req.auth = auth; next(); })
    .catch(() => res.status(401).json({ error: 'Sessão inválida ou expirada.' }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/auth.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit** *(ask first)*

```bash
git add src/auth.js test/auth.test.js
git commit -m "feat(auth): local Firebase ID-token verification + requireAuth"
```

---

## Phase 2 — Server-side sanitization (TDD)

### Task 2: Formula-injection neutralizer

**Files:**
- Create: `src/sanitize.js`
- Test: `test/sanitize.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/sanitize.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { neutralizeCell } from '../src/sanitize.js';

test('prefixes formula-leading strings', () => {
  for (const c of ['=', '+', '-', '@']) {
    assert.equal(neutralizeCell(`${c}CMD()`), `'${c}CMD()`);
  }
});
test('prefixes tab/CR-leading strings', () => {
  assert.equal(neutralizeCell('\tx'), "'\tx");
  assert.equal(neutralizeCell('\rx'), "'\rx");
});
test('leaves safe strings unchanged', () => {
  assert.equal(neutralizeCell('João'), 'João');
  assert.equal(neutralizeCell('R$ 1.200,00'), 'R$ 1.200,00');
});
test('passes through non-strings', () => {
  assert.equal(neutralizeCell(42), 42);
  assert.equal(neutralizeCell(null), null);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/sanitize.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/sanitize.js`**

```js
/** Neutralize CSV/Excel formula injection: cells beginning with = + - @ TAB CR. */
export function neutralizeCell(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/sanitize.test.js`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit** *(ask first)*

```bash
git add src/sanitize.js test/sanitize.test.js
git commit -m "feat(security): CSV/Excel formula-injection neutralizer"
```

### Task 3: Apply neutralizer to CSV and XLSX exports

**Files:**
- Modify: `src/extractor.js` (CSV writer + import)
- Modify: `src/xlsx.js` (row values + import)

- [ ] **Step 1: Harden the CSV writer**

In `src/extractor.js`, add near the other imports:

```js
import { neutralizeCell } from './sanitize.js';
```

In `toCsv`, change the `esc` function's string handling to neutralize first:

```js
  const esc = (v) => {
    if (Array.isArray(v)) v = v.join(' | ');
    if (v == null) v = '';
    const s = neutralizeCell(String(v));
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
```

- [ ] **Step 2: Harden the XLSX writer**

In `src/xlsx.js`, add at the top imports:

```js
import { neutralizeCell } from './sanitize.js';
```

Replace the `ws.addRow({ ...r, ... })` call (around line 48) so string fields are neutralized:

```js
    const row = ws.addRow({
      ...r,
      nome: neutralizeCell(r.nome),
      contato: neutralizeCell(r.contato),
      produto: neutralizeCell(r.produto),
      atendente: neutralizeCell(r.atendente),
      contexto: neutralizeCell(r.contexto),
      temperatura: cap(r.temperatura),
      motivos: neutralizeCell((r.motivos || []).join(', ')),
      aguardando: r.aguardando ? 'Sim' : '',
      feito: r.feito ? 'Sim' : '',
      tags: neutralizeCell((r.tags || []).join(', ')),
      produtoPreco: r.produtoPreco || null,
      ultimaInteracao: r.ultimaInteracao ? new Date(r.ultimaInteracao) : null,
    });
```

- [ ] **Step 3: Sanity check both exports still build**

Run: `node -e "import('./src/xlsx.js').then(m=>m.buildWorkbook({rows:[{nome:'=HACK()',temperatura:'quente',situacao:'Aberto',motivos:['x'],tags:[]}],situacao:{},temperatura:{},generatedAt:new Date().toISOString(),account:'t'})).then(wb=>wb.xlsx.writeBuffer()).then(b=>console.log('xlsx ok',b.length>0))"`
Expected: prints `xlsx ok true`.

- [ ] **Step 4: Commit** *(ask first)*

```bash
git add src/extractor.js src/xlsx.js
git commit -m "feat(security): neutralize formula injection in CSV and XLSX exports"
```

---

## Phase 3 — Server auth wiring & extraction refactor

### Task 4: Export shared Firebase constants

**Files:**
- Modify: `src/firestore.js`

- [ ] **Step 1: Export the constants**

In `src/firestore.js`, change the const declarations (lines 9-10) and the final export:

```js
export const PROJECT = 'neoron';
export const API_KEY = process.env.NEORON_API_KEY /* redacted: key now injected from env, not source */;
```

Update the bottom `export { PROJECT, DB, DOCS };` to `export { DB, DOCS };` (PROJECT is now exported inline). Leave `signIn()` intact for the CLI/`discover.js`.

- [ ] **Step 2: Verify import still resolves**

Run: `node -e "import('./src/firestore.js').then(m=>console.log('API_KEY', typeof m.API_KEY, 'PROJECT', m.PROJECT))"`
Expected: `API_KEY string PROJECT neoron`.

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add src/firestore.js
git commit -m "refactor(firestore): export API_KEY/PROJECT for reuse"
```

### Task 5: `extractNegociando(auth)` accepts caller token

**Files:**
- Modify: `src/extractor.js`

- [ ] **Step 1: Change the signature to accept auth**

In `src/extractor.js`, change the function declaration (line 200) and remove the internal `signIn()`:

```js
export async function extractNegociando(auth) {
  ensureDirs();
  const { idToken, localId, email } = auth || await signIn(); // CLI falls back to .env
```

(Keep the `import { signIn, ... }` so the CLI entrypoint at the bottom still works via the fallback.)

- [ ] **Step 2: Verify the CLI path still parses**

Run: `node --check src/extractor.js`
Expected: no output (syntax OK).

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add src/extractor.js
git commit -m "refactor(extractor): accept caller auth token"
```

### Task 6: `buildTimeline(auth)` accepts caller token + extract attendant aggregation

**Files:**
- Modify: `src/timeline.js`
- Test: `test/timeline-agg.test.js`

- [ ] **Step 1: Write failing test for the pure aggregation helper**

Create `test/timeline-agg.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAttendants } from '../src/timeline.js';

// month index used to decide "chats this month"
const MONTH = '2026-08';
const rows = [
  { atendente: 'Ana', first: 60_000, situacao: 'Vendido', awaiting: false, mes: '2026-08' },
  { atendente: 'Ana', first: 180_000, situacao: 'Aberto', awaiting: true, mes: '2026-08' },
  { atendente: 'Ana', first: 120_000, situacao: 'Aberto', awaiting: false, mes: '2026-07' },
  { atendente: 'Bruno', first: null, situacao: 'Aberto', awaiting: false, mes: '2026-08' },
];

test('aggregates per attendant with monthly counts and response stats', () => {
  const out = aggregateAttendants(rows, MONTH);
  const ana = out.find((a) => a.nome === 'Ana');
  assert.equal(ana.conversas, 3);
  assert.equal(ana.chatsMes, 2);           // only 2026-08
  assert.equal(ana.vendas, 1);
  assert.equal(ana.aguardando, 1);
  assert.equal(ana.primeiraRespostaMedianaMin, 2); // median(60k,180k,120k)=120k=2min
  assert.equal(ana.primeiraRespostaMediaMin, 2);   // mean(1,3,2)=2
  assert.equal(ana.taxaConversao, 33.3);           // 1 venda / 3
  // sorted by conversas desc → Ana first
  assert.equal(out[0].nome, 'Ana');
});

test('handles attendant with no response samples', () => {
  const out = aggregateAttendants(rows, MONTH);
  const bruno = out.find((a) => a.nome === 'Bruno');
  assert.equal(bruno.primeiraRespostaMedianaMin, null);
  assert.equal(bruno.chatsMes, 1);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/timeline-agg.test.js`
Expected: FAIL — `aggregateAttendants` is not exported.

- [ ] **Step 3: Implement the helper and refactor `buildTimeline`**

In `src/timeline.js`, add near the other pure helpers (after `median`):

```js
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7); // YYYY-MM

/** Pure per-attendant aggregation from per-conversation stat rows. */
export function aggregateAttendants(stats, currentMonth) {
  const map = new Map();
  for (const s of stats) {
    const name = s.atendente || '—';
    if (!map.has(name)) map.set(name, { nome: name, conversas: 0, chatsMes: 0, firsts: [], vendas: 0, aguardando: 0 });
    const a = map.get(name);
    a.conversas++;
    if (s.mes === currentMonth) a.chatsMes++;
    if (s.first != null) a.firsts.push(s.first);
    if (s.situacao === 'Vendido') a.vendas++;
    if (s.awaiting) a.aguardando++;
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  return [...map.values()].map((a) => ({
    nome: a.nome,
    conversas: a.conversas,
    chatsMes: a.chatsMes,
    vendas: a.vendas,
    aguardando: a.aguardando,
    primeiraRespostaMedianaMin: min(median(a.firsts)),
    primeiraRespostaMediaMin: a.firsts.length
      ? Math.round(a.firsts.reduce((x, y) => x + y, 0) / a.firsts.length / 60000) : null,
    taxaConversao: a.conversas ? round1((a.vendas / a.conversas) * 100) : 0,
  })).sort((a, b) => b.conversas - a.conversas);
}
```

Change the `buildTimeline` signature (line 69) and remove the internal `signIn`:

```js
export async function buildTimeline(auth) {
  ensureDirs();
  const { idToken, localId, email } = auth || await signIn();
```

In the `perConv` mapping (around line 100), add `mes` to each stat object:

```js
        dia: dayKey(toMs(c.created_date) ?? toMs(c.last_message_at) ?? now),
        mes: monthKey(toMs(c.created_date) ?? toMs(c.last_message_at) ?? now),
        atendente: attendantName(msgs),
```

Replace the old per-attendant block (the `agMap` loop and `atendentes` map, lines ~137-150) with:

```js
  const nowMonth = monthKey(now);
  const atendentes = aggregateAttendants(stats, nowMonth);
```

Add `volumePorAtendente` to the result object (after `atendentes,`):

```js
    volumePorAtendente: atendentes.map((a) => ({ nome: a.nome, conversas: a.conversas })),
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/timeline-agg.test.js`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit** *(ask first)*

```bash
git add src/timeline.js test/timeline-agg.test.js
git commit -m "feat(timeline): caller auth + per-attendant monthly/first-response aggregation"
```

### Task 7: Gate the server, add security headers, sanitize errors

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Import auth + apply security headers and gating**

In `src/server.js`, add to imports:

```js
import { requireAuth } from './auth.js';
```

Right after `const app = express();` and `app.use(express.json());`, add security headers BEFORE the static handler:

```js
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; " +
    "img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
    "base-uri 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
```

Keep `app.use(express.static(...))` — static assets (HTML/JS/CSS) carry no customer data; the data lives only behind gated APIs.

- [ ] **Step 2: Require auth on every API route + pass token down**

Add a single guard line before the first route, applying to the whole `/api` namespace:

```js
app.use('/api', requireAuth);
```

Then update the two heavy routes to use the caller's token:

- `/api/extract`: `res.json(await extractNegociando(req.auth));`
- `/api/timeline` and `/api/timeline/refresh`: `res.json(await buildTimeline(req.auth));`

- [ ] **Step 3: Sanitize error responses**

Replace the three `res.status(500).json({ error: e.message })` handlers so internals aren't leaked:

```js
  catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao processar. Tente novamente.' }); }
```

Leave the `/api/extract` "already extracting" 429 and `/api/done` 400 validation messages as-is (they're safe).

- [ ] **Step 4: Verify server boots and gating works**

Run (in one shell): `node src/server.js` (background), then:
Run: `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/api/data`
Expected: `401` (no token).
Run: `curl -s -o NUL -w "%{http_code}" http://127.0.0.1:3000/`
Expected: `200` (static shell still served). Stop the server.

- [ ] **Step 5: Commit** *(ask first)*

```bash
git add src/server.js
git commit -m "feat(server): requireAuth on all APIs, CSP/security headers, sanitized errors"
```

---

## Phase 4 — Client auth & header rework

### Task 8: Browser auth module

**Files:**
- Create: `public/auth.js`

- [ ] **Step 1: Implement `public/auth.js`**

```js
// Browser-side Firebase auth: login, auto-login via refresh token, authFetch.
const API_KEY = process.env.NEORON_API_KEY /* redacted: key now injected from env, not source */; // public Firebase web key
const LS_KEY = 'neoron_auth';
let idToken = null;

export function loadStored() { try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; } }
function store(a) { localStorage.setItem(LS_KEY, JSON.stringify(a)); }
export function clearAuth() { localStorage.removeItem(LS_KEY); idToken = null; }
export function currentUser() { return loadStored()?.email || null; }

export async function login(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const d = await res.json();
  if (!res.ok) {
    const code = d.error?.message || '';
    const msg = /INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|INVALID_PASSWORD/.test(code)
      ? 'E-mail ou senha inválidos.' : 'Falha no login. Tente novamente.';
    throw new Error(msg);
  }
  idToken = d.idToken;
  store({ email: d.email, refreshToken: d.refreshToken });
  return { email: d.email };
}

export async function refresh() {
  const s = loadStored();
  if (!s?.refreshToken) throw new Error('no refresh token');
  const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
  });
  const d = await res.json();
  if (!res.ok) { clearAuth(); throw new Error('refresh failed'); }
  idToken = d.id_token;
  store({ email: s.email, refreshToken: d.refresh_token });
  return idToken;
}

async function ensureToken() { return idToken || refresh(); }

export async function authFetch(url, opts = {}) {
  let tok = await ensureToken();
  const go = (t) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  let res = await go(tok);
  if (res.status === 401) { tok = await refresh(); res = await go(tok); }
  return res;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/auth.js`
Expected: no output.

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add public/auth.js
git commit -m "feat(client): browser Firebase auth (login/auto-login/authFetch)"
```

### Task 9: Unified header + login overlay markup (both pages)

**Files:**
- Modify: `public/index.html`
- Modify: `public/timeline.html`

- [ ] **Step 1: Replace the header in `public/index.html`**

Replace the `<header>...</header>` block (lines 10-33) with:

```html
  <div id="login" class="login-scrim" hidden>
    <form class="login-card" id="login-form">
      <div class="login-brand"><span class="logo">EN</span><b>ExtractNeoron</b></div>
      <p class="login-sub">Entre com sua conta do Neoron</p>
      <label>E-mail<input type="email" id="login-email" autocomplete="username" required></label>
      <label>Senha<input type="password" id="login-pass" autocomplete="current-password" required></label>
      <button class="primary" type="submit" id="login-btn">Entrar</button>
      <p class="login-err" id="login-err" hidden></p>
    </form>
  </div>

  <header class="topbar">
    <div class="brand">
      <span class="logo">EN</span>
      <div><h1>ExtractNeoron</h1><p class="sub">Leads em Negociação</p></div>
    </div>
    <nav class="tabs">
      <a class="tab active" href="/">Leads</a>
      <a class="tab" href="/timeline.html">Métricas</a>
    </nav>
    <div class="actions">
      <span id="auto" class="auto" title="Atualização automática">—</span>
      <button id="btn-extract" class="primary">Extrair</button>
      <div class="menu">
        <button id="btn-export">Exportar</button>
        <div class="menu-list" id="export-menu" hidden>
          <a href="#" data-dl="xlsx">Excel (.xlsx)</a>
          <a href="#" data-dl="csv">CSV</a>
        </div>
      </div>
      <div class="usermenu">
        <button id="user-chip" class="user-chip"><span class="avatar" id="user-initial">·</span><span id="user-name">—</span></button>
        <div class="menu-list" id="user-menu" hidden><a href="#" id="btn-logout">Sair</a></div>
      </div>
    </div>
  </header>
```

Note: the export links become `data-dl` actions (downloads now need the Bearer header — handled in Task 10). Change the script tag at the bottom to a module:

```html
  <script type="module" src="app.js"></script>
```

- [ ] **Step 2: Replace the header in `public/timeline.html`**

Replace lines 10-25 with the same login overlay + topbar, but with the Métricas tab active and Recalcular as the action:

```html
  <div id="login" class="login-scrim" hidden>
    <form class="login-card" id="login-form">
      <div class="login-brand"><span class="logo">EN</span><b>ExtractNeoron</b></div>
      <p class="login-sub">Entre com sua conta do Neoron</p>
      <label>E-mail<input type="email" id="login-email" autocomplete="username" required></label>
      <label>Senha<input type="password" id="login-pass" autocomplete="current-password" required></label>
      <button class="primary" type="submit" id="login-btn">Entrar</button>
      <p class="login-err" id="login-err" hidden></p>
    </form>
  </div>

  <header class="topbar">
    <div class="brand">
      <span class="logo">EN</span>
      <div><h1>ExtractNeoron</h1><p class="sub">Métricas &amp; Desempenho</p></div>
    </div>
    <nav class="tabs">
      <a class="tab" href="/">Leads</a>
      <a class="tab active" href="/timeline.html">Métricas</a>
    </nav>
    <div class="actions">
      <button id="btn-refresh" class="primary">Recalcular</button>
      <div class="usermenu">
        <button id="user-chip" class="user-chip"><span class="avatar" id="user-initial">·</span><span id="user-name">—</span></button>
        <div class="menu-list" id="user-menu" hidden><a href="#" id="btn-logout">Sair</a></div>
      </div>
    </div>
  </header>
```

Change the bottom script to a module: `<script type="module" src="timeline.js"></script>`.

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add public/index.html public/timeline.html
git commit -m "feat(ui): unified ExtractNeoron header + login overlay markup"
```

### Task 10: Wire login gate, user chip, logout, and authenticated downloads in `app.js`

**Files:**
- Modify: `public/app.js`

- [ ] **Step 1: Import auth and harden `esc`**

At the very top of `public/app.js`:

```js
import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
```

Replace the `esc` definition (line 10) with the hardened version:

```js
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
```

- [ ] **Step 2: Route all API calls through `authFetch`**

Replace the three data calls:
- In `extract()`: `const res = await authFetch('/api/extract', { method: 'POST' });`
- In `loadCached()`: `DATA = await (await authFetch('/api/data')).json();`
- In `toggleDone()`: `const res = await authFetch('/api/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, done }) });`

- [ ] **Step 3: Add gate + header wiring at the bottom (replace the final `loadCached();` line)**

```js
// ---- auth gate + header ----
function paintUser() {
  const email = currentUser() || '';
  $('#user-name').textContent = email || '—';
  $('#user-initial').textContent = (email[0] || '·').toUpperCase();
}
function showLogin(show) { $('#login').hidden = !show; }

async function boot() {
  try {
    await refresh();          // auto-login with stored refresh token
    showLogin(false); paintUser(); loadCached();
  } catch {
    showLogin(true);
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-err');
  btn.disabled = true; err.hidden = true;
  try {
    await login($('#login-email').value.trim(), $('#login-pass').value);
    showLogin(false); paintUser(); loadCached();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; }
});

$('#user-chip').addEventListener('click', (e) => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
$('#btn-logout').addEventListener('click', (e) => { e.preventDefault(); clearAuth(); location.reload(); });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });

// authenticated downloads (blob via Bearer)
$('#export-menu').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-dl]'); if (!a) return;
  e.preventDefault();
  const url = a.dataset.dl === 'xlsx' ? '/api/download.xlsx' : '/api/download';
  const res = await authFetch(url);
  if (!res.ok) { toast('Nada para exportar ainda.'); return; }
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = a.dataset.dl === 'xlsx' ? 'negociando.xlsx' : 'negociando.csv';
  link.click(); URL.revokeObjectURL(link.href);
});

boot();
```

Remove the now-duplicated `loadCached();` call at the very end and the old `#btn-export` menu toggle if it conflicts (keep the toggle that shows `#export-menu`).

- [ ] **Step 4: Manual smoke (deferred to Task 15).** Syntax check now:

Run: `node --check public/app.js`
Expected: no output.

- [ ] **Step 5: Commit** *(ask first)*

```bash
git add public/app.js
git commit -m "feat(client): login gate, user menu/logout, authenticated exports on Leads"
```

---

## Phase 5 — Leads UX fix

### Task 11: Fix hot-lead contrast and lead-cell hierarchy

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Remove the red hot-lead body text**

In `public/style.css`, replace line 91:

```css
.motivo.t-quente { color: #a2402f; } .motivo.t-frio { color: var(--cold); }
```

with:

```css
.motivo { color: var(--text-2); }
.motivo.t-quente, .motivo.t-morno, .motivo.t-frio { color: var(--text-2); }
```

- [ ] **Step 2: Tighten the lead cell hierarchy**

Append to `public/style.css`:

```css
/* Leads cell polish */
.nm-line { display: flex; align-items: center; gap: 8px; }
.nm { font-weight: 600; color: var(--text); }
.badges { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.motivo { margin-top: 6px; line-height: 1.4; }
.tags { margin-top: 6px; display: flex; gap: 5px; flex-wrap: wrap; }
.ctx { color: var(--text-2); max-width: 320px; line-height: 1.45; }
tbody td { vertical-align: top; padding-top: 12px; padding-bottom: 12px; }
```

- [ ] **Step 3: Visual check (deferred to Task 15).** Confirm CSS parses by loading the page later.

- [ ] **Step 4: Commit** *(ask first)*

```bash
git add public/style.css
git commit -m "fix(ui): remove low-contrast red on hot leads; clean lead-cell hierarchy"
```

---

## Phase 6 — Metrics redesign

### Task 12: Reusable SVG chart module

**Files:**
- Create: `public/charts.js`

- [ ] **Step 1: Implement `public/charts.js`**

```js
// Hand-drawn SVG charts: readable labels, axes, gridlines, value labels. No deps.
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

const NS_TEXT = 'font-family:Inter,Segoe UI,system-ui,sans-serif';

/** Vertical bars with y-gridlines + value labels. rows: [{label, value}] */
export function barChart(rows, { color = 'var(--accent)', fmt = (v) => v, unit = '' } = {}) {
  const W = 860, H = 300, L = 46, R = 14, T = 20, B = 46;
  if (!rows.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  const iw = W - L - R, ih = H - T - B;
  const bw = iw / rows.length;
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${fmt(Math.round(v))}</text>`;
  }
  const step = Math.ceil(rows.length / 14) || 1;
  const bars = rows.map((r, i) => {
    const bh = ih * ((r.value || 0) / max);
    const x = L + i * bw, y = T + ih - bh;
    const cx = x + bw / 2;
    const lbl = i % step === 0 ? `<text x="${cx}" y="${H - B + 18}" text-anchor="middle" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${esc(r.label)}</text>` : '';
    const val = bh > 18 ? `<text x="${cx}" y="${y - 6}" text-anchor="middle" fill="var(--text-2)" font-size="12" style="${NS_TEXT}">${fmt(r.value)}</text>` : '';
    return `<rect x="${x + 3}" y="${y}" width="${Math.max(1, bw - 6)}" height="${bh}" rx="3" fill="${color}"><title>${esc(r.label)}: ${fmt(r.value)}${unit}</title></rect>${val}${lbl}`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}${bars}</svg>`;
}

/** Line chart. rows: [{label, value}] (value may be null → skipped) */
export function lineChart(rows, { color = 'var(--warm)', fmt = (v) => v } = {}) {
  const W = 860, H = 300, L = 46, R = 14, T = 20, B = 46;
  const pts = rows.filter((r) => r.value != null);
  if (pts.length < 2) return '<p class="hint">Amostra insuficiente.</p>';
  const max = Math.max(1, ...pts.map((r) => r.value));
  const iw = W - L - R, ih = H - T - B;
  const X = (i) => L + iw * (i / (pts.length - 1));
  const Y = (v) => T + ih - ih * (v / max);
  const ticks = 4; let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max / ticks) * i, y = T + ih - (ih * i) / ticks;
    grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`
      + `<text x="${L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${fmt(Math.round(v))}</text>`;
  }
  const line = pts.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r.value).toFixed(1)}`).join(' ');
  const dots = pts.map((r, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(r.value).toFixed(1)}" r="3.5" fill="${color}"><title>${esc(r.label)}: ${fmt(r.value)}</title></circle>`).join('');
  const step = Math.ceil(pts.length / 12) || 1;
  const labels = pts.map((r, i) => i % step === 0 ? `<text x="${X(i)}" y="${H - B + 18}" text-anchor="middle" fill="var(--muted)" font-size="12" style="${NS_TEXT}">${esc(r.label)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img">${grid}<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5"/>${dots}${labels}</svg>`;
}

/** Horizontal bars. items: [{label, value, color?}] */
export function hbars(items, { fmt = (v) => v } = {}) {
  if (!items.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">` + items.map((it) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(it.label)}">${esc(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(it.value / max * 100).toFixed(1)}%;background:${it.color || 'var(--accent)'}"></div></div>
      <div class="bar-val">${fmt(it.value)}</div>
    </div>`).join('') + `</div>`;
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/charts.js`
Expected: no output.

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add public/charts.js
git commit -m "feat(metrics): reusable readable SVG chart module"
```

### Task 13: Rebuild the metrics page render + auth gate

**Files:**
- Modify: `public/timeline.js`

- [ ] **Step 1: Replace `public/timeline.js` entirely**

```js
import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
import { barChart, lineChart, hbars } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`;
const shortDay = (d) => String(d).slice(5); // MM-DD

function card(title, hint, body, wide = false) {
  return `<div class="card${wide ? ' card-wide' : ''}"><h3>${esc(title)}</h3>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${body}</div>`;
}

function render(t) {
  $('#meta').innerHTML = `Conta <strong>${esc(t.account || '')}</strong> · ${t.totalConversas} conversas · atualizado ${new Date(t.generatedAt).toLocaleString('pt-BR')}`;

  $('#kpis').innerHTML = [
    ['1ª resposta (mediana)', fmtMin(t.velocidade.primeiraRespostaMedianaMin), 'cliente → atendente'],
    ['1ª resposta (média)', fmtMin(t.velocidade.primeiraRespostaMediaMin), 'inflada por respostas noturnas'],
    ['Conversão', `${t.conversao.taxa}%`, `${t.conversao.vendidos}/${t.conversao.entraram} em negociação`],
    ['Aguardando', String(t.atendentes.reduce((a, x) => a + x.aguardando, 0)), 'clientes sem resposta agora'],
    ['Amostra', String(t.respostaAmostras), 'conversas (45 dias)'],
  ].map(([k, v, s]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

  const volume = barChart(t.volumePorDia.map((d) => ({ label: shortDay(d.dia), value: d.novas })), { color: 'var(--accent)' });
  const speed = lineChart(t.respostaPorDia.map((d) => ({ label: shortDay(d.dia), value: d.medianaMin })), { color: 'var(--warm)', fmt: (v) => `${v}m` });
  const dist = hbars(t.velocidade.distribuicao.map((d) => ({
    label: d.faixa, value: d.n, color: /4 h|> 4/.test(d.faixa) ? 'var(--hot)' : 'var(--accent)',
  })));
  const funnel = hbars([
    { label: 'Aberto', value: t.situacao.Aberto, color: 'var(--cold)' },
    { label: 'Vendido', value: t.situacao.Vendido, color: 'var(--sold)' },
    { label: 'Descartado', value: t.situacao.Descartado, color: 'var(--hot)' },
  ]);

  // Volume por atendente: chart + complete table
  const agChart = barChart(t.volumePorAtendente.map((a) => ({ label: a.nome, value: a.conversas })), { color: 'var(--accent)' });
  const slow = Math.max(0, ...t.atendentes.map((a) => a.primeiraRespostaMedianaMin || 0));
  const agTable = `<div class="tbl-wrap"><table class="metrics-tbl"><thead><tr>
    <th>Atendente</th><th>Chats no mês</th><th>Chats (45d)</th><th>1ª resp. mediana</th>
    <th>1ª resp. média</th><th>Vendas</th><th>Conversão</th><th>Aguardando</th></tr></thead><tbody>
    ${t.atendentes.map((a) => `<tr>
      <td class="ag-name">${esc(a.nome)}</td>
      <td>${a.chatsMes}</td><td>${a.conversas}</td>
      <td class="${a.primeiraRespostaMedianaMin && a.primeiraRespostaMedianaMin >= 240 ? 'slow' : ''}">${fmtMin(a.primeiraRespostaMedianaMin)}</td>
      <td>${fmtMin(a.primeiraRespostaMediaMin)}</td>
      <td>${a.vendas}</td><td>${a.taxaConversao}%</td><td>${a.aguardando}</td></tr>`).join('')}
    </tbody></table></div>`;

  const hist = (t.historico && t.historico.length > 1)
    ? lineChart(t.historico.map((h) => ({ label: (h.at || '').slice(5, 10), value: h.abertos })), { color: 'var(--cold)' })
    : '<p class="hint">O histórico do pipeline é acumulado a cada extração. Rode "Extrair" ao longo dos dias para ver a evolução.</p>';

  $('#grid').innerHTML = [
    card('Volume de conversas por dia', 'novas conversas iniciadas', volume, true),
    card('Velocidade de 1ª resposta (mediana/dia)', 'tempo real entre a pergunta do cliente e a resposta', speed, true),
    card('Distribuição da 1ª resposta', 'vermelho = lento (> 4 h)', dist),
    card('Funil / Situação', 'leads que entraram em negociação', funnel),
    card('Volume por atendente', 'chats no mês, velocidade de 1ª resposta, vendas e conversão', agChart + agTable, true),
    card('Pipeline ao longo do tempo', 'leads abertos por extração', hist, true),
  ].join('');
}

async function load(refreshData) {
  $('#overlay').hidden = false;
  try {
    const res = await authFetch(refreshData ? '/api/timeline/refresh' : '/api/timeline', { method: refreshData ? 'POST' : 'GET' });
    const t = await res.json();
    if (!res.ok) throw new Error(t.error || 'Falha');
    render(t);
  } catch (e) { $('#meta').textContent = 'Erro: ' + e.message; }
  finally { $('#overlay').hidden = true; }
}

// ---- auth gate + header ----
function paintUser() {
  const email = currentUser() || '';
  $('#user-name').textContent = email || '—';
  $('#user-initial').textContent = (email[0] || '·').toUpperCase();
}
async function boot() {
  try { await refresh(); $('#login').hidden = true; paintUser(); load(false); }
  catch { $('#login').hidden = false; }
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-err');
  btn.disabled = true; err.hidden = true;
  try { await login($('#login-email').value.trim(), $('#login-pass').value); $('#login').hidden = true; paintUser(); load(false); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; }
});
$('#user-chip').addEventListener('click', (e) => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
$('#btn-logout').addEventListener('click', (e) => { e.preventDefault(); clearAuth(); location.reload(); });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });
$('#btn-refresh').addEventListener('click', () => load(true));

boot();
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/timeline.js`
Expected: no output.

- [ ] **Step 3: Commit** *(ask first)*

```bash
git add public/timeline.js
git commit -m "feat(metrics): readable charts, complete per-attendant view, auth gate"
```

### Task 14: Metrics + header + login styles

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Append the styles**

```css
/* ---- unified topbar ---- */
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 20px; padding: 12px 20px; background: var(--surface-2); border-bottom: 1px solid var(--border); }
.logo { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: var(--accent); color: #fff; font-weight: 800; font-size: 13px; letter-spacing: .5px; }
.brand { display: flex; align-items: center; gap: 11px; }
.brand h1 { margin: 0; font-size: 16px; }
.tabs { display: flex; gap: 18px; margin-left: 8px; }
.actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.usermenu { position: relative; }
.user-chip { display: flex; align-items: center; gap: 8px; padding: 6px 10px; }
.avatar { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--accent-weak); color: var(--accent); font-weight: 700; font-size: 12px; }
.usermenu .menu-list { position: absolute; right: 0; top: 110%; min-width: 140px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--r); overflow: hidden; z-index: 20; }

/* ---- login overlay ---- */
.login-scrim { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(8,11,20,.86); backdrop-filter: blur(3px); }
.login-card { width: 320px; background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: 14px; padding: 26px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.login-brand { display: flex; align-items: center; gap: 10px; font-size: 16px; }
.login-sub { margin: 0 0 6px; color: var(--muted); font-size: 12.5px; }
.login-card label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-2); }
.login-card input { background: var(--surface); border: 1px solid var(--border-strong); color: var(--text); padding: 9px 11px; border-radius: var(--r); outline: none; }
.login-card input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-weak); }
.login-card .primary { margin-top: 4px; }
.login-err { margin: 0; color: var(--hot); font-size: 12.5px; }

/* ---- metrics ---- */
.tl-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 16px; }
.card-wide { grid-column: 1 / -1; }
.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 14px; margin-bottom: 18px; }
.kpi { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 3px; }
.kpi b { font-size: 26px; font-variant-numeric: tabular-nums; }
.hbars { display: flex; flex-direction: column; gap: 9px; margin-top: 6px; }
.bar-row { display: grid; grid-template-columns: 130px 1fr 60px; align-items: center; gap: 10px; }
.bar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2); font-size: 12.5px; }
.bar-track { height: 12px; background: var(--surface); border-radius: 6px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 6px; }
.bar-val { text-align: right; font-variant-numeric: tabular-nums; color: var(--text-2); }
.tbl-wrap { overflow-x: auto; margin-top: 14px; }
.metrics-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.metrics-tbl th { text-align: left; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .04em; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.metrics-tbl td { padding: 9px 10px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
.metrics-tbl .ag-name { font-weight: 600; color: var(--text); }
.metrics-tbl .slow { color: var(--hot); font-weight: 600; }
@media (max-width: 900px) { .tl-grid { grid-template-columns: 1fr; } }
```

- [ ] **Step 2: Commit** *(ask first)*

```bash
git add public/style.css
git commit -m "feat(ui): topbar, login overlay, and readable metrics styles"
```

---

## Phase 7 — Launcher, docs, audit report, verification

### Task 15: Update launcher, `.env.example`, README

**Files:**
- Modify: `Iniciar-ExtractNeoron.bat`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Remove `.env` credential setup from the launcher**

In `Iniciar-ExtractNeoron.bat`, delete the entire "3) Arquivo .env com as credenciais" block (the `if not exist ".env"` section that copies the example and opens Notepad). The login now happens in the browser.

- [ ] **Step 2: Annotate `.env.example`**

Change the credential lines to note they are for the dev tool only:

```
# NEORON_EMAIL/PASSWORD são usados APENAS pelo discover.js (mapeamento).
# O dashboard NÃO usa mais .env para login — cada pessoa entra pelo navegador.
NEORON_EMAIL=you@example.com
NEORON_PASSWORD=your-password-here
```

- [ ] **Step 3: Update the README "Uso" section**

Replace the `npm run extract` / login guidance with: start via `Iniciar-ExtractNeoron.bat` (or `npm run serve`), open `http://localhost:3000`, and log in with your Neoron account (the browser remembers you). Note `.env` creds are only for `discover.js`.

- [ ] **Step 4: Commit** *(ask first)*

```bash
git add Iniciar-ExtractNeoron.bat .env.example README.md
git commit -m "docs: browser login flow; .env creds now discover-only"
```

### Task 16: Dependency + secret audit

**Files:**
- (no code) audit commands

- [ ] **Step 1: Dependency scan**

Run: `npm audit --omit=dev`
Record findings. For each fixable advisory, run `npm audit fix` (avoid `--force` unless a breaking bump is reviewed). Re-run until clean or documented.

- [ ] **Step 2: Confirm secrets are not tracked**

Run: `git ls-files | findstr /I ".env storageState data/"`
Expected: no output (nothing tracked). If anything shows, `git rm --cached` it and confirm `.gitignore` covers it.

- [ ] **Step 3: Scan history for a leaked password**

Run: `git log -p -S "NEORON_PASSWORD=" -- . 2>NUL`
Expected: no real password committed. Document the result.

- [ ] **Step 4: Commit any audit-driven dependency bumps** *(ask first)*

```bash
git add package.json package-lock.json
git commit -m "chore(security): npm audit fixes"
```

### Task 17: Write `SECURITY.md`

**Files:**
- Create: `SECURITY.md`

- [ ] **Step 1: Write the report**

Document, with the concrete outcomes from Task 16 and the code changes:
- **Access control:** all `/api/*` now require a verified Firebase ID token (`src/auth.js`, `requireAuth`). Previously the LAN dashboard was unauthenticated.
- **Auth model:** browser-direct Firebase; password → Google over TLS only; browser stores the refresh token (not the password); server verifies RS256 locally.
- **XSS:** hardened `esc()` (adds `'` `` ` ``); strict CSP (`script-src 'self'`, no third-party JS); customer text is always escaped before `innerHTML`.
- **Injection:** CSV/Excel formula injection neutralized (`src/sanitize.js`).
- **Secrets:** the Firebase web API key is public by design (Firebase security = tokens + rules); `.env`, `data/`, `storageState.json` are git-ignored and untracked (verified).
- **Dependencies:** `npm audit` result and any fixes applied.
- **Info disclosure:** API errors return generic messages; internals are server-log only; tokens/passwords are never logged.
- **Residual risks:** plain-HTTP LAN carries the short-lived idToken (enable HTTPS on an untrusted network); refresh token in `localStorage` (mitigated by CSP + escaping).

- [ ] **Step 2: Commit** *(ask first)*

```bash
git add SECURITY.md
git commit -m "docs(security): audit report and residual risks"
```

### Task 18: Full test run + manual verification

**Files:**
- (no code)

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS — auth, sanitize, timeline-agg all green.

- [ ] **Step 2: Manual end-to-end (documented)**

Launch `Iniciar-ExtractNeoron.bat` (or `npm run serve`) and in a browser:
- [ ] Visiting `http://localhost:3000` shows the **login overlay** (not the data).
- [ ] `curl http://localhost:3000/api/data` returns **401**.
- [ ] Logging in with a valid Neoron account loads the leads; the **user chip** shows the email.
- [ ] Reloading the page **auto-logs-in** (no retype).
- [ ] Hot leads: the signals text is **light/readable**, not red.
- [ ] **Métricas** page: charts are large and readable with axis labels; the **Volume por atendente** table shows chats-no-mês, 1ª resposta média/mediana, vendas, conversão, aguardando.
- [ ] Export **Excel** and **CSV** download through the authenticated path; a cell like `=1+1` is stored as text (`'=1+1`).
- [ ] **Sair** clears the session and returns to the login overlay.

- [ ] **Step 3: Final confirmation.** Report results to the user; do not claim success for any checkbox not actually observed.

---

## Self-Review (completed)

- **Spec coverage:** login (T8–T10, T13), auto-login (refresh in T8/boot), own-account model (browser login), security gating (T7), XSS/CSP (T7, T10, esc hardening), formula injection (T2–T3), secret/dep audit (T16), SECURITY.md (T17), leads red-text fix (T11), metrics redesign + attendant table (T6, T12–T14), header rework (T9, T14). All spec sections mapped.
- **Placeholders:** none — every code step contains full code.
- **Type consistency:** `verifyIdToken`→`{idToken,localId,email}` used by `requireAuth`→`req.auth` passed to `extractNegociando(auth)`/`buildTimeline(auth)`. `aggregateAttendants(stats,currentMonth)` fields (`chatsMes`, `primeiraRespostaMedianaMin`, `primeiraRespostaMediaMin`, `taxaConversao`) match the timeline render in T13. `authFetch`/`login`/`refresh`/`clearAuth`/`currentUser` exported in T8 and consumed in T10/T13. Chart fns `barChart`/`lineChart`/`hbars` signatures match T13 calls.
