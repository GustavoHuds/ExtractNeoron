/**
 * Extract "Negociando" chats from Neoron.
 *
 * Data model (discovered):
 *   Neoron is a Firebase app (project "neoron"). The atendimento inbox is the
 *   "Direct" module. Conversations live in Firestore at:
 *       bots/{botId}/conversations_metadata/{convId}
 *   "Negociando" is a CONTACT TAG (contact.tags / contact.tags_id), not the
 *   system `status` field. We resolve the tag by NAME (default "negociando")
 *   so we don't depend on a hard-coded tag id.
 *
 * Auth: Firebase Auth REST (email/password) -> idToken -> Firestore REST.
 */
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config, OUT_JSON, OUT_CSV, ensureDirs } from './config.js';
import { signIn, runQuery, listDocuments, decodeDoc } from './firestore.js';
import { detectProducts } from './products.js';
import { matchProduct } from './catalog.js';
import { attendantName, responseMetrics, leadScore, parseAttendant } from './metrics.js';
import { loadDone, loadNoAnswer, appendSnapshot } from './store.js';
import { neutralizeCell } from './sanitize.js';

const TAG_NAME = (process.env.NEGOCIANDO_TAG_NAME || 'negociando').toLowerCase();

/** Derive commercial situation from the contact's tags. */
function situacaoOf(tagNames) {
  const s = tagNames.map((t) => t.toLowerCase());
  if (s.includes('venda realizada')) return 'Vendido';
  if (s.includes('desqualificado')) return 'Descartado';
  return 'Aberto';
}

/** Lead temperature = urgency to act (recency + whether the customer is waiting). */
function temperaturaOf(horasDesde, awaiting) {
  if (horasDesde == null) return 'frio';
  if (awaiting && horasDesde < 48) return 'quente';
  if (horasDesde < 24) return 'quente';
  if (horasDesde < 72) return 'morno';
  return 'frio';
}

const msToMin = (ms) => (ms == null ? null : Math.round(ms / 60000));

// System status -> friendly Portuguese label.
const STATUS_PT = {
  CHATBOT: 'Bot',
  TAKEOVER_QUEUE: 'Na fila',
  TAKEOVER_ATTEMPT: 'Tentando atender',
  TAKEOVER_IN_ATTENDANCE: 'Em atendimento',
  TAKEOVER_FINISHED: 'Finalizado',
  FINISHED: 'Finalizado',
};

/** List the bots this user can access (id + display name). */
async function listBots(idToken, localId) {
  const rows = await runQuery(idToken, {
    from: [{ collectionId: 'bots_draft' }],
    where: { fieldFilter: { field: { fieldPath: 'users' }, op: 'ARRAY_CONTAINS', value: { stringValue: localId } } },
  });
  return rows.map((r) => decodeDoc(r.document)).filter(Boolean)
    .map((b) => ({ id: b._id, name: b.name || b.botName || b._id }));
}

/** id -> name map for a subcollection (agents / departments). */
async function nameMap(idToken, parentPath, collection) {
  const map = {};
  try {
    let pageToken;
    do {
      const { documents = [], nextPageToken } = await listDocuments(idToken, `${parentPath}/${collection}`, { pageSize: 300, pageToken });
      for (const d of documents.map(decodeDoc)) map[d._id] = d.name || d.display_name || d.email || d._id;
      pageToken = nextPageToken;
    } while (pageToken);
  } catch { /* collection may not exist */ }
  return map;
}

/** Fetch every conversation_metadata doc under a bot (paginated). */
async function fetchConversations(idToken, botId) {
  const out = [];
  let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(
      idToken, `bots/${botId}/conversations_metadata`, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken);
  return out;
}

/** Fetch the full message history for one conversation (chronological). */
export async function fetchMessages(idToken, botId, convId) {
  const out = [];
  let pageToken;
  do {
    const { documents = [], nextPageToken } = await listDocuments(
      idToken, `bots/${botId}/conversations/${convId}/messages`, { pageSize: 300, pageToken });
    for (const d of documents) out.push(decodeDoc(d));
    pageToken = nextPageToken;
  } while (pageToken);
  out.sort((a, b) => (a.created_date || a.id || 0) - (b.created_date || b.id || 0));
  return out;
}

/** Flatten a message doc to plain text. */
function messageText(m) {
  if (m.message && typeof m.message === 'object' && m.message.content) return stripHtml(m.message.content);
  if (Array.isArray(m.message_list)) return m.message_list.map((x) => stripHtml(x && x.content)).filter(Boolean).join(' ');
  if (m.replied_message && m.replied_message.content) return stripHtml(m.replied_message.content);
  return '';
}

/** Build a transcript string from message docs. */
function transcriptOf(messages) {
  return messages.map((m) => messageText(m)).filter(Boolean).join('\n');
}

/** Best-effort label for a non-text (media) message. */
function mediaLabel(m) {
  const t = String(m.type || m.message?.type || m.media_type || m.message?.media_type || '').toLowerCase();
  if (/image|img|foto|photo|sticker/.test(t)) return '[imagem]';
  if (/audio|voice|ptt/.test(t)) return '[áudio]';
  if (/video/.test(t)) return '[vídeo]';
  if (/file|document|doc|pdf/.test(t)) return '[arquivo]';
  return '[mídia]';
}

/**
 * Normalize message docs for the transcript popup.
 * Returns [{ sender, ts, text, author }] — media messages become a "[mídia]"
 * placeholder and agent bubbles carry the parsed attendant name (prefix stripped).
 */
export function normalizeTranscript(messages) {
  return messages.map((m) => {
    let text = messageText(m);
    let author = null;
    if (m.sender === 'agent' && text) {
      const name = parseAttendant(text);
      if (name) {
        author = name;
        text = text.replace(/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s]{1,24}?\s*:\s*/, '');
      }
    }
    if (!text) text = mediaLabel(m);
    return { sender: m.sender || 'bot', ts: m.created_date || m.id || null, text, author };
  });
}

/** Run async tasks with limited concurrency. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** All tag objects on a conversation (from contact.tags and top-level tags). */
function tagsOf(conv) {
  const fromContact = Object.values(conv.contact?.tags || {});
  const fromTop = Object.values(conv.tags || {});
  const seen = new Map();
  for (const t of [...fromContact, ...fromTop]) {
    if (t && (t.id || t.name)) seen.set(t.id || t.name, t);
  }
  return [...seen.values()];
}

function hasTagName(conv, name) {
  return tagsOf(conv).some((t) => (t.name || '').toLowerCase() === name);
}

/** Normalize a Firestore timestamp-ish value to epoch ms (or null). */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') {
    if (v > 1e14) return Math.round(v / 1000); // microseconds
    if (v > 1e12) return v;                    // milliseconds
    if (v > 1e9) return v * 1000;              // seconds
    return v;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<\/(p|div|br)>/gi, ' ')
    .replace(/<br\s*\/?>(?=)/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best-effort last message text for the "Contexto" column. */
function lastText(conv) {
  const lm = conv.last_message_text;
  let raw = '';
  if (lm && typeof lm === 'object') {
    raw = lm.message?.content
      || (Array.isArray(lm.message_list) ? lm.message_list.map((m) => m?.content).filter(Boolean).pop() : '')
      || '';
  } else if (typeof lm === 'string') {
    raw = lm;
  }
  if (!raw && conv.last_message && typeof conv.last_message === 'object') raw = conv.last_message.content || '';
  const text = stripHtml(raw);
  return text.length > 280 ? text.slice(0, 277) + '…' : text;
}

function formatPhone(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  // Brazilian mobile: 55 + DDD(2) + number(8-9)
  if (d.startsWith('55') && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`;
  }
  return '+' + d;
}

/** Core: return normalized rows for all "negociando" chats across the user's bots. */
export async function extractNegociando(auth) {
  ensureDirs();
  const { idToken, localId, email } = auth || await signIn(); // CLI falls back to .env
  const bots = await listBots(idToken, localId);
  const now = Date.now();
  const rows = [];
  const pending = []; // rows that still need product detection: { row, botId, convId }
  const doneMap = loadDone();
  const naMap = loadNoAnswer();
  let scanned = 0;

  for (const bot of bots) {
    const [agents, departments, convos] = await Promise.all([
      nameMap(idToken, `bots/${bot.id}`, 'agents'),
      nameMap(idToken, `bots/${bot.id}`, 'departments'),
      fetchConversations(idToken, bot.id),
    ]);
    scanned += convos.length;

    for (const conv of convos) {
      if (!hasTagName(conv, TAG_NAME)) continue;
      const c = conv.contact || {};
      const lastMs = toMs(conv.last_message_at) ?? toMs(conv.last_message_received) ?? toMs(conv.start_chat_date);
      const horasDesde = lastMs ? Math.round((now - lastMs) / 36e5 * 10) / 10 : null;
      const tagNames = tagsOf(conv).map((t) => t.name).filter(Boolean);
      const convId = conv._id;
      const feito = doneMap[conv.conversation_id || convId] || doneMap[convId];
      const na = naMap[conv.conversation_id || convId] || naMap[convId];

      const row = {
        bot: bot.name,
        nome: (c.name || c.normalized_name || '').trim() || formatPhone(c.phone_number),
        contato: formatPhone(c.phone_number),
        telefone: c.phone_number ? String(c.phone_number).replace(/\D/g, '') : '',
        canal: conv.channel || '',
        situacao: situacaoOf(tagNames),
        statusSistema: STATUS_PT[conv.status] || conv.status || '',
        tags: tagNames,
        produto: '',           // filled by product detection below
        produtoCodigo: '',
        produtoPreco: null,
        produtoCategoria: '',
        produtoFonte: '',      // 'catálogo' | 'categoria'
        produtoTrecho: '',
        atendente: agents[conv.agent] || (conv.agent ? conv.agent : '—'), // refined from messages below
        departamento: departments[conv.department] || conv.department || '—',
        ultimaInteracao: lastMs ? new Date(lastMs).toISOString() : null,
        ultimaInteracaoMs: lastMs || null,
        horasDesde,
        temperatura: 'morno',  // refined below from conversation signals
        motivos: [],           // why it's hot/cold (interest/disinterest signals)
        interesseScore: null,
        aguardando: false,
        aguardandoMin: null,
        paraLigar: false,      // client waiting for a human reply for 24h+ (call queue)
        naoAtendeuCount: na?.count || 0,        // how many times the call went unanswered
        naoAtendeuAt: na?.at || null,           // last unanswered-call timestamp (queue re-sink)
        noAnswerBucket: (na?.count || 0) >= 2,  // 2+ attempts -> "Não atendeu" filter
        primeiraRespostaMin: null,
        respostaMedianaMin: null,
        naoLidas: conv.unread_messages || 0,
        ultimoRemetente: conv.last_message_sender || '',
        contexto: lastText(conv),
        conversationId: conv.conversation_id || conv._id,
        feito: !!feito,
        feitoAt: feito ? feito.at : null,
        botId: bot.id,          // needed to fetch the transcript on demand
        chatUrl: `https://direct.neoron.io/${bot.id}/calls`,
      };
      rows.push(row);
      pending.push({ row, botId: bot.id, convId, horasDesde });
    }
  }

  // Per-chat enrichment: fetch transcript once, then derive product + attendant +
  // response speed + temperature.
  await mapLimit(pending, 6, async ({ row, botId, convId, horasDesde }) => {
    try {
      const messages = await fetchMessages(idToken, botId, convId);
      const transcript = transcriptOf(messages);

      // product: real catalog SKU first, else category fallback
      const hit = matchProduct(transcript);
      if (hit) {
        row.produto = hit.produto;
        row.produtoCodigo = hit.codigo;
        row.produtoPreco = hit.preco;
        row.produtoCategoria = hit.categoria;
        row.produtoFonte = 'catálogo';
        row.produtoTrecho = `match: ${hit.matched.join(', ')}`;
      } else {
        const { produto, itens } = detectProducts(transcript);
        row.produto = produto;
        row.produtoCategoria = produto ? produto.split(/[;—]/)[0].trim() : '';
        row.produtoFonte = produto ? 'categoria' : '';
        row.produtoTrecho = itens[0]?.snippet || '';
      }

      // real attendant name (parsed from the conversation, not the assigned id)
      const at = attendantName(messages);
      if (at) row.atendente = at;

      // correct response metrics
      const rm = responseMetrics(messages, now);
      row.primeiraRespostaMin = msToMin(rm.firstResponseMs);
      row.respostaMedianaMin = msToMin(rm.medianResponseMs);
      row.aguardando = rm.awaiting;
      row.aguardandoMin = msToMin(rm.awaitingSinceMs);
      // Call queue: client is still waiting for a human reply, and has been for 24h+.
      row.paraLigar = row.aguardando && row.aguardandoMin != null && row.aguardandoMin >= 24 * 60;

      // lead temperature from conversation signals (interest / disinterest)
      const ls = leadScore(messages, { situacao: row.situacao, horasDesde });
      row.temperatura = ls.temperatura;
      row.motivos = ls.motivos;
      row.interesseScore = ls.score;
    } catch {
      row.temperatura = temperaturaOf(horasDesde, false);
    }
  });

  // Sort: longest-waiting first (call queue by seniority), then hottest, then most recent.
  const TEMP_ORDER = { quente: 0, morno: 1, frio: 2 };
  rows.sort((a, b) =>
    ((b.aguardandoMin || 0) - (a.aguardandoMin || 0)) ||
    (TEMP_ORDER[a.temperatura] - TEMP_ORDER[b.temperatura]) ||
    ((b.ultimaInteracaoMs || 0) - (a.ultimaInteracaoMs || 0)));

  const by = (pred) => rows.filter(pred).length;
  const result = {
    generatedAt: new Date(now).toISOString(),
    account: email,
    tag: TAG_NAME,
    botsScanned: bots.map((b) => b.name),
    conversationsScanned: scanned,
    count: rows.length,
    situacao: {
      abertos: by((r) => r.situacao === 'Aberto'),
      vendidos: by((r) => r.situacao === 'Vendido'),
      descartados: by((r) => r.situacao === 'Descartado'),
    },
    temperatura: {
      quentes: by((r) => r.temperatura === 'quente'),
      mornos: by((r) => r.temperatura === 'morno'),
      frios: by((r) => r.temperatura === 'frio'),
    },
    aguardando: by((r) => r.aguardando),
    aguardando24h: by((r) => r.paraLigar),
    naoAtendeu: by((r) => r.noAnswerBucket),
    feitos: by((r) => r.feito),
    rows,
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
  fs.writeFileSync(OUT_CSV, toCsv(rows));

  // history snapshot (pipeline over time) — Aberto leads only, the actionable set
  appendSnapshot({
    at: result.generatedAt,
    abertos: result.situacao.abertos,
    vendidos: result.situacao.vendidos,
    descartados: result.situacao.descartados,
    quentes: result.temperatura.quentes,
    mornos: result.temperatura.mornos,
    frios: result.temperatura.frios,
    aguardando: result.aguardando,
  });

  return result;
}

const CSV_COLS = [
  ['nome', 'Nome'], ['contato', 'Contato'], ['telefone', 'Telefone (raw)'],
  ['situacao', 'Situação'], ['temperatura', 'Temperatura'], ['motivos', 'Motivo (sinais)'],
  ['produto', 'Produto'], ['produtoCodigo', 'Cód. produto'], ['produtoPreco', 'Preço'],
  ['produtoCategoria', 'Categoria'], ['produtoFonte', 'Origem produto'],
  ['atendente', 'Atendente'], ['departamento', 'Departamento'],
  ['aguardando', 'Cliente aguardando'], ['aguardandoMin', 'Aguardando (min)'],
  ['primeiraRespostaMin', '1ª resposta (min)'], ['respostaMedianaMin', 'Resp. mediana (min)'],
  ['feito', 'Feito'], ['feitoAt', 'Feito em'],
  ['statusSistema', 'Status'], ['tags', 'Tags'],
  ['ultimaInteracao', 'Última interação'],
  ['naoLidas', 'Não lidas'], ['ultimoRemetente', 'Último remetente'],
  ['contexto', 'Contexto'], ['produtoTrecho', 'Trecho do produto'],
  ['canal', 'Canal'], ['conversationId', 'Conversation ID'],
];

/** Recompute the summary counts for an arbitrary subset of rows (used by filtered export). */
export function summarizeRows(rows) {
  const by = (pred) => rows.filter(pred).length;
  return {
    count: rows.length,
    situacao: {
      abertos: by((r) => r.situacao === 'Aberto'),
      vendidos: by((r) => r.situacao === 'Vendido'),
      descartados: by((r) => r.situacao === 'Descartado'),
    },
    temperatura: {
      quentes: by((r) => r.temperatura === 'quente'),
      mornos: by((r) => r.temperatura === 'morno'),
      frios: by((r) => r.temperatura === 'frio'),
    },
    aguardando: by((r) => r.aguardando),
    aguardando24h: by((r) => r.paraLigar),
    naoAtendeu: by((r) => r.noAnswerBucket),
    feitos: by((r) => r.feito),
  };
}

export function toCsv(rows) {
  const esc = (v) => {
    if (Array.isArray(v)) v = v.join(' | ');
    if (v == null) v = '';
    const s = neutralizeCell(String(v));
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = CSV_COLS.map(([, label]) => esc(label)).join(',');
  const lines = rows.map((r) => CSV_COLS.map(([key]) => esc(r[key])).join(','));
  return '﻿' + [header, ...lines].join('\r\n') + '\r\n'; // BOM for Excel/accents
}

// CLI entrypoint
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  extractNegociando()
    .then((r) => {
      console.log(`\nNegociando: ${r.count} | abertos ${r.situacao.abertos} · vendidos ${r.situacao.vendidos} · descartados ${r.situacao.descartados}`);
      console.log(`Temperatura: ${r.temperatura.quentes} quentes · ${r.temperatura.mornos} mornos · ${r.temperatura.frios} frios | aguardando: ${r.aguardando}`);
      console.log(`Scanned ${r.conversationsScanned} conversations in: ${r.botsScanned.join(', ')}`);
      console.log(`\nCSV : ${OUT_CSV}\nJSON: ${OUT_JSON}`);
      console.log('\nTop (quentes primeiro):');
      for (const row of r.rows.slice(0, 10)) {
        console.log(`  [${row.temperatura[0].toUpperCase()}] ${row.situacao.padEnd(9)} ${(row.nome || '').slice(0, 16).padEnd(16)} ${row.contato.padEnd(20)} ${(row.atendente || '').padEnd(8)} ${row.aguardando ? '(aguard.)' : '         '} "${(row.contexto || '').slice(0, 32)}"`);
      }
    })
    .catch((e) => { console.error(e); process.exit(1); });
}
