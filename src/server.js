/** Dashboard + timeline server. Behind a reverse proxy / VPN; binds config.host. */
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, OUT_JSON } from './config.js';
import { extractNegociando, toCsv, summarizeRows } from './extractor.js';
import { buildWorkbook } from './xlsx.js';
import { buildTimeline, loadCachedTimeline } from './timeline.js';
import { setDone } from './store.js';
import { requireAuth } from './auth.js';
import { saveCatalog, catalogStatus, parseCatalogCsv } from './catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
// Trust the reverse proxy (Caddy/nginx) so rate-limit sees the real client IP.
app.set('trust proxy', 1);

// Security headers (market-standard via helmet), tuned to the app's real needs:
// only self + Google's Firebase auth endpoints are contactable; no external JS.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      baseUri: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginEmbedderPolicy: false,
  // HSTS is meaningful only over HTTPS; enable it at the TLS terminator (proxy).
  hsts: false,
}));

// Cap request bodies. Catalog import can be a few MB of JSON; everything else tiny.
app.use(express.json({ limit: '8mb' }));
// Catalog import is uploaded as raw text (CSV or JSON) — parsed at /api/catalog.
app.use(express.text({ type: ['text/plain', 'text/csv'], limit: '8mb' }));

// Liveness probe for Docker/orchestration — no auth, no data exposure.
app.get('/health', (_req, res) => res.json({ ok: true }));

// Public runtime config for the browser (Firebase web key lives in env, not source).
app.get('/config.js', (_req, res) => {
  res.type('application/javascript').setHeader('Cache-Control', 'no-store');
  res.send(`window.NEORON_CONFIG = ${JSON.stringify({ apiKey: config.apiKey, project: config.firebaseProject })};`);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// Throttle the API surface (auth + expensive extract/timeline calls).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde um momento.' },
});
app.use('/api', apiLimiter, requireAuth);

let extracting = false;
let buildingTimeline = false;

app.get('/api/data', (_req, res) => {
  if (fs.existsSync(OUT_JSON)) return res.json(JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')));
  res.json({ count: 0, rows: [], generatedAt: null });
});

app.post('/api/extract', async (req, res) => {
  if (extracting) return res.status(429).json({ error: 'Extração já em andamento.' });
  extracting = true;
  try { res.json(await extractNegociando(req.auth)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao processar. Tente novamente.' }); }
  finally { extracting = false; }
});

// Mark / unmark a lead as "Feito" (persisted, shared across the network).
app.post('/api/done', (req, res) => {
  const { id, done } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id obrigatório' });
  const map = setDone(id, !!done, req.body.by || '');
  res.json({ ok: true, feito: !!map[id], at: map[id]?.at || null });
});

// Catalog: report status / import a catalog JSON (each deployment brings its own).
app.get('/api/catalog', (_req, res) => {
  try { res.json(catalogStatus()); }
  catch { res.json({ loaded: false, count: 0, source: null }); }
});

// Accepts the raw uploaded file (CSV or JSON), or a JSON array/{items} body.
app.post('/api/catalog', (req, res) => {
  try {
    let items = req.body;
    if (typeof items === 'string') {
      const t = items.replace(/^﻿/, '').trim();
      items = t.startsWith('[') || t.startsWith('{') ? JSON.parse(t) : parseCatalogCsv(t);
    }
    if (!Array.isArray(items) && Array.isArray(items?.items)) items = items.items;
    res.json({ ok: true, ...saveCatalog(items) });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Catálogo inválido.' });
  }
});

/**
 * Build an export result honoring the caller's current list filter.
 * When `ids` is a non-empty array, keep only those conversations (in the given
 * order) and recompute the summary so the totals match what was exported.
 */
function exportResult(ids) {
  const result = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  if (!Array.isArray(ids) || !ids.length) return result;
  const rank = new Map(ids.map((id, i) => [id, i]));
  const rows = result.rows
    .filter((r) => rank.has(r.conversationId))
    .sort((a, b) => rank.get(a.conversationId) - rank.get(b.conversationId));
  return { ...result, ...summarizeRows(rows), rows, filtered: true, totalCarteira: result.count };
}

app.post('/api/download', (req, res) => {
  if (!fs.existsSync(OUT_JSON)) return res.status(404).send('Nenhum dado ainda. Clique em Extrair.');
  const { rows } = exportResult(req.body?.ids);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="negociando.csv"');
  res.send(toCsv(rows));
});

app.post('/api/download.xlsx', async (req, res) => {
  if (!fs.existsSync(OUT_JSON)) return res.status(404).send('Nenhum dado ainda. Clique em Extrair.');
  try {
    const wb = await buildWorkbook(exportResult(req.body?.ids));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="negociando.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) { console.error(e); res.status(500).send('Falha ao gerar o arquivo.'); }
});

app.get('/api/timeline', async (req, res) => {
  const cached = loadCachedTimeline();
  if (cached) return res.json(cached);
  if (buildingTimeline) return res.status(202).json({ building: true });
  buildingTimeline = true;
  try { res.json(await buildTimeline(req.auth)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao processar. Tente novamente.' }); }
  finally { buildingTimeline = false; }
});

app.post('/api/timeline/refresh', async (req, res) => {
  if (buildingTimeline) return res.status(429).json({ error: 'Timeline já está sendo gerada.' });
  buildingTimeline = true;
  try { res.json(await buildTimeline(req.auth)); }
  catch (e) { console.error(e); res.status(500).json({ error: 'Falha ao processar. Tente novamente.' }); }
  finally { buildingTimeline = false; }
});

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}

app.listen(config.port, config.host, () => {
  console.log(`\n  Neoron — Negociando dashboard`);
  console.log(`  ▶  local:   http://localhost:${config.port}`);
  for (const ip of lanIPs()) console.log(`  ▶  rede:    http://${ip.address}:${config.port}   (${ip.name})`);
  console.log('\n  Outros PCs na mesma rede acessam pela URL "rede".');
  console.log('  (Se não abrir, libere a porta no Firewall do Windows.)\n');
});
