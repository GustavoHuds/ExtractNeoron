/**
 * Lead normalization: one Neoron conversation -> one lead row, channel-aware.
 * WhatsApp leads carry a phone; Instagram leads carry @username (no phone);
 * Web-chat leads may carry neither. Every downstream feature (call queue,
 * exports, metrics) works from this single shape.
 */
import { stripHtml, parseAttendant, messageText } from './metrics.js';

// Preset outcomes recorded when concluding a lead in the "Finalizar" popup.
export const REASON_LABELS = {
  vendido: 'Vendido',
  sem_retorno: 'Sem retorno',
  sem_interesse: 'Sem interesse',
  concorrente: 'Comprou concorrente',
  outro: 'Outro',
};
export const reasonLabel = (slug) => REASON_LABELS[slug] || (slug || '');

// Funnel stages resolved from contact tags (first match wins, most advanced
// first). Leads without a stage tag sit in "primeiro contato".
const STAGE_TAGS = ['fechamento', 'proposta enviada', 'negociando'];
export const DEFAULT_STAGE = 'primeiro contato';

// System status -> friendly Portuguese label.
const STATUS_PT = {
  CHATBOT: 'Bot',
  TAKEOVER_QUEUE: 'Na fila',
  TAKEOVER_ATTEMPT: 'Tentando atender',
  TAKEOVER_IN_ATTENDANCE: 'Em atendimento',
  TAKEOVER_FINISHED: 'Finalizado',
  FINISHED: 'Finalizado',
  CLOSED: 'Encerrado',
};

// Channel -> UI label. Conversations without a channel are legacy docs.
const CANAL_LABEL = { WHATSAPP: 'WhatsApp', INSTAGRAM: 'Instagram', WEB: 'Web' };
export function canalOf(conv) {
  const c = String(conv.channel || '').toUpperCase();
  return { canal: c || 'DESCONHECIDO', canalLabel: CANAL_LABEL[c] || 'Outro' };
}

/** All tag objects on a conversation. Neoron stores tags as OBJECT MAPS
 * ({id: {name, color, id}}) on both contact.tags and conversation.tags. */
export function tagsOf(conv) {
  const vals = (x) => (x && typeof x === 'object' ? Object.values(x) : []);
  const seen = new Map();
  for (const t of [...vals(conv.contact?.tags), ...vals(conv.tags)]) {
    if (t && (t.id || t.name)) seen.set(t.id || t.name, { name: t.name || '', color: t.color || '' });
  }
  return [...seen.values()].filter((t) => t.name);
}

/** Commercial situation from the contact's tags. */
export function situacaoOf(tagNames) {
  const s = tagNames.map((t) => t.toLowerCase());
  if (s.includes('venda realizada')) return 'Vendido';
  if (s.includes('desqualificado')) return 'Descartado';
  return 'Aberto';
}

/** Funnel stage from the contact's tags. */
export function etapaOf(tagNames) {
  const s = tagNames.map((t) => t.toLowerCase());
  for (const stage of STAGE_TAGS) if (s.includes(stage)) return stage;
  return DEFAULT_STAGE;
}

/** Normalize a Firestore timestamp-ish value to epoch ms (or null). */
export function toMs(v) {
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

export function formatPhone(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  if (!d) return '';
  // Brazilian mobile: 55 + DDD(2) + number(8-9)
  if (d.startsWith('55') && d.length >= 12) {
    const ddd = d.slice(2, 4);
    const rest = d.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`;
  }
  return '+' + d;
}

/** Best-effort last message text for the "Contexto" column. */
export function lastText(conv) {
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

/** Best-effort label for a non-text (media) message. */
function mediaLabel(m) {
  const t = String(m.type || m.message?.type || m.media_type || m.message?.media_type || '').toLowerCase();
  if (/image|img|foto|photo|sticker/.test(t)) return '[imagem]';
  if (/audio|voice|ptt/.test(t)) return '[áudio]';
  if (/video/.test(t)) return '[vídeo]';
  if (/file|document|doc|pdf/.test(t)) return '[arquivo]';
  return '[mídia]';
}

/** Build a transcript string from message docs. */
export function transcriptOf(messages) {
  return messages.map((m) => messageText(m)).filter(Boolean).join('\n');
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

/**
 * Base lead row from conversation metadata (no messages needed).
 * Enrichment fields (product, response speed, temperature, IA) are filled by
 * the extractor from messages or from the cached conversation index.
 */
export function baseLead({ bot, conv, agents = {}, departments = {}, doneMap = {}, naMap = {}, now = Date.now() }) {
  const c = conv.contact || {};
  const { canal, canalLabel } = canalOf(conv);
  const lastMs = toMs(conv.last_message_at) ?? toMs(conv.last_message_received) ?? toMs(conv.start_chat_date);
  const horasDesde = lastMs ? Math.round((now - lastMs) / 36e5 * 10) / 10 : null;
  const tags = tagsOf(conv);
  const tagNames = tags.map((t) => t.name);
  const convId = conv.conversation_id || conv._id;
  const feito = doneMap[convId] || doneMap[conv._id];
  const na = naMap[convId] || naMap[conv._id];
  const instagram = (c.instagram_username || '').trim();
  const telefone = c.phone_number ? String(c.phone_number).replace(/\D/g, '') : '';

  return {
    bot: bot.name,
    nome: (c.name || c.normalized_name || '').trim() || (instagram ? `@${instagram}` : formatPhone(telefone)) || convId,
    contato: formatPhone(telefone),
    telefone,
    instagram,                                // @username for Instagram DM leads
    canal,                                    // WHATSAPP | INSTAGRAM | WEB | DESCONHECIDO
    canalLabel,                               // WhatsApp | Instagram | Web | Outro
    situacao: situacaoOf(tagNames),
    etapa: etapaOf(tagNames),                 // funnel stage from tags
    statusSistema: STATUS_PT[conv.status] || conv.status || '',
    tags,                                     // [{name, color}] — real Neoron colors
    produto: '',
    produtoCodigo: '',
    produtoPreco: null,
    produtoCategoria: '',
    produtoFonte: '',                         // 'catálogo' | 'categoria'
    produtoTrecho: '',
    atendente: agents[conv.agent] || (conv.agent ? conv.agent : '—'),
    departamento: departments[conv.department] || conv.department || '—',
    ultimaInteracao: lastMs ? new Date(lastMs).toISOString() : null,
    ultimaInteracaoMs: lastMs || null,
    horasDesde,
    temperatura: 'morno',
    motivos: [],
    interesseScore: null,
    aguardando: false,
    aguardandoMin: null,
    paraLigar: false,                         // waiting for a human reply 24h+
    naoAtendeuCount: na?.count || 0,
    naoAtendeuAt: na?.at || null,
    naoAtendeuNota: na?.note || '',
    noAnswerBucket: (na?.count || 0) >= 2,
    primeiraRespostaMin: null,
    respostaMedianaMin: null,
    naoLidas: conv.unread_messages || 0,
    ultimoRemetente: typeof conv.last_message_sender === 'string' ? conv.last_message_sender : '',
    contexto: lastText(conv),
    aiNota: null,
    aiMotivo: '',
    conversationId: convId,
    feito: !!feito,
    feitoAt: feito ? feito.at : null,
    feitoReason: feito ? (feito.reason || '') : '',
    feitoReasonLabel: feito ? reasonLabel(feito.reason) : '',
    feitoNota: feito ? (feito.note || '') : '',
    feitoPor: feito ? (feito.by || '') : '',
    temUsuario: false,                        // set from messages: real customer spoke
    botId: bot.id,
    chatUrl: `https://direct.neoron.io/${bot.id}/calls`,
  };
}

/** Row for a finalized lead no longer present in Neoron (rebuilt from the
 * snapshot taken when it was concluded). Lives only in the Finalizados tab. */
export function archivedRow(id, entry) {
  const s = entry.snap || {};
  return {
    bot: s.bot || '',
    nome: s.nome || s.contato || id,
    contato: s.contato || '',
    telefone: s.telefone || '',
    instagram: s.instagram || '',
    canal: s.canal || 'DESCONHECIDO',
    canalLabel: s.canalLabel || 'Outro',
    situacao: s.situacao || 'Aberto',
    etapa: s.etapa || DEFAULT_STAGE,
    statusSistema: '',
    tags: Array.isArray(s.tags) ? s.tags : [],
    produto: s.produto || '',
    produtoCodigo: s.produtoCodigo || '',
    produtoPreco: s.produtoPreco ?? null,
    produtoCategoria: '',
    produtoFonte: '',
    produtoTrecho: '',
    atendente: s.atendente || '—',
    departamento: s.departamento || '—',
    ultimaInteracao: s.ultimaInteracao || null,
    ultimaInteracaoMs: s.ultimaInteracaoMs || null,
    horasDesde: null,
    temperatura: 'frio',
    motivos: [],
    interesseScore: null,
    aguardando: false,
    aguardandoMin: null,
    paraLigar: false,
    naoAtendeuCount: 0,
    naoAtendeuAt: null,
    naoAtendeuNota: '',
    noAnswerBucket: false,
    primeiraRespostaMin: null,
    respostaMedianaMin: null,
    naoLidas: 0,
    ultimoRemetente: '',
    contexto: s.contexto || '',
    aiNota: typeof s.aiNota === 'number' ? s.aiNota : null,
    aiMotivo: s.aiMotivo || '',
    conversationId: id,
    feito: true,
    feitoAt: entry.at || null,
    feitoReason: entry.reason || '',
    feitoReasonLabel: reasonLabel(entry.reason),
    feitoNota: entry.note || '',
    feitoPor: entry.by || '',
    arquivado: true,
    temUsuario: true,
    botId: s.botId || '',
    chatUrl: s.chatUrl || '',
  };
}
