# ExtractNeoron — Production Hardening Design

**Date:** 2026-08-07
**Status:** Approved for planning (pending final spec review)

## 1. Overview & Goals

Take ExtractNeoron from a single-user local tool to a small **multi-user production**
dashboard on the LAN. Four workstreams:

1. **Web login** — each attendant logs in with **their own Neoron account**; the
   browser auto-logs-in on return. Replaces the shared `.env` credentials.
2. **Security hardening** — close the "open on the LAN" hole, full audit + fixes,
   deliver `SECURITY.md`.
3. **Leads UX** — remove the low-contrast red text on hot leads; clean up the
   lead cell hierarchy and contrast.
4. **Metrics UX** — readable, larger charts; a complete per-attendant view
   (monthly chats, first-response time, sales, waiting); reimagined layout.
5. **Header rework** — unified top bar on both pages: **ExtractNeoron** wordmark
   + logged-in user + logout.

## 2. Non-Goals

- No HTTPS/TLS termination in this pass (documented as residual risk; the LAN is
  treated as trusted). 
- No server-side user database or role system — authorization is "any valid
  Neoron user for the `neoron` project."
- No change to the extraction/enrichment logic (product matching, metrics math).
- No third-party charting or UI framework.

## 3. Authentication Architecture (chosen: browser-direct Firebase)

```
Browser                          Our Server                 Google (HTTPS)
  |  signInWithPassword (HTTPS) ----------------------------->  Firebase Auth
  |  <-- idToken, refreshToken, localId, email ---------------
  |  store {email, refreshToken} in localStorage
  |
  |  GET/POST /api/*  (Authorization: Bearer <idToken>) --> requireAuth
  |                                             verify idToken locally (RS256)
  |                                             use idToken for Firestore reads
  |  <-- data / 401 -----------------------------------------
  |
  |  on 401 or startup: exchange refreshToken (HTTPS) -------> securetoken API
  |  <-- fresh idToken --------------------------------------
```

**Why this model:** the password travels **browser → Google over TLS only** — never
across the plain-HTTP LAN, never stored by us. The server is **stateless** (no
session store): every request self-authenticates with its Bearer `idToken`. The
Firebase **web API key is public by design** (Firebase's security model relies on
tokens + rules, not key secrecy), so putting it in client JS is not a leak.

**What the browser stores:** `{ email, refreshToken }` in `localStorage`. The raw
password is never persisted.

### 3.1 Token lifecycle
- `idToken` lifetime ≈ 1 h. On expiry, an API call returns `401`; the client
  transparently exchanges the `refreshToken` for a new `idToken` and retries once.
- `refreshToken` is long-lived; used only browser → Google. Logout clears it.

### 3.2 Server-side token verification (`src/auth.js`, new)
Verify the Firebase ID token **locally** (no per-request round-trip to Google):
- Parse JWT header/payload; require `alg === "RS256"`.
- Fetch & cache Google's public x509 certs from
  `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`
  (respect `Cache-Control: max-age`).
- Verify RS256 signature with Node's built-in `crypto` (no new dependency).
- Assert claims: `iss === "https://securetoken.google.com/neoron"`,
  `aud === "neoron"`, `exp` in the future, `sub` present.
- On success attach `req.auth = { idToken, localId: sub, email }`; else `401`.
- Export `requireAuth` Express middleware.

## 4. Component Changes

| File | Change |
|---|---|
| `src/auth.js` **(new)** | Firebase ID-token verifier + `requireAuth` middleware + cert cache. |
| `src/firestore.js` | Keep REST helpers. Move `API_KEY`/`PROJECT` to shared consts reused by client login. `signIn()` remains only for `discover.js`/CLI, no longer used by the server. |
| `src/extractor.js` | `extractNegociando(auth)` accepts `{ idToken, localId, email }` from the caller instead of calling `signIn()`. CLI entrypoint keeps calling `signIn()` from `.env`. |
| `src/timeline.js` | `buildTimeline(auth)` accepts caller auth. Add per-attendant **monthly** aggregation + first-response mean/median + conversion. |
| `src/server.js` | Apply `requireAuth` to all `/api/*`. Read the caller's token from `req.auth`, pass to `extractNegociando`/`buildTimeline`. Add security headers (CSP, X-Content-Type-Options, Referrer-Policy). Sanitize error responses. |
| `src/config.js` | `.env` Neoron creds become optional (CLI/discover only). Keep `PORT`, tag name. |
| `public/index.html`, `public/timeline.html` | New unified header; login gate/overlay; container for redesigned metrics. |
| `public/auth.js` **(new)** | Client login/auto-login/refresh helpers + `authFetch()` wrapper that attaches the Bearer token and retries once on 401. |
| `public/app.js`, `public/timeline.js` | Use `authFetch()`; render login screen when unauthenticated; header user chip + logout. |
| `public/style.css` | Fix `.motivo.t-quente`; header, login card, and metrics styles. |
| `Iniciar-ExtractNeoron.bat` | Stop opening `.env`/Notepad for credentials (login is in the browser now). |
| `.env.example` | Note that `NEORON_EMAIL/PASSWORD` are only for the `discover.js` dev tool. |
| `SECURITY.md` **(new)** | Audit report + residual risks. |

## 5. Security Audit Plan & Fixes

Audit and fix (each becomes a checklist item in the plan):

1. **Access control** — `requireAuth` on every `/api/*` (fixes unauthenticated LAN access to leads, phone numbers, extraction, downloads).
2. **XSS** — customer-controlled names/messages render via `innerHTML`. Harden the shared `esc()` (also escape `'` and `` ` ``); audit every interpolation in `app.js`/`timeline.js`/new client code; add a **Content-Security-Policy** (`default-src 'self'`; allow the Google auth/securetoken/Firestore origins for `connect-src`).
3. **CSV/Excel formula injection** — prefix cells beginning with `= + - @ tab CR` with `'` in `xlsx.js` and the CSV writer.
4. **Secrets** — scan git history for committed secrets; confirm `.env`, `data/`, `storageState.json` are git-ignored and untracked; document the public Firebase web key.
5. **Dependency CVEs** — `npm audit`; bump vulnerable transitive/direct deps (express, exceljs, playwright) to patched versions.
6. **Information disclosure** — stop returning raw `e.message`/stack to clients; log server-side only; never log tokens/passwords.
7. **Open-redirect / traversal** — confirm `express.static` is scoped to `public/`; downloads serve fixed paths only.
8. **Web research pass** — check current advisories for Firebase ID-token verification pitfalls (alg confusion, missing `aud`/`iss` checks), Express, and exceljs; fold mitigations in.

Deliverable: `SECURITY.md` with findings, fixes applied, and residual risks.

## 6. Leads UX Fixes

- `style.css:91` `.motivo.t-quente { color:#a2402f }` → **light neutral text**
  (`var(--text-2)`), no red. Same for any other temperature-tinted body text that
  hurts contrast. Temperature stays signaled by the **left border stripe** + the
  **colored temperature pill**, not by red running text.
- Review the name-cell stack (pill · name · situação/aguardando badges · signals ·
  tags): consistent spacing, clear visual hierarchy, and the **Contexto** column in
  readable light text. Verify WCAG-ish contrast on the dark theme.

## 7. Metrics (Timeline) Redesign

**Backend (`src/timeline.js`)** — extend the result with:
- `atendentes[]` gains: `chatsMes` (chats in the current calendar month),
  `primeiraRespostaMediaMin`, `primeiraRespostaMedianaMin`, `taxaConversao`.
- `volumePorAtendente` sorted desc for the headline chart.
- Keep existing daily volume, response-per-day, distribution, funnel, history.

**Frontend charts (upgraded hand-drawn SVG, `public/timeline.js`)** — a small,
reusable chart module with:
- Larger responsive canvases; **explicit `font-size`** and high-contrast label
  colors (fixes the "too tiny to read" problem).
- Y-axis ticks + horizontal gridlines; X-axis labels that thin out gracefully.
- **Value labels** on bars/points; hover `<title>` tooltips; legends where needed.
- Chart types: vertical bars (volume/day), line (median first-response/day),
  horizontal bars (first-response distribution, funnel), and a **grouped
  horizontal-bar "Volume por atendente"** as the centerpiece.

**"Volume por atendente" section** — a really complete view:
- A prominent ranked bar chart of chats per attendant.
- A rich **table**: Atendente · Chats no mês · Chats (amostra 45d) · 1ª resposta
  (mediana) · 1ª resposta (média) · Vendas · Conversão % · Aguardando — sortable,
  with the slowest first-response highlighted.

**Layout** — reimagined responsive grid: a KPI strip up top with larger numbers,
then cards sized to their content (the attendant section spans full width).

## 8. Header Rework (both pages)

Unified top bar, identical on Leads and Métricas:
- **Left:** logo mark + **ExtractNeoron** wordmark (+ small page subtitle).
- **Center:** nav tabs (Leads · Métricas) with active state.
- **Right:** page actions (Extrair/Exportar or Recalcular) + a **user chip**
  showing the logged-in person (avatar initial + name/email) with a dropdown
  containing **Sair (logout)**.
- Sticky, accessible (keyboard-focusable menu), consistent spacing.

## 9. Error Handling

- Client `authFetch()`: on `401` → refresh once → retry; if still `401` → show the
  login screen. Network errors → toast, no crash.
- Server: `requireAuth` returns `401` with a generic message; other handlers
  return sanitized errors (no stack/internal detail).

## 10. Testing Plan

- **Unit (Node, TDD):** `auth.js` token verification — valid token passes; wrong
  `aud`/`iss`, expired `exp`, bad signature, `alg:none`/HS256 confusion all reject.
  CSV/Excel formula-injection escaping. `esc()` hardening.
- **Integration:** `/api/*` returns `401` without a valid Bearer; `200` with one
  (using a stubbed verifier). `extractNegociando(auth)` uses the passed token.
- **Manual (documented):** launch via `.bat`, log in, auto-login on reload,
  logout; verify leads render with fixed contrast; verify metrics are readable and
  the attendant table/chart populate.

## 11. Residual Risks (documented, not silently accepted)

- **Plain-HTTP LAN:** the short-lived `idToken` (≤1 h) crosses the LAN as a Bearer.
  On an untrusted network, enable HTTPS. Password + refresh token avoid this hop.
- **localStorage refresh token:** readable by JS on that origin → mitigated by the
  strict CSP + `esc()` hardening (reduce XSS), and by storing the refresh token
  rather than the password. Logout revokes locally.

## 12. Rollout

- Update `Iniciar-ExtractNeoron.bat` to skip `.env` credential setup.
- Update `README.md` for the login flow and the fact that `.env` creds are now only
  for `discover.js`.
- No data migration; `data/` artifacts remain compatible.
