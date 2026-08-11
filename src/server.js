/** Local dashboard + timeline. Reachable on the LAN (binds 0.0.0.0). */
import express from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, OUT_JSON, OUT_CSV } from './config.js';
import { extractNegociando } from './extractor.js';
import { buildWorkbook } from './xlsx.js';
import { buildTimeline, loadCachedTimeline } from './timeline.js';
import { setDone } from './store.js';
import { requireAuth } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
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
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', requireAuth);

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

app.get('/api/download', (_req, res) => {
  if (!fs.existsSync(OUT_CSV)) return res.status(404).send('Nenhum dado ainda. Clique em Extrair.');
  res.download(OUT_CSV, 'negociando.csv');
});

app.get('/api/download.xlsx', async (_req, res) => {
  if (!fs.existsSync(OUT_JSON)) return res.status(404).send('Nenhum dado ainda. Clique em Extrair.');
  try {
    const wb = await buildWorkbook(JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')));
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

app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  Neoron — Negociando dashboard`);
  console.log(`  ▶  local:   http://localhost:${config.port}`);
  for (const ip of lanIPs()) console.log(`  ▶  rede:    http://${ip.address}:${config.port}   (${ip.name})`);
  console.log('\n  Outros PCs na mesma rede acessam pela URL "rede".');
  console.log('  (Se não abrir, libere a porta no Firewall do Windows.)\n');
});
