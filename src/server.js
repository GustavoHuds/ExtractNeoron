/** ExtractNeoron v2 — dashboard server.
 * Runs behind a reverse proxy / VPN; binds config.host. Every /api route
 * requires a verified Firebase ID token from the user's own Neoron login.
 * State-changing actions are recorded in an append-only audit log. */
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, OUT_JSON } from './config.js';
import { extractAll, summarizeRows, refreshRows, toCsv, leadSnapshot } from './extract.js';
import { fetchMessages } from './neoron.js';
import { normalizeTranscript } from './lead.js';
import { buildMonthly } from './monthly.js';
import { buildWorkbook } from './xlsx.js';
import {
  setDone, bumpNoAnswer, resetNoAnswer, loadJustifs, addJustif, removeJustif,
  dismissFila, restoreFila, loadConvIndex, audit,
} from './store.js';
import { requireAuth } from './auth.js';
import { saveCatalog, catalogStatus, parseCatalogCsv } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
// Trust the reverse proxy (Caddy/nginx) so rate-limit sees the real client IP.
app.set('trust proxy', 1);

// Security headers, tuned to the app's real needs: only self + Google's
// Firebase auth endpoints are contactable; no external JS; no framing.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      formAction: ["'self'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false,
  // HSTS is meaningful only over HTTPS; enable it at the TLS terminator (proxy).
  hsts: false,
}));

// Cap request bodies. Catalog import can be a few MB; everything else is tiny.
app.use(express.json({ limit: '8mb' }));
app.use(express.text({ type: ['text/plain', 'text/csv'], limit: '8mb' }));

// Liveness probe for Docker/orchestration — no auth, no data exposure.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Public runtime config for the browser (Firebase web key lives in env, not source).
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-store');
  res.send(`window.NEORON_CONFIG = ${JSON.stringify({ apiKey: config.apiKey, project: config.firebaseProject })};`);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Throttle the API surface (auth + expensive extraction calls).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um momento.' },
});
app.use('/api', apiLimiter, requireAuth);
// Lead data must never land in intermediary caches.
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

let extracting = false;

function loadData() {
  if (fs.existsSync(OUT_JSON)) return JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  return { count: 0, rows: [], generatedAt: null };
}

// Always served with LIVE state: finalizations, call attempts and queue
// dismissals reflect instantly, and clock-dependent fields are recomputed.
app.get('/api/data', (_req, res) => res.json(refreshRows(loadData())));

app.post('/api/extract', async (req, res) => {
  if (extracting) return res.status(429).json({ error: 'Extração já em andamento.' });
  extracting = true;
  try {
    const result = await extractAll(req.auth, { force: req.body?.force === true });
    audit(req.auth.email, 'extract', { convs: result.conversationsScanned, fetched: result.chatsFetched });
    res.json(refreshRows(result));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao processar. Tente novamente.' });
  } finally {
    extracting = false;
  }
});

// Mark / unmark a lead as concluded. `by` comes from the verified token.
app.post('/api/done', (req, res) => {
  const { id, done, reason, note } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
  const snap = done ? leadSnapshot(loadData().rows.find((x) => x.conversationId === id)) : null;
  const map = setDone(id, !!done, req.auth.email || '', reason || '', String(note || '').slice(0, 500), snap);
  audit(req.auth.email, done ? 'finalizar' : 'reabrir', { id, reason: reason || '' });
  const entry = map[id] || {};
  res.json({ ok: true, feito: !!map[id], at: entry.at || null, reason: entry.reason || '', note: entry.note || '' });
});

// Reusable justificativas for the Finalizar popup (shared across the team).
app.get('/api/justificativas', (_req, res) => res.json({ items: loadJustifs() }));
app.post('/api/justificativas', (req, res) => {
  const { text, remove } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'text obrigatório' });
  const items = remove ? removeJustif(text) : addJustif(text);
  res.json({ ok: true, items });
});

// Register (or reset) a "Não atendeu" call attempt for a lead.
app.post('/api/noanswer', (req, res) => {
  const { id, reset, note } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
  const map = reset ? resetNoAnswer(id) : bumpNoAnswer(id, req.auth.email || '', String(note || '').slice(0, 300));
  audit(req.auth.email, reset ? 'volta_fila' : 'nao_atendeu', { id });
  const entry = map[id] || { count: 0, at: null };
  res.json({ ok: true, count: entry.count || 0, at: entry.at || null, note: entry.note || '' });
});

// Dismiss a lead from the call queue (✕) — or restore it. Dismissal is tied
// to the current waiting episode: a new customer message re-enters the queue.
app.post('/api/fila/dismiss', (req, res) => {
  const { id, restore } = req.body || {};
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id obrigatório' });
  const pendingTs = loadConvIndex()[id]?.pendingUserTs ?? null;
  const map = restore ? restoreFila(id) : dismissFila(id, req.auth.email || '', pendingTs);
  audit(req.auth.email, restore ? 'fila_restore' : 'fila_dismiss', { id });
  res.json({ ok: true, dismissed: !!map[id] });
});

// Full chat transcript, fetched live with the CALLER'S token (never cached).
app.get('/api/messages/:botId/:convId', async (req, res) => {
  try {
    const messages = normalizeTranscript(
      await fetchMessages(req.auth.idToken, req.params.botId, req.params.convId));
    res.json({ messages });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao carregar a conversa.' });
  }
});

// Catalog: status / import (CSV or JSON; each deployment brings its own).
app.get('/api/catalog', (_req, res) => {
  try { res.json(catalogStatus()); }
  catch { res.json({ loaded: false, count: 0, source: null }); }
});
app.post('/api/catalog', (req, res) => {
  try {
    let items = req.body;
    if (typeof items === 'string') {
      const t = items.replace(/^﻿/, '').trim();
      items = t.startsWith('[') || t.startsWith('{') ? JSON.parse(t) : parseCatalogCsv(t);
    }
    if (!Array.isArray(items) && Array.isArray(items?.items)) items = items.items;
    audit(req.auth.email, 'catalogo_import', { count: Array.isArray(items) ? items.length : 0 });
    res.json({ ok: true, ...saveCatalog(items) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Catálogo inválido.' });
  }
});

// Monthly team metrics (computed on demand from the last extraction + index).
app.get('/api/metrics', (req, res) => {
  const data = loadData();
  if (!data.rows.length) return res.json({ empty: true });
  const month = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : undefined;
  res.json(buildMonthly(data.rows, loadConvIndex(), { month }));
});

/** Export honoring the caller's current filter (ids subset, given order). */
function exportResult(ids) {
  const result = refreshRows(loadData());
  if (!Array.isArray(ids) || !ids.length) return result;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const rows = result.rows
    .filter((r) => rank.has(r.conversationId))
    .sort((a, b) => rank.get(a.conversationId) - rank.get(b.conversationId));
  return { ...result, ...summarizeRows(rows), rows, filtered: true, totalCarteira: result.count };
}

app.post('/api/download', (req, res) => {
  if (!fs.existsSync(OUT_JSON)) return res.status(404).send('Nenhum dado ainda. Clique em Atualizar dados.');
  const { rows } = exportResult(req.body?.ids);
  audit(req.auth.email, 'export_csv', { rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(toCsv(rows));
});

app.post('/api/download.xlsx', async (req, res) => {
  if (!fs.existsSync(OUT_JSON)) return res.status(404).send('Nenhum dado ainda. Clique em Atualizar dados.');
  try {
    const result = exportResult(req.body?.ids);
    audit(req.auth.email, 'export_xlsx', { rows: result.rows.length });
    const wb = await buildWorkbook(result);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="leads.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error(e); res.status(500).send('Falha ao gerar o arquivo.'); }
});

app.listen(config.port, config.host, () => {
  console.log(`\n  ExtractNeoron v2 — Belmont`);
  console.log(`  ▶  http://localhost:${config.port}\n`);
});
