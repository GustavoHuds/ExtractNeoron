# ExtractNeoron — Project Scope

> **Version:** 1.0 · **Date:** 2026-08-18 · **Author:** Gustavo Hudson  
> This document describes the current state of the system as the baseline for a complete rework. It covers purpose, data pipeline, full feature set, metric definitions, and current limitations.

---

## 1. Purpose & Strategic Intent

ExtractNeoron is an internal sales-intelligence dashboard built to serve the Lojas Belmont commercial team. Its core mission is to turn the raw volume of WhatsApp conversations managed inside **Neoron** (a WhatsApp Official API platform) into an actionable, prioritized pipeline of leads — with zero manual data entry.

The problem it solves: Neoron's native inbox is a message queue, not a CRM. Salespeople cannot easily tell which conversations are hot, who has been waiting the longest, which leads were won or lost, or what the team's response speed looks like. ExtractNeoron bridges this gap by reading Neoron's underlying Firebase data, computing engagement signals, and serving a purpose-built dashboard.

**Design principles:**
- **No third-party SaaS dependency.** Runs entirely on the team's own VPS, behind Docker Compose and a VPN/reverse proxy. Data never leaves the company's infrastructure.
- **Zero schema drift.** The data model is discovered and reverse-engineered from Neoron's Firebase Firestore in real time; there is no static schema to maintain.
- **Low cost.** The only billable external call is the optional Claude AI scoring (Anthropic API), which is cached per conversation and only re-runs when a conversation changes.
- **Multi-user, shared state.** Lead closures, call attempt logs, and team justifications are stored server-side so any team member's action is immediately visible to everyone on the same network.

---

## 2. System Architecture

### 2.1 Stack

| Layer | Technology |
|---|---|
| Backend runtime | Node.js 20+ (ES modules) |
| HTTP server | Express 4 |
| Security headers | Helmet (CSP, HSTS via proxy, no-referrer) |
| Rate limiting | express-rate-limit (600 req / 15 min) |
| Frontend | Vanilla JavaScript, no build step |
| Charts | Custom SVG library (`public/charts.js`) |
| AI scoring | Anthropic SDK (`@anthropic-ai/sdk`) — optional |
| Excel export | ExcelJS |
| Data source | Google Cloud Firestore REST API (Neoron's Firebase project) |
| Auth | Firebase Auth REST (email + password → idToken) |
| Persistence | Local JSON files (`data/` directory, git-ignored) |
| Containerization | Docker + Docker Compose |
| Deployment target | VPS, exposed only on `127.0.0.1` / VPN |

### 2.2 Process Flow — Extraction Pipeline

```
User clicks "Extrair"
        │
        ▼
POST /api/extract  (backend, authenticated)
        │
        ├─── 1. Firebase Auth REST
        │         POST identitytoolkit.googleapis.com/v1/accounts:signInWithPassword
        │         → idToken (short-lived JWT)
        │
        ├─── 2. List accessible bots
        │         Firestore query: bots_draft WHERE users ARRAY_CONTAINS localId
        │         → [ { id, name } ]   (e.g. "Lojas Belmont")
        │
        └─── 3. For each bot:
              │
              ├─── 3a. Load support maps (paginated, 300 docs/page)
              │         bots/{botId}/agents      → { id → name }
              │         bots/{botId}/departments → { id → name }
              │
              ├─── 3b. Fetch all conversations (paginated)
              │         bots/{botId}/conversations_metadata/{convId}
              │         Fields: contact.name, contact.phone_number, contact.tags,
              │                 contact.tags_id, last_message_at, status, agent,
              │                 department, unread_messages, last_message_sender,
              │                 last_message_text, channel
              │
              ├─── 3c. Filter: keep only conversations where contact carries the
              │         "negociando" tag (resolved by name, not hardcoded ID)
              │
              └─── 3d. For each matching conversation:
                        │
                        ├─── Fetch full message history
                        │     bots/{botId}/conversations/{convId}/messages
                        │     (paginated, sorted chronologically)
                        │
                        ├─── Compute response-speed metrics (src/metrics.js)
                        ├─── Compute lead temperature + interest signals (src/metrics.js)
                        ├─── Detect product via regex (src/products.js)
                        ├─── Match product to catalog via TF-IDF (src/catalog.js)
                        ├─── Optionally score agent performance via Claude AI (src/ai.js)
                        ├─── Overlay done/no-answer state from local JSON (src/store.js)
                        └─── Emit normalized lead row
```

Result is written to `data/negociando.json` (rows + summary) and `data/negociando.csv`. A pipeline snapshot is appended to `data/history.jsonl` for trend tracking.

### 2.3 Authentication & Authorization

- The browser authenticates the user against Firebase Auth using their existing Neoron credentials (email + password).
- The resulting `idToken` (Firebase JWT, RS256) is sent as `Authorization: Bearer <token>` on every API call.
- The backend (`src/auth.js`) verifies the token against Firebase's public JWKS endpoint before serving any `/api/*` route.
- An optional `AUTHORIZED_EMAILS` allowlist in `.env` restricts access to specific accounts. If empty, any valid Neoron account is accepted.
- The server is designed to run behind a VPN or `127.0.0.1`-only binding — it is not meant to be public-facing.

---

## 3. Lead Data Model

Every lead is a normalized object derived from a single Neoron conversation. Below is the complete field map as it exists today.

### 3.1 Identity

| Field | Type | Source |
|---|---|---|
| `conversationId` | string | Firestore document ID |
| `bot` | string | Bot display name (e.g. "Lojas Belmont") |
| `botId` | string | Firebase bot document ID |
| `nome` | string | `contact.name` or formatted phone fallback |
| `contato` | string | Formatted phone: `+55 (83) 9408-1342` |
| `telefone` | string | Raw digits only: `558394081342` |
| `chatUrl` | string | Direct link to the conversation in Neoron's web app |

### 3.2 Classification

| Field | Type | Values / Logic |
|---|---|---|
| `situacao` | enum | `Aberto` · `Vendido` · `Descartado` — derived from contact tags (`"venda realizada"` → Vendido, `"desqualificado"` → Descartado) |
| `statusSistema` | string | Raw Neoron system status: `CHATBOT`, `TAKEOVER_QUEUE`, `TAKEOVER_IN_ATTENDANCE`, `TAKEOVER_FINISHED`, `FINISHED` |
| `canal` | string | Communication channel from Firestore (e.g. `"WHATSAPP"`) |
| `tags` | string[] | All contact tags from Firestore (merged from `contact.tags` + `conversation.tags`) |
| `temperatura` | enum | `quente` · `morno` · `frio` — computed from interest signals + recency (see §4.2) |
| `motivos` | string[] | Human-readable interest signal labels explaining the temperature |
| `interesseScore` | number | Raw weighted score from signal matching |

### 3.3 Product Intelligence

| Field | Type | Source |
|---|---|---|
| `produto` | string | Detected product name or category |
| `produtoCodigo` | string | SKU from the catalog (if matched) |
| `produtoPreco` | number\|null | Price from the catalog (if matched) |
| `produtoCategoria` | string | Category: Colchão, Cama, Guarda-roupa, Cômoda, Poltrona, Sofá, etc. |
| `produtoFonte` | enum | `"catálogo"` (TF-IDF match) or `"categoria"` (regex keyword) |
| `produtoTrecho` | string | Message snippet or matched tokens that triggered product detection |

### 3.4 Team

| Field | Type | Source |
|---|---|---|
| `atendente` | string | Parsed from agent message prefixes (e.g. `"Jonas: bom dia"` → `"Jonas"`); most-frequent name wins |
| `departamento` | string | Resolved from Firestore department ID |

### 3.5 Timing & Engagement

| Field | Type | Meaning |
|---|---|---|
| `ultimaInteracao` | ISO string | Timestamp of the last message in the conversation |
| `ultimaInteracaoMs` | number | Same as epoch milliseconds |
| `horasDesde` | number | Hours elapsed since the last message |
| `aguardando` | boolean | Customer sent the last message and has not received a human reply yet |
| `aguardandoMin` | number | Minutes the customer has been waiting (only when `aguardando: true`) |
| `paraLigar` | boolean | Customer has been waiting 24 h or more — belongs in the call queue |
| `primeiraRespostaMin` | number | Time in minutes from the customer's first message to the first human agent reply |
| `respostaMedianaMin` | number | Median human response time across all customer-sent turns |
| `naoLidas` | number | Unread message count (from Firestore metadata) |
| `ultimoRemetente` | enum | `"user"` · `"agent"` · `"bot"` |
| `contexto` | string | Last message text, truncated to 280 characters |

### 3.6 Lead Closure

| Field | Type | Meaning |
|---|---|---|
| `feito` | boolean | Lead has been manually concluded by a team member |
| `feitoAt` | ISO string | When it was concluded |
| `feitoReason` | enum slug | `vendido` · `sem_retorno` · `sem_interesse` · `concorrente` · `outro` |
| `feitoReasonLabel` | string | Human label for the outcome |
| `feitoNota` | string | Free-text justification written by the team member |
| `feitoPor` | string | Email of the user who concluded the lead (from verified JWT, not client) |
| `arquivado` | boolean | Lead left the "negociando" tag but is retained in the Finalizados tab |

### 3.7 Call Attempt Tracking

| Field | Type | Meaning |
|---|---|---|
| `naoAtendeuCount` | number | Number of times the customer did not answer a call |
| `naoAtendeuAt` | ISO string | Timestamp of the most recent unanswered call attempt |
| `naoAtendeuNota` | string | Note from the last attempt |
| `noAnswerBucket` | boolean | `true` when `naoAtendeuCount >= 2` (triggers "Não atendeu" filter) |

### 3.8 AI Agent Scoring

| Field | Type | Meaning |
|---|---|---|
| `aiNota` | number\|null | 0–10 score of the salesperson's performance in that conversation (requires `ANTHROPIC_API_KEY`) |
| `aiMotivo` | string | One-sentence reason from Claude explaining the score |

---

## 4. Features & Functions

### 4.1 Extraction Engine (`src/extractor.js`)

- Authenticates with Firebase and traverses every bot the user has access to.
- Paginates Firestore collections (300 docs/page) — handles arbitrarily large contact bases.
- Filters conversations by the "negociando" contact tag, resolved by name (not by hardcoded ID).
- Fetches the full chronological message history per matching conversation.
- Normalizes all fields into the unified lead model.
- Writes results to `data/negociando.json` + `data/negociando.csv`.
- Appends a pipeline snapshot to `data/history.jsonl` (for trend visualization).
- Can be triggered from the browser (via `POST /api/extract`) or from the CLI (`npm run extract`).

### 4.2 Lead Temperature Engine (`src/metrics.js` — `leadScore`)

Classifies each lead as **quente / morno / frio** by pattern-matching customer messages against a weighted signal library:

| Signal category | Weight | Example triggers |
|---|---|---|
| Closing / purchase intent | +4 | "vou querer", "pode gerar o link", CPF sent, payment confirmed |
| Active interest | +2 | price question, delivery question, product approval |
| Info request | +1 | asking for photos, measurements, colors, stock |
| Postponement | −1 | "vou pensar", "depois retorno", "semana que vem" |
| Price objection | −4 | "muito caro", "fora do orçamento", "sem condições" |
| Rejection / disinterest | −4 | "não quero", "desisti", "só estava olhando" |
| Credit rejected | −3 | "não passou", "nome sujo", "no Serasa" |

Recent messages (last 4 from the customer) carry **1.5× weight**. A strong recent negative overrides older positives (customer cooled off). Temperature bands:

- **Quente:** score ≥ 4 AND at least 2 distinct positive signal categories, OR any closing signal present.
- **Morno:** 1 ≤ score < 4, or neutral with last interaction under 72 h.
- **Frio:** recent strong negative, score ≤ −3, or idle > 72 h.

### 4.3 Response Speed Metrics (`src/metrics.js` — `responseMetrics`)

Correctly measures **human** response speed by ignoring bot auto-replies:

- A "response" = elapsed time from the customer's first unanswered message to the next **agent** (not bot) reply.
- Computes: first response time, average response time, median response time, total response count.
- Detects whether the customer is currently waiting and for how long.

### 4.4 Product Detection (`src/products.js` + `src/catalog.js`)

Two-tier detection:

1. **Keyword / regex (fallback):** Identifies furniture/bedding categories (Colchão, Cama box, Guarda-roupa, Cômoda, Poltrona, Sofá, etc.) from conversation text. Extracts model names from patterns like `"conjunto [MODEL]"`.
2. **Catalog TF-IDF match (primary):** If a product catalog is loaded, applies TF-IDF scoring between conversation text and catalog entries to find the best-matching SKU with name and price. Only activates if `data/catalogo.json` is present.

### 4.5 AI Agent Performance Scoring (`src/ai.js`)

When `ANTHROPIC_API_KEY` is set, each conversation is evaluated by Claude (default: `claude-haiku-4-5`):

- **Score:** 0–10 rating of the salesperson's performance in four dimensions: presence, clarity, proactivity, friendliness.
- **Cached per conversation:** re-scores only when the transcript changes (keyed by `conversationId + lastMessageMs`), minimizing API spend.
- **Compact transcript:** sends at most the last 40 messages, stripped to plain text, with prompt caching enabled.
- Score and reason are surfaced in the leads table and included in CSV/Excel exports.

### 4.6 Dashboard — Leads View (`public/index.html` + `public/app.js`)

**Statistics bar:**

| Stat | Definition |
|---|---|
| Abertos | Open leads (situacao = Aberto, not concluded) |
| Quentes | Hot leads (temperatura = quente) |
| Aguardando resposta | Customer is waiting for a human reply right now |
| Para ligar +24h | Customer has been waiting 24 h or more |
| Não atendeu | Leads with 2 or more unanswered call attempts |
| Vendidos | Leads concluded with outcome "vendido" |
| Finalizados | Total concluded leads (all outcomes) |
| Atualizado | Timestamp of the last extraction |

**Segmentation dropdown:**

| Segment | Shows |
|---|---|
| Abertos | Open leads not yet concluded |
| Não atendeu | Leads in the no-answer bucket |
| Finalizados | All concluded leads (from `data/done.json` + archived snapshots) |
| Todos | Every lead in the extraction |
| Vendidos | Leads tagged "venda realizada" or concluded as vendido |
| Descartados | Leads tagged "desqualificado" |

**Filters:**

- Temperature chips (Quente / Morno / Frio) — multi-select, toggleable.
- "Só aguardando +24h" checkbox — restricts to call-queue leads.
- Full-text search across: name, phone, product, agent, department, context, tags.

**Leads table columns:**

| Column | Content |
|---|---|
| Lead | Name + temperature badge + situation badge + waiting badge + call-attempt count + done indicator + tag pills |
| Telefone | Formatted phone + copy button + WhatsApp link + transcript viewer (eye icon) |
| Produto | Product name; SKU and price shown when matched from catalog |
| Atendente | Parsed human agent name |
| Última mensagem | Absolute timestamp + relative "X ago" |
| Contexto | Last message text + AI score badge (when scored) |
| Ação | "Finalizar" button (or "✓ Concluído" if already done) |

**Default sort:** by effective waiting time (urgency-first). Column headers are clickable to override sort.

### 4.7 Chat Transcript Modal

Loads the full chronological message history of a conversation on demand (`GET /api/messages/:botId/:convId`). Displays sender, timestamp, and message content. Never cached on the server — always fetched live from Firestore.

### 4.8 Lead Closure — "Finalizar" Modal

Allows any authenticated team member to:

- **Set outcome:** Vendido / Sem retorno / Sem interesse / Comprou concorrente / Outro.
- **Register call attempt ("Não atendeu"):** bumps the call-attempt counter; two or more attempts move the lead to the Não atendeu bucket.
- **Return to queue:** resets the no-answer counter.
- **Reopen:** unmarks a previously concluded lead.
- **Write a justification:** free-text note, with reusable presets shared across the team.
- **Manage presets:** add or remove team-wide justification templates (`GET/POST /api/justificativas`).

The closure is recorded in `data/done.json` keyed by `conversationId`. The closing user's identity comes from the verified JWT (not the client), preventing spoofing. A lead snapshot (lightweight copy of key fields) is saved alongside the closure record so the Finalizados tab can display it even after the lead leaves the "negociando" tag.

### 4.9 Metrics / Timeline View (`public/timeline.html` + `src/timeline.js`)

A separate page that visualizes historical pipeline data from `data/history.jsonl`:

- **Daily volume chart:** number of Aberto leads over time.
- **Lead temperature over time:** Quente / Morno / Frio trend.
- **Conversion funnel:** Aberto → Vendido → Descartado.
- **First response time (median):** how fast the team replies to customers, trended over time.
- **Per-attendant stats table:** conversations handled, this month's chats, sales, conversion rate, median first response time.

Timeline data is built from `data/history.jsonl` (one snapshot per extraction) and cached in `data/timeline.json`.

### 4.10 Product Catalog Import

- Upload a CSV or JSON file from the dashboard (the "Catálogo" button).
- CSV parsing auto-detects delimiter (`,` or `;`) and handles BOM.
- Expected columns: `codigo`, `nome`, `preco`, `categoria` (other columns accepted but ignored).
- Saved to `data/catalogo.json`; persists across extractions until replaced.
- The extractor uses TF-IDF against catalog entries to enrich each lead with SKU + price.

### 4.11 Export

Two formats, both honor the currently active filter (only the visible leads are exported):

- **CSV** (`POST /api/download`) — UTF-8 with BOM for Excel compatibility. 32 columns covering all lead fields.
- **Excel / XLSX** (`POST /api/download.xlsx`) — formatted workbook via ExcelJS. Same column set.

---

## 5. Local Persistence Layer

All mutable state is stored in JSON files inside `data/` (git-ignored). This directory is the sole source of truth for team-shared state.

| File | Contents | Grows over time? |
|---|---|---|
| `data/negociando.json` | Latest full extraction output (rows + summary). Overwritten on each extraction. | No |
| `data/negociando.csv` | CSV mirror of the above. Overwritten. | No |
| `data/done.json` | Map of `conversationId → { done, at, reason, note, by, snap }`. Every concluded lead. | Yes |
| `data/noanswer.json` | Map of `conversationId → { count, at, by, note }`. Call attempt log. | Yes |
| `data/justificativas.json` | Array of reusable justification strings shared across the team. | Small |
| `data/history.jsonl` | One JSON line per extraction: pipeline summary snapshot. Used by the timeline. | Yes |
| `data/timeline.json` | Cached render of the timeline metrics. Regenerated on request. | Overwritten |
| `data/ai-scores.json` | Map of `conversationId → { nota, motivo, lastMs, at }`. AI scoring cache. | Yes |
| `data/catalogo.json` | Loaded product catalog. Replaced on import. | Replaced |

Finalized leads older than `DONE_RETENTION_DAYS` (default: 180 days) are automatically pruned from `data/done.json` on each extraction.

---

## 6. API Surface

All routes under `/api/*` require a valid Firebase ID token (`Authorization: Bearer <idToken>`).

| Method | Route | Description |
|---|---|---|
| GET | `/health` | Liveness probe (no auth) |
| GET | `/config.js` | Injects Firebase API key into the browser (no auth) |
| GET | `/api/data` | Returns the last extraction result from disk |
| POST | `/api/extract` | Triggers a full extraction from Neoron (idempotent-safe, mutex-guarded) |
| POST | `/api/done` | Mark / unmark a lead as concluded with outcome + note |
| GET | `/api/justificativas` | List team justification presets |
| POST | `/api/justificativas` | Add or remove a justification preset |
| POST | `/api/noanswer` | Register or reset a "Não atendeu" call attempt |
| GET | `/api/messages/:botId/:convId` | Fetch full transcript live from Firestore |
| GET | `/api/catalog` | Report catalog status (loaded, count, source) |
| POST | `/api/catalog` | Import a product catalog (CSV or JSON) |
| POST | `/api/download` | Export current filtered view as CSV |
| POST | `/api/download.xlsx` | Export current filtered view as Excel |
| GET | `/api/timeline` | Return (or build) the timeline metrics |
| POST | `/api/timeline/refresh` | Force a timeline rebuild |

Rate limit: 600 requests per 15 minutes per IP. Concurrent extraction and timeline builds are mutex-guarded to prevent duplicate runs.

---

## 7. Deployment

The system is deployed via Docker Compose on a VPS. The container is bound to `127.0.0.1` only; a reverse proxy (Caddy or nginx) handles TLS termination and optionally VPN enforcement. Secrets (`NEORON_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are injected via environment variables — never committed to source.

Key environment variables:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NEORON_PROJECT` | yes | `neoron` | Firebase project ID |
| `NEORON_API_KEY` | yes | — | Firebase Web API key |
| `AUTHORIZED_EMAILS` | no | (any) | Comma-separated allowlist of permitted emails |
| `HOST` | no | `0.0.0.0` | Bind address |
| `PORT` | no | `3000` | Listen port |
| `IDLE_THRESHOLD_HOURS` | no | `24` | Hours without reply before "idle" classification |
| `ANTHROPIC_API_KEY` | no | — | Enables AI agent scoring |
| `AI_MODEL` | no | `claude-haiku-4-5` | Model used for AI scoring |
| `DONE_RETENTION_DAYS` | no | `180` | Days before concluded leads are pruned |
| `NEGOCIANDO_TAG_NAME` | no | `negociando` | Contact tag name that identifies active leads |
| `CATALOG_PATH` | no | — | Absolute path to a pre-loaded catalog JSON |

---

## 8. Current Limitations

These are known gaps in the current version, documented as input for the rework:

1. **Single channel (WhatsApp only).** The `canal` field exists on every lead, but the extraction pipeline only reads from Neoron's "Direct" module (WhatsApp Official API). Instagram DMs, Messenger, or other channels are not ingested — even if Neoron itself routes them to the same Firestore collection.

2. **Single tag filter.** The extractor surfaces only leads carrying the "negociando" tag. There is no multi-tag strategy, no funnel-stage segmentation, and no way to view conversations at earlier or later stages (e.g., "primeiro contato", "proposta enviada").

3. **No real-time updates.** The dashboard is a snapshot: it only updates when a user manually clicks "Extrair". There is no polling, WebSocket, or push mechanism.

4. **Flat JSON persistence.** All state (done leads, call attempts, justifications, history) is stored as unindexed flat JSON files. This is fast and simple at current scale but does not support concurrent writes safely, and the files grow unboundedly without manual pruning (beyond the done-retention window).

5. **No role-based access control.** Any authenticated Neoron user with a valid email can see all leads, close leads, and modify team presets. There is no concept of manager vs. salesperson vs. admin.

6. **Extraction is slow on large bases.** Fetching every conversation under a bot (even to filter 95% of them out) scales linearly with total contact count. At thousands of contacts this takes 10–30 seconds.

7. **Product detection is heuristic.** TF-IDF matching and regex keyword detection work well for Belmont's catalog but require manual tuning when new product lines or naming conventions are introduced.

8. **Timeline metrics are batch-computed.** The historical view is only as granular as the extraction frequency. Between extractions, there is no visibility into what changed.

9. **No automated alerts.** There is no email, SMS, or Slack notification when a lead becomes hot, when a customer has been waiting too long, or when a lead is concluded.

10. **Single-bot assumption in the UI.** Although the extractor handles multiple bots, the dashboard displays all leads in one unified list without bot-level segmentation.

---

## 9. Data Dictionary — CSV Export Columns

The CSV/Excel export contains 32 columns in this order:

| # | Column header | Field | Notes |
|---|---|---|---|
| 1 | Nome | `nome` | |
| 2 | Contato | `contato` | Formatted phone |
| 3 | Telefone (raw) | `telefone` | Digits only |
| 4 | Situação | `situacao` | Aberto / Vendido / Descartado |
| 5 | Temperatura | `temperatura` | quente / morno / frio |
| 6 | Motivo (sinais) | `motivos` | Pipe-separated signal labels |
| 7 | Produto | `produto` | |
| 8 | Cód. produto | `produtoCodigo` | |
| 9 | Preço | `produtoPreco` | |
| 10 | Categoria | `produtoCategoria` | |
| 11 | Origem produto | `produtoFonte` | catálogo / categoria |
| 12 | Atendente | `atendente` | |
| 13 | Departamento | `departamento` | |
| 14 | Nota IA (0-10) | `aiNota` | |
| 15 | Motivo IA | `aiMotivo` | |
| 16 | Cliente aguardando | `aguardando` | Boolean |
| 17 | Aguardando (min) | `aguardandoMin` | |
| 18 | 1ª resposta (min) | `primeiraRespostaMin` | |
| 19 | Resp. mediana (min) | `respostaMedianaMin` | |
| 20 | Feito | `feito` | Boolean |
| 21 | Feito em | `feitoAt` | ISO timestamp |
| 22 | Motivo (desfecho) | `feitoReasonLabel` | |
| 23 | Justificativa | `feitoNota` | |
| 24 | Concluído por | `feitoPor` | Email |
| 25 | Status | `statusSistema` | Raw Neoron status |
| 26 | Tags | `tags` | Pipe-separated |
| 27 | Última interação | `ultimaInteracao` | ISO timestamp |
| 28 | Não lidas | `naoLidas` | |
| 29 | Último remetente | `ultimoRemetente` | user / agent / bot |
| 30 | Contexto | `contexto` | Last message, 280 chars |
| 31 | Trecho do produto | `produtoTrecho` | |
| 32 | Canal | `canal` | Communication channel |
| 33 | Conversation ID | `conversationId` | Firestore document ID |

---

*This document reflects the system as of August 2026. It is intended as the canonical baseline for the upcoming complete rework.*
