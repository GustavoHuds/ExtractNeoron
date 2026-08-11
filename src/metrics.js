/**
 * Message-level metrics: real attendant name + correct response speed.
 *
 * Neoron message docs: { sender: 'user'|'agent'|'bot', created_date: ms,
 * message:{content}, message_list:[{content}] }. Agent messages are prefixed
 * with the human attendant's name, e.g. "Jonas: bom dia".
 */

export function stripHtml(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/<\/(p|div|br)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function messageText(m) {
  if (m.message && typeof m.message === 'object' && m.message.content) return stripHtml(m.message.content);
  if (Array.isArray(m.message_list)) return m.message_list.map((x) => stripHtml(x && x.content)).filter(Boolean).join(' ');
  if (m.replied_message && m.replied_message.content) return stripHtml(m.replied_message.content);
  return '';
}

const NAME_BLOCK = /atendimento|grupo|belmont|lojas|bem-?vindo|ol[aá]\b|aguarde|fila/i;

/** Parse a "Nome:" prefix from an agent message. */
export function parseAttendant(text) {
  const t = stripHtml(text).trim();
  const m = t.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.\s]{1,24}?)\s*:/);
  if (!m) return null;
  const name = m[1].trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 25 || NAME_BLOCK.test(name)) return null;
  return name;
}

/** Most frequent attendant name across agent messages (or null). */
export function attendantName(messages) {
  const counts = new Map();
  for (const m of messages) {
    if (m.sender !== 'agent') continue;
    const name = parseAttendant(messageText(m));
    if (name) counts.set(name, (counts.get(name) || 0) + 1);
  }
  let best = null;
  for (const [n, c] of counts) if (!best || c > best.c) best = { n, c };
  return best ? best.n : null;
}

/**
 * Correct response-speed metrics for one conversation (chronological messages).
 * A "response" = elapsed time from the first unanswered customer message to the
 * next human agent reply (bot auto-replies are ignored). This fixes the old
 * "time since last message" metric that counted agent-sent messages as waiting.
 */
export function responseMetrics(messages, now = null) {
  const responses = [];
  let pendingUserTs = null;
  let firstResponseMs = null;
  const DAY7 = 7 * 24 * 3600 * 1000;

  for (const m of messages) {
    const ts = m.created_date || m.id;
    if (!ts) continue;
    if (m.sender === 'user') {
      if (pendingUserTs == null) pendingUserTs = ts;
    } else if (m.sender === 'agent') {
      if (pendingUserTs != null) {
        const d = ts - pendingUserTs;
        if (d >= 0 && d < DAY7) {
          responses.push(d);
          if (firstResponseMs == null) firstResponseMs = d;
        }
        pendingUserTs = null;
      }
    }
    // bot messages: ignored (not a human answer)
  }

  const sorted = [...responses].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
  const avg = responses.length ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length) : null;

  return {
    firstResponseMs,
    avgResponseMs: avg,
    medianResponseMs: median,
    responseCount: responses.length,
    // customer is waiting on us iff the last message was an unanswered user message
    awaiting: pendingUserTs != null,
    awaitingSinceMs: pendingUserTs != null && now ? now - pendingUserTs : null,
    responses,
  };
}

/**
 * Lead temperature from conversation content (interest / disinterest signals),
 * not just recency. Returns { temperatura, score, motivos[] } — explainable.
 * Customer (user) messages carry the intent; recent messages weigh more.
 */
const SIGNALS = [
  // fechamento / compra (forte +)
  { re: /\b(vou querer|quero (comprar|levar|sim|esse|essa)|vou levar|pode (mandar|fazer|gerar) o?\s?(link|pedido)?|manda(r)? o link|fazer o pedido|fechar( o)? pedido|vou ficar com|pode faturar|bora fechar|fechado)\b/i, w: 4, cat: 'compra', label: 'sinal de fechamento' },
  { re: /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/, w: 4, cat: 'compra', label: 'enviou CPF' },
  { re: /\b(meus dados|segue os dados|meu endere[çc]o|meu cep|comprovante|pix (feito|enviado|realizad)|paguei|efetuei o pagamento)\b/i, w: 4, cat: 'compra', label: 'enviou dados/pagamento' },
  // interesse ativo (médio +)
  { re: /\b(quanto|qual o valor|valor|pre[çc]o|parcela|cart[aã]o|boleto|[àa] vista|quantas vezes|sem juros|entrada|desconto|forma de pagamento|consegue por)\b/i, w: 2, cat: 'preco', label: 'perguntou preço/pagamento' },
  { re: /\b(entrega|frete|quando chega|prazo|voc[êe]s? entregam|entrega em|meu bairro|chega hoje|chega amanh)\b/i, w: 2, cat: 'entrega', label: 'perguntou entrega' },
  { re: /\b(gostei|amei|adorei|perfeito|[óo]timo|[óo]tima|maravilhos|lindo|linda|show|top|isso mesmo|era isso|amei esse)\b/i, w: 2, cat: 'positivo', label: 'gostou do produto' },
  // pedido de info (leve +)
  { re: /\b(tem foto|manda(r)?( a)? foto|tem v[íi]deo|qual( a)? medida|medidas|dispon[íi]vel|tem em outra|outras cores|tem (de )?outra|em estoque)\b/i, w: 1, cat: 'info', label: 'pediu mais informação' },
  // adiamento (leve -)
  { re: /\b(vou pensar|vou ver|vou falar com|depois( eu)?( te)? (falo|retorno)|mais tarde|amanh[ãa] (eu )?(te )?(falo|retorno|vejo)|vou confirmar|semana que vem|qualquer coisa( eu)?( te)? chamo|vou dar uma olhada|deixa eu ver|to s[óo] pesquisando)\b/i, w: -1, cat: 'adiando', label: 'vai pensar/adiar' },
  // objeção de preço (forte -)
  { re: /\b(muito caro|t[áa] caro|achei caro|caro demais|acima d(o|a) (meu|minha)|fora do( meu)? or[çc]amento|n[ãa]o tenho como|sem condi[çc][õo]es|muito salgado|t[áa] salgado|n[ãa]o posso pagar)\b/i, w: -4, cat: 'objecao', label: 'achou caro' },
  // rejeição / desinteresse (forte -)
  { re: /\b(n[ãa]o (quero|tenho interesse|vou querer|vou poder|era isso|é isso)|desisti|deixa (pra|para)( a)? pr[óo]xima|s[óo] (estava|tava|to) (olhando|pesquisando|vendo pre[çc]o)|obrigad[oa],?\s*(mas )?(n[ãa]o|vou pensar)|era s[óo] (isso|informa))\b/i, w: -4, cat: 'rejeicao', label: 'sem interesse' },
  // crédito reprovado (médio -)
  { re: /\b(n[ãa]o passou|reprovad|sem score|nome (sujo|negativad)|(t[ôo]|estou) no serasa|nome no spc|n[ãa]o (tem|ten) limite)\b/i, w: -3, cat: 'credito', label: 'crédito reprovado' },
];

export function leadScore(messages, { situacao, horasDesde = null } = {}) {
  if (situacao === 'Descartado') return { temperatura: 'frio', score: -99, motivos: ['desqualificado'] };

  const userMsgs = messages.filter((m) => m.sender === 'user');
  const n = userMsgs.length;
  let score = 0;
  const hits = new Map(); // cat -> { label, w, recent }
  let distinctPos = 0;

  userMsgs.forEach((m, i) => {
    const recent = i >= n - 4; // last 4 customer messages weigh more
    const text = messageText(m);
    if (!text) return;
    for (const s of SIGNALS) {
      if (!s.re.test(text)) continue;
      score += s.w * (recent ? 1.5 : 1);
      const prev = hits.get(s.cat);
      if (!prev) { hits.set(s.cat, { label: s.label, w: s.w, recent }); if (s.w >= 2) distinctPos++; }
      else if (recent) hits.set(s.cat, { label: s.label, w: s.w, recent });
    }
  });

  // strongest recent negative overrides older positives (customer cooled off)
  const recentNeg = [...hits.values()].some((h) => h.recent && h.w <= -3);
  const recentPos = [...hits.values()].some((h) => h.recent && h.w >= 2);

  let temperatura;
  if (recentNeg && !recentPos) temperatura = 'frio';
  // quente = intenção forte: fechamento/dados, ou 2+ sinais de interesse distintos
  else if (score >= 4 && (distinctPos >= 2 || [...hits.values()].some((h) => h.w >= 4))) temperatura = 'quente';
  else if (score >= 1) temperatura = 'morno';                 // interesse moderado
  else if (score <= -3) temperatura = 'frio';                 // objeção/rejeição
  else temperatura = (horasDesde != null && horasDesde > 72) ? 'frio' : 'morno'; // neutro: recência decide

  const motivos = [...hits.values()].sort((a, b) => b.w - a.w).map((h) => h.label);
  return { temperatura, score: Math.round(score * 10) / 10, motivos };
}
