/**
 * Full-base extraction: EVERY conversation of every bot, all channels
 * (WhatsApp, Instagram DM, Web chat, legacy docs without a channel field).
 *
 * v1 only surfaced conversations tagged "negociando" (~50 of 426), which made
 * the dashboard disagree with Neoron's own numbers. v2 indexes the whole base
 * and lets the UI segment it (funnel stages, channels, situations).
 *
 * Incremental: a per-conversation index caches everything derived from
 * messages, keyed by the metadata's last-message timestamp. Only chats that
 * changed since the previous run are re-fetched — the first extraction is the
 * slow one; the following ones touch a handful of conversations.
 */
import fs from 'node:fs';
import { config, OUT_JSON, OUT_CSV, ensureDirs } from './config.js';
import { listBots, nameMap, fetchConversations, fetchMessages, mapLimit } from './neoron.js';
import { baseLead, archivedRow, toMs, transcriptOf, normalizeTranscript, reasonLabel } from './lead.js';
import { attendantName, responseMetrics, leadScore, decayTemperatura, messageText } from './metrics.js';
import { detectProducts } from './products.js';
import { matchProduct } from './catalog.js';
import { loadDone, loadNoAnswer, loadFilaSkip, loadConvIndex, saveConvIndex, appendSnapshot } from './store.js';
import { createScorer } from './ai.js';
import { neutralizeCell } from './sanitize.js';

const msToMin = (ms) => (ms == null ? null : Math.round(ms / 60000));
const monthOf = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Everything derivable from a conversation's messages, cached in the index. */
export function indexEntry(conv, messages, now = Date.now()) {
  const metaLastMs = toMs(conv.last_message_at) ?? toMs(conv.last_message_received) ?? 0;
  const ts = messages.map((m) => m.created_date || m.id).filter(Boolean);
  const firstTs = ts.length ? ts[0] : null;
  const lastTs = ts.length ? ts[ts.length - 1] : null;
  const userTs = messages.filter((m) => m.sender === 'user').map((m) => m.created_date || m.id).filter(Boolean);
  const agentMsgs = messages.filter((m) => m.sender === 'agent').length;

  const rm = responseMetrics(messages, now);
  const transcript = transcriptOf(messages);
  const tagNames = []; // situacao computed at row time from live tags
  const ls = leadScore(messages, { situacao: undefined, horasDesde: lastTs ? (now - lastTs) / 36e5 : null });

  // product: real catalog SKU first, else category fallback
  let produto = { produto: '', produtoCodigo: '', produtoPreco: null, produtoCategoria: '', produtoFonte: '', produtoTrecho: '' };
  const hit = matchProduct(transcript);
  if (hit) {
    produto = {
      produto: hit.produto, produtoCodigo: hit.codigo, produtoPreco: hit.preco,
      produtoCategoria: hit.categoria, produtoFonte: 'catálogo',
      produtoTrecho: `match: ${hit.matched.join(', ')}`,
    };
  } else {
    const det = detectProducts(transcript);
    if (det.produto) {
      produto = {
        produto: det.produto, produtoCodigo: '', produtoPreco: null,
        produtoCategoria: det.produto.split(/[;—]/)[0].trim(), produtoFonte: 'categoria',
        produtoTrecho: det.itens[0]?.snippet || '',
      };
    }
  }

  const monthsActive = [...new Set(ts.map(monthOf))];
  const lastUser = [...messages].reverse().find((m) => m.sender === 'user');

  return {
    metaLastMs,                                   // change detector (0 for stub docs)
    lastMs: lastTs,
    firstTs,
    firstUserTs: userTs.length ? userTs[0] : null,
    msgCount: messages.length,
    userMsgs: userTs.length,
    agentMsgs,
    atendente: attendantName(messages) || null,
    firstResponseMs: rm.firstResponseMs,
    medianResponseMs: rm.medianResponseMs,
    responseCount: rm.responseCount,
    pendingUserTs: rm.pendingUserTs,
    interesseScore: ls.score,
    temperatura: ls.temperatura,
    motivos: ls.motivos,
    monthsActive,
    ultimoTexto: (messageText(lastUser || messages[messages.length - 1] || {}) || '').slice(0, 280),
    ...produto,
  };
}

/** Overlay cached/derived data onto a base row. */
export function applyIndex(row, e, now = Date.now(), queueHours = config.callQueueHours, queueMaxDays = config.callQueueMaxDays) {
  row.temUsuario = (e.userMsgs || 0) > 0;
  if (!row.ultimaInteracaoMs && e.lastMs) {
    row.ultimaInteracaoMs = e.lastMs;
    row.ultimaInteracao = new Date(e.lastMs).toISOString();
  }
  row.horasDesde = row.ultimaInteracaoMs ? Math.round((now - row.ultimaInteracaoMs) / 36e5 * 10) / 10 : null;
  if (e.atendente) row.atendente = e.atendente;
  row.primeiraRespostaMin = msToMin(e.firstResponseMs);
  row.respostaMedianaMin = msToMin(e.medianResponseMs);
  row.aguardando = e.pendingUserTs != null && !row.feito;
  row.aguardandoMin = row.aguardando ? msToMin(now - e.pendingUserTs) : null;
  // Call queue: waiting for a human ≥ queueHours, but not so long the lead is
  // lost (stale conversations stay in the pipeline as frios, not in the queue).
  row.paraLigar = row.aguardando && row.aguardandoMin != null
    && row.aguardandoMin >= queueHours * 60
    && row.aguardandoMin <= queueMaxDays * 1440;
  row.temperatura = row.situacao === 'Descartado' ? 'frio'
    : decayTemperatura(e.temperatura || 'morno', e.interesseScore, row.horasDesde);
  row.motivos = e.motivos || [];
  row.interesseScore = e.interesseScore ?? null;
  for (const k of ['produto', 'produtoCodigo', 'produtoPreco', 'produtoCategoria', 'produtoFonte', 'produtoTrecho']) {
    if (e[k] != null && e[k] !== '') row[k] = e[k];
  }
  if (!row.contexto && e.ultimoTexto) row.contexto = e.ultimoTexto;
  if (row.nome === row.conversationId) row.nome = `Contato ${String(row.conversationId).slice(-4)}`;
  return row;
}

/** Core: extract the whole conversation base across the user's bots. */
export async function extractAll(auth, { force = false } = {}) {
  ensureDirs();
  const { idToken, localId, email } = auth;
  const now = Date.now();
  const bots = await listBots(idToken, localId);
  const doneMap = loadDone();
  const naMap = loadNoAnswer();
  const index = loadConvIndex();
  const scorer = createScorer();
  const rows = [];
  let scanned = 0;
  let fetchedChats = 0;

  for (const bot of bots) {
    const [agents, departments, convos] = await Promise.all([
      nameMap(idToken, `bots/${bot.id}`, 'agents'),
      nameMap(idToken, `bots/${bot.id}`, 'departments'),
      fetchConversations(idToken, bot.id),
    ]);
    scanned += convos.length;

    await mapLimit(convos, 8, async (conv) => {
      const convId = conv.conversation_id || conv._id;
      const metaLastMs = toMs(conv.last_message_at) ?? toMs(conv.last_message_received) ?? 0;
      let entry = index[convId];
      const changed = force || !entry || entry.metaLastMs !== metaLastMs;

      let messages = null;
      if (changed) {
        try {
          messages = await fetchMessages(idToken, bot.id, conv._id);
          fetchedChats++;
          entry = indexEntry(conv, messages, now);
          index[convId] = entry;
        } catch {
          // transient Firestore error: keep the stale entry if we have one
          if (!entry) return;
        }
      }
      if (!entry || !entry.msgCount) return; // empty doc — not a conversation

      const row = baseLead({ bot, conv, agents, departments, doneMap, naMap, now });
      applyIndex(row, entry, now);

      // Nota IA: only open, human-attended chats; cached per conversation.
      if (!row.feito && row.situacao === 'Aberto' && row.temUsuario && entry.agentMsgs > 0) {
        const ai = await scorer.score(row, messages ? normalizeTranscript(messages) : null);
        if (ai) { row.aiNota = ai.nota; row.aiMotivo = ai.motivo || ''; }
      }
      rows.push(row);
    });
  }
  scorer.flush();
  saveConvIndex(index);

  // Concluded leads that left Neoron stay visible (snapshot, 180d retention).
  const present = new Set(rows.map((r) => r.conversationId));
  for (const [id, entry] of Object.entries(doneMap)) {
    if (present.has(id) || !entry.snap) continue;
    rows.push(archivedRow(id, entry));
  }

  // Sort: longest-waiting first, then hottest, then most recent.
  const TEMP_ORDER = { quente: 0, morno: 1, frio: 2 };
  rows.sort((a, b) =>
    ((b.aguardandoMin || 0) - (a.aguardandoMin || 0)) ||
    (TEMP_ORDER[a.temperatura] - TEMP_ORDER[b.temperatura]) ||
    ((b.ultimaInteracaoMs || 0) - (a.ultimaInteracaoMs || 0)));

  const result = {
    generatedAt: new Date(now).toISOString(),
    account: email,
    botsScanned: bots.map((b) => b.name),
    conversationsScanned: scanned,
    chatsFetched: fetchedChats,
    ...summarizeRows(rows, now),
    rows,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(result));
  fs.writeFileSync(OUT_CSV, toCsv(rows));

  appendSnapshot({
    at: result.generatedAt,
    abertos: result.situacao.abertos,
    vendidos: result.situacao.vendidos,
    descartados: result.situacao.descartados,
    quentes: result.temperatura.quentes,
    mornos: result.temperatura.mornos,
    frios: result.temperatura.frios,
    aguardando: result.aguardando,
    total: result.count,
  });

  return result;
}

/**
 * Re-apply LIVE state to a stored extraction result, so /api/data reflects
 * finalizations, call attempts and queue dismissals the instant they happen —
 * no re-extraction needed. Also recomputes every clock-dependent field
 * (waiting time, call-queue membership, temperature decay) for "now".
 * Deps are injectable for tests; defaults read from data/.
 */
export function refreshRows(result, now = Date.now(), deps = {}) {
  if (!result?.rows?.length) return result;
  const doneMap = deps.doneMap ?? loadDone();
  const naMap = deps.naMap ?? loadNoAnswer();
  const skipMap = deps.skipMap ?? loadFilaSkip();
  const index = deps.index ?? loadConvIndex();

  const rows = result.rows.map((r) => {
    const row = { ...r };
    const id = row.conversationId;
    const feito = doneMap[id];
    row.feito = !!feito;
    row.feitoAt = feito?.at || null;
    row.feitoReason = feito?.reason || '';
    row.feitoReasonLabel = feito ? reasonLabel(feito.reason) : '';
    row.feitoNota = feito?.note || '';
    row.feitoPor = feito?.by || '';
    const na = naMap[id];
    row.naoAtendeuCount = na?.count || 0;
    row.naoAtendeuAt = na?.at || null;
    row.naoAtendeuNota = na?.note || '';
    row.noAnswerBucket = (na?.count || 0) >= 2;
    const e = index[id];
    if (e && !row.arquivado) applyIndex(row, e, now);
    // Queue dismissal is per waiting-episode: a NEWER unanswered customer
    // message re-enters the queue automatically.
    const skip = skipMap[id];
    row.filaDismissed = !!(skip && (skip.pendingUserTs == null || e?.pendingUserTs == null
      || skip.pendingUserTs >= e.pendingUserTs));
    return row;
  })
  // archived snapshots only exist while their conclusion exists
  .filter((r) => !(r.arquivado && !r.feito));

  return { ...result, ...summarizeRows(rows, now), rows };
}

/** Summary counts for an arbitrary set of rows. Finalized leads live in their
 * own tab, so actionable counters exclude them. */
export function summarizeRows(rows, now = Date.now()) {
  const by = (pred) => rows.filter(pred).length;
  const mesAtual = monthOf(now);
  const soldInMonth = (r) => {
    if (r.feitoReason === 'vendido' && r.feitoAt) return monthOf(Date.parse(r.feitoAt)) === mesAtual;
    if (r.situacao === 'Vendido' && r.ultimaInteracaoMs) return monthOf(r.ultimaInteracaoMs) === mesAtual;
    return false;
  };
  return {
    count: rows.length,
    leads: by((r) => r.temUsuario),                                  // real customers (spoke at least once)
    situacao: {
      abertos: by((r) => r.situacao === 'Aberto' && !r.feito && r.temUsuario),
      vendidos: by((r) => r.situacao === 'Vendido' || r.feitoReason === 'vendido'),
      descartados: by((r) => r.situacao === 'Descartado'),
    },
    temperatura: {
      quentes: by((r) => r.temperatura === 'quente' && !r.feito && r.situacao === 'Aberto'),
      mornos: by((r) => r.temperatura === 'morno' && !r.feito && r.situacao === 'Aberto'),
      frios: by((r) => r.temperatura === 'frio' && !r.feito && r.situacao === 'Aberto'),
    },
    canais: {
      whatsapp: by((r) => r.canal === 'WHATSAPP'),
      instagram: by((r) => r.canal === 'INSTAGRAM'),
      web: by((r) => r.canal === 'WEB'),
      outros: by((r) => r.canal === 'DESCONHECIDO'),
    },
    etapas: {
      'primeiro contato': by((r) => r.etapa === 'primeiro contato' && r.situacao === 'Aberto' && !r.feito && r.temUsuario),
      'negociando': by((r) => r.etapa === 'negociando' && r.situacao === 'Aberto' && !r.feito),
      'proposta enviada': by((r) => r.etapa === 'proposta enviada' && r.situacao === 'Aberto' && !r.feito),
      'fechamento': by((r) => r.etapa === 'fechamento' && r.situacao === 'Aberto' && !r.feito),
    },
    aguardando: by((r) => r.aguardando && !r.feito),
    aguardando24h: by((r) => r.paraLigar && !r.feito),
    naoAtendeu: by((r) => r.noAnswerBucket && !r.feito),
    feitos: by((r) => r.feito),
    vendidosMes: by(soldInMonth),
  };
}

const CSV_COLS = [
  ['nome', 'Nome'], ['contato', 'Contato'], ['telefone', 'Telefone (raw)'],
  ['instagram', 'Instagram'], ['canalLabel', 'Canal'],
  ['situacao', 'Situação'], ['etapa', 'Etapa'], ['temperatura', 'Temperatura'], ['motivos', 'Motivo (sinais)'],
  ['produto', 'Produto'], ['produtoCodigo', 'Cód. produto'], ['produtoPreco', 'Preço'],
  ['produtoCategoria', 'Categoria'], ['produtoFonte', 'Origem produto'],
  ['atendente', 'Atendente'], ['departamento', 'Departamento'],
  ['aiNota', 'Nota IA (0-10)'], ['aiMotivo', 'Motivo IA'],
  ['aguardando', 'Cliente aguardando'], ['aguardandoMin', 'Aguardando (min)'],
  ['primeiraRespostaMin', '1ª resposta (min)'], ['respostaMedianaMin', 'Resp. mediana (min)'],
  ['feito', 'Feito'], ['feitoAt', 'Feito em'],
  ['feitoReasonLabel', 'Motivo (desfecho)'], ['feitoNota', 'Justificativa'], ['feitoPor', 'Concluído por'],
  ['statusSistema', 'Status'], ['tags', 'Tags'],
  ['ultimaInteracao', 'Última interação'],
  ['naoLidas', 'Não lidas'], ['ultimoRemetente', 'Último remetente'],
  ['contexto', 'Contexto'], ['conversationId', 'Conversation ID'],
];

export function toCsv(rows) {
  const esc = (v) => {
    if (Array.isArray(v)) v = v.map((x) => (x && typeof x === 'object' ? x.name : x)).join(' | ');
    if (v == null) v = '';
    const s = neutralizeCell(String(v));
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = CSV_COLS.map(([, label]) => esc(label)).join(',');
  const lines = rows.map((r) => CSV_COLS.map(([key]) => esc(r[key])).join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n'; // BOM for Excel/accents
}

// Snapshot fields saved with a concluded lead so the Finalizados tab can show
// it after it disappears from Neoron.
export function leadSnapshot(row) {
  if (!row) return null;
  const { bot, nome, contato, telefone, instagram, canal, canalLabel, situacao, etapa, tags,
    produto, produtoCodigo, produtoPreco, atendente, departamento, ultimaInteracao,
    ultimaInteracaoMs, contexto, aiNota, aiMotivo, botId, chatUrl } = row;
  return { bot, nome, contato, telefone, instagram, canal, canalLabel, situacao, etapa, tags,
    produto, produtoCodigo, produtoPreco, atendente, departamento, ultimaInteracao,
    ultimaInteracaoMs, contexto, aiNota, aiMotivo, botId, chatUrl };
}
