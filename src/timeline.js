/**
 * Timeline aggregation: volume of conversations over time, REAL service speed
 * (customer question -> agent reply), funnel/conversion, and per-attendant stats.
 * Heavier than the lead extract (reads message history for many conversations),
 * so it is cached to data/timeline.json and only recomputed on demand.
 */
import fs from 'node:fs';
import { TIMELINE_JSON, ensureDirs } from './config.js';
import { signIn, runQuery, listDocuments, decodeDoc } from './firestore.js';
import { attendantName, responseMetrics } from './metrics.js';
import { loadHistory } from './store.js';

const RESP_WINDOW_DAYS = 45; // fetch messages only for recent convs (bounds cost)

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v > 1e14) return Math.round(v / 1000);
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return v;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA'); // YYYY-MM-DD local
const min = (ms) => (ms == null ? null : Math.round(ms / 60000));
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7); // YYYY-MM

/** Pure per-attendant aggregation from per-conversation stat rows. */
export function aggregateAttendants(stats, currentMonth) {
  const total = stats.length;
  const map = new Map();
  for (const s of stats) {
    const name = s.atendente || '—';
    if (!map.has(name)) map.set(name, { nome: name, conversas: 0, chatsMes: 0, firsts: [], vendas: 0, descartados: 0, abertos: 0, aguardando: 0 });
    const a = map.get(name);
    a.conversas++;
    if (s.mes === currentMonth) a.chatsMes++;
    if (s.first != null) a.firsts.push(s.first);
    if (s.situacao === 'Vendido') a.vendas++;
    else if (s.situacao === 'Descartado') a.descartados++;
    else if (s.situacao === 'Aberto') a.abertos++;
    if (s.awaiting) a.aguardando++;
  }
  const round1 = (n) => Math.round(n * 10) / 10;
  return [...map.values()].map((a) => ({
    nome: a.nome,
    conversas: a.conversas,
    chatsMes: a.chatsMes,
    vendas: a.vendas,
    descartados: a.descartados,
    abertos: a.abertos,
    aguardando: a.aguardando,
    pctVolume: total ? round1((a.conversas / total) * 100) : 0,
    primeiraRespostaMedianaMin: min(median(a.firsts)),
    primeiraRespostaMediaMin: a.firsts.length
      ? Math.round(a.firsts.reduce((x, y) => x + y, 0) / a.firsts.length / 60000) : null,
    // Conversão do atendente = vendidos / total de contatos que ele atendeu.
    taxaConversao: a.conversas ? round1((a.vendas / a.conversas) * 100) : 0,
  })).sort((a, b) => b.conversas - a.conversas);
}
function tagsOf(conv) {
  const a = Object.values(conv.contact?.tags || {});
  const b = Object.values(conv.tags || {});
  return [...a, ...b].map((t) => (t?.name || '').toLowerCase()).filter(Boolean);
}
function situacaoOf(tags) {
  if (tags.includes('venda realizada')) return 'Vendido';
  if (tags.includes('desqualificado')) return 'Descartado';
  if (tags.includes('negociando')) return 'Aberto';
  return null;
}

async function listBots(idToken, localId) {
  const rows = await runQuery(idToken, {
    from: [{ collectionId: 'bots_draft' }],
    where: { fieldFilter: { field: { fieldPath: 'users' }, op: 'ARRAY_CONTAINS', value: { stringValue: localId } } },
  });
  return rows.map((r) => decodeDoc(r.document)).filter(Boolean).map((b) => ({ id: b._id, name: b.name || b._id }));
}
async function fetchAll(idToken, path) {
  const out = []; let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(idToken, path, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken);
  return out;
}
async function mapLimit(items, limit, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; res[idx] = await fn(items[idx], idx); }
  }));
  return res;
}

export async function buildTimeline(auth) {
  ensureDirs();
  const { idToken, localId, email } = auth || await signIn();
  const bots = await listBots(idToken, localId);
  const now = Date.now();
  const cutoff = now - RESP_WINDOW_DAYS * 864e5;

  const convs = [];
  for (const bot of bots) {
    const list = await fetchAll(idToken, `bots/${bot.id}/conversations_metadata`);
    for (const c of list) c._botId = bot.id;
    convs.push(...list);
  }

  // Volume per day (from created date) — cheap, metadata only.
  const volMap = new Map();
  for (const c of convs) {
    const ms = toMs(c.created_date) ?? toMs(c.start_chat_date) ?? toMs(c.last_message_at);
    if (!ms) continue;
    const d = dayKey(ms);
    volMap.set(d, (volMap.get(d) || 0) + 1);
  }
  const volumePorDia = [...volMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, novas]) => ({ dia, novas })).slice(-30);

  // Response speed — fetch messages for recent conversations only.
  const recent = convs.filter((c) => (toMs(c.created_date) ?? toMs(c.last_message_at) ?? 0) >= cutoff);
  const perConv = await mapLimit(recent, 8, async (c) => {
    try {
      const msgs = (await fetchAll(idToken, `bots/${c._botId}/conversations/${c._id}/messages`))
        .sort((a, b) => (a.created_date || a.id || 0) - (b.created_date || b.id || 0));
      const rm = responseMetrics(msgs, now);
      return {
        dia: dayKey(toMs(c.created_date) ?? toMs(c.last_message_at) ?? now),
        mes: monthKey(toMs(c.created_date) ?? toMs(c.last_message_at) ?? now),
        atendente: attendantName(msgs),
        first: rm.firstResponseMs,
        median: rm.medianResponseMs,
        situacao: situacaoOf(tagsOf(c)),
        awaiting: rm.awaiting,
      };
    } catch { return null; }
  });
  const stats = perConv.filter(Boolean);

  // First-response distribution
  const buckets = [
    { faixa: '< 1 min', max: 60e3 }, { faixa: '1–5 min', max: 300e3 },
    { faixa: '5–15 min', max: 900e3 }, { faixa: '15–60 min', max: 36e5 },
    { faixa: '1–4 h', max: 4 * 36e5 }, { faixa: '> 4 h', max: Infinity },
  ].map((b) => ({ ...b, n: 0 }));
  const firsts = [];
  for (const s of stats) {
    if (s.first == null) continue;
    firsts.push(s.first);
    (buckets.find((b) => s.first < b.max)).n++;
  }

  // Response median per day
  const dayResp = new Map();
  for (const s of stats) {
    if (s.first == null) continue;
    if (!dayResp.has(s.dia)) dayResp.set(s.dia, []);
    dayResp.get(s.dia).push(s.first);
  }
  const respostaPorDia = [...dayResp.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, arr]) => ({ dia, medianaMin: min(median(arr)), amostras: arr.length })).slice(-30);

  const nowMonth = monthKey(now);
  const atendentes = aggregateAttendants(stats, nowMonth);

  // Funnel / situação across all conversations
  const sit = { Aberto: 0, Vendido: 0, Descartado: 0 };
  const statusDist = new Map();
  for (const c of convs) {
    const s = situacaoOf(tagsOf(c));
    if (s) sit[s]++;
    const st = c.status || '—';
    statusDist.set(st, (statusDist.get(st) || 0) + 1);
  }
  const negociando = sit.Aberto + sit.Vendido + sit.Descartado;
  // Conversão = vendidos (tag "venda realizada") / TODOS que entraram em contato,
  // não apenas os que estão em negociação.
  const contatos = convs.length;
  const conversao = { entraram: contatos, negociando, vendidos: sit.Vendido, taxa: contatos ? Math.round(sit.Vendido / contatos * 1000) / 10 : 0 };

  const result = {
    generatedAt: new Date(now).toISOString(),
    account: email,
    totalConversas: convs.length,
    respostaAmostras: stats.length,
    volumePorDia,
    respostaPorDia,
    velocidade: {
      primeiraRespostaMedianaMin: min(median(firsts)),
      primeiraRespostaMediaMin: firsts.length ? Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length / 60000) : null,
      distribuicao: buckets.map((b) => ({ faixa: b.faixa, n: b.n })),
    },
    atendentes,
    volumePorAtendente: atendentes.map((a) => ({ nome: a.nome, conversas: a.conversas })),
    situacao: sit,
    conversao,
    statusDist: [...statusDist.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n),
    historico: loadHistory().slice(-200),
  };

  fs.writeFileSync(TIMELINE_JSON, JSON.stringify(result, null, 2));
  return result;
}

export function loadCachedTimeline() {
  try { return JSON.parse(fs.readFileSync(TIMELINE_JSON, 'utf8')); } catch { return null; }
}
