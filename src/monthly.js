/**
 * Real monthly metrics, computed from the FULL conversation base.
 *
 * Honest definitions (see docs/METRICS.md):
 * - "Leads novos"       = conversations whose FIRST customer message is in the
 *                         month (the customer actually spoke — bot-only chats
 *                         don't count as leads).
 * - "Conversas ativas"  = conversations with at least one message in the month.
 * - "Vendas"            = union of (a) leads concluded as "Vendido" in the
 *                         dashboard, by conclusion date, and (b) leads tagged
 *                         "venda realizada" in Neoron, by last-activity date —
 *                         deduplicated per conversation.
 * - "Conversão"         = vendas ÷ leads novos of the same month.
 * - "1ª resposta"       = median time from the customer's first unanswered
 *                         message to the first HUMAN reply (bots ignored),
 *                         over conversations started in the month.
 * - "Ticket médio"      = mean catalog price of the products detected on sold
 *                         leads (estimate — Neoron has no order values).
 */

export const monthKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function prevMonthKey(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return monthKey(d.getTime());
}

/** ISO-ish week key (Monday-based) for trend buckets. */
export const weekKey = (ms) => {
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7; // Mon=0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return monday.toISOString().slice(0, 10);
};

/** Epoch ms when this lead counts as sold, or null. Dashboard conclusion wins
 * (precise date); the Neoron tag falls back to last activity. */
export function soldAtMs(row) {
  if (row.feitoReason === 'vendido' && row.feitoAt) {
    const t = Date.parse(row.feitoAt);
    if (!Number.isNaN(t)) return t;
  }
  if (row.situacao === 'Vendido') return row.ultimaInteracaoMs || null;
  return null;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};
const msToMin = (ms) => (ms == null ? null : Math.round(ms / 60000));
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * @param rows   lead rows from the last extraction
 * @param index  conversation index (firstUserTs, monthsActive, firstResponseMs…)
 * @param month  'YYYY-MM' (default: current month)
 */
export function buildMonthly(rows, index, { month, now = Date.now() } = {}) {
  const mes = month || monthKey(now);
  const mesAnterior = prevMonthKey(mes);
  const byId = (id) => index[id] || null;

  // ---- helpers over one month --------------------------------------------
  const novosNo = (m) => rows.filter((r) => {
    const e = byId(r.conversationId);
    const t = e?.firstUserTs || e?.firstTs || null;
    return t != null && monthKey(t) === m;
  });
  const ativasNo = (m) => rows.filter((r) => (byId(r.conversationId)?.monthsActive || []).includes(m));
  const vendasNo = (m) => rows.filter((r) => {
    const t = soldAtMs(r);
    return t != null && monthKey(t) === m;
  });
  const respostaMedianaNo = (m) => {
    const vals = [];
    for (const r of rows) {
      const e = byId(r.conversationId);
      if (!e || e.firstResponseMs == null) continue;
      const t = e.firstUserTs || e.firstTs;
      if (t != null && monthKey(t) === m) vals.push(e.firstResponseMs);
    }
    return median(vals);
  };
  const ticketNo = (m) => {
    const precos = vendasNo(m).map((r) => r.produtoPreco).filter((p) => typeof p === 'number' && p > 0);
    return precos.length ? Math.round(precos.reduce((a, b) => a + b, 0) / precos.length) : null;
  };

  const novos = novosNo(mes), novosPrev = novosNo(mesAnterior);
  const vendas = vendasNo(mes), vendasPrev = vendasNo(mesAnterior);
  const ativas = ativasNo(mes), ativasPrev = ativasNo(mesAnterior);
  const conv = novos.length ? round1((vendas.length / novos.length) * 100) : null;
  const convPrev = novosPrev.length ? round1((vendasPrev.length / novosPrev.length) * 100) : null;

  // ---- funnel (current open pipeline + finalized) ------------------------
  const abertos = rows.filter((r) => r.situacao === 'Aberto' && !r.feito && r.temUsuario);
  const funil = ['primeiro contato', 'negociando', 'proposta enviada', 'fechamento']
    .map((etapa) => ({ etapa, count: abertos.filter((r) => r.etapa === etapa).length }));
  const finalizados = rows.filter((r) => r.feito || r.situacao !== 'Aberto').length;

  // ---- per-attendant ------------------------------------------------------
  const nomes = [...new Set(rows.map((r) => r.atendente).filter((a) => a && a !== '—'))];
  const last8 = lastWeeks(8, now);
  const porAtendente = nomes.map((nome) => {
    const deles = rows.filter((r) => r.atendente === nome);
    const convsAtivas = deles.filter((r) => (byId(r.conversationId)?.monthsActive || []).includes(mes));
    const vend = deles.filter((r) => { const t = soldAtMs(r); return t != null && monthKey(t) === mes; });
    const vendPrev = deles.filter((r) => { const t = soldAtMs(r); return t != null && monthKey(t) === mesAnterior; });
    const respostas = deles
      .map((r) => byId(r.conversationId))
      .filter((e) => e && e.firstResponseMs != null && monthKey(e.firstUserTs || e.firstTs || 0) === mes)
      .map((e) => e.firstResponseMs);
    const notas = deles.map((r) => r.aiNota).filter((n) => typeof n === 'number');
    const receita = vend.map((r) => r.produtoPreco).filter((p) => typeof p === 'number' && p > 0)
      .reduce((a, b) => a + b, 0);
    const vendasSemana = last8.map((wk) =>
      deles.filter((r) => { const t = soldAtMs(r); return t != null && weekKey(t) === wk; }).length);
    return {
      nome,
      conversas: convsAtivas.length,
      vendas: vend.length,
      vendasPrev: vendPrev.length,
      conversao: convsAtivas.length ? round1((vend.length / convsAtivas.length) * 100) : null,
      primeiraRespostaMedianaMin: msToMin(median(respostas)),
      aguardando: deles.filter((r) => r.aguardando && !r.feito).length,
      aiMedia: notas.length ? round1(notas.reduce((a, b) => a + b, 0) / notas.length) : null,
      receitaEstimada: receita || null,
      vendasSemana,
    };
  }).sort((a, b) => b.vendas - a.vendas || (b.conversao || 0) - (a.conversao || 0));

  // ---- 8-week first-response trend ----------------------------------------
  const porSemana = new Map(last8.map((wk) => [wk, []]));
  for (const r of rows) {
    const e = byId(r.conversationId);
    if (!e || e.firstResponseMs == null) continue;
    const t = e.firstUserTs || e.firstTs;
    if (t == null) continue;
    const wk = weekKey(t);
    if (porSemana.has(wk)) porSemana.get(wk).push(e.firstResponseMs);
  }
  const tendenciaResposta = last8.map((wk) => ({
    semana: wk,
    medianaMin: msToMin(median(porSemana.get(wk) || [])),
  }));

  return {
    mes,
    mesAnterior,
    geradoEm: new Date(now).toISOString(),
    kpis: {
      vendas: vendas.length,
      vendasPrev: vendasPrev.length,
      conversaoPct: conv,
      conversaoPctPrev: convPrev,
      primeiraRespostaMedianaMin: msToMin(respostaMedianaNo(mes)),
      primeiraRespostaMedianaMinPrev: msToMin(respostaMedianaNo(mesAnterior)),
      leadsNovos: novos.length,
      leadsNovosPrev: novosPrev.length,
      conversasAtivas: ativas.length,
      conversasAtivasPrev: ativasPrev.length,
      ticketMedioEstimado: ticketNo(mes),
      ticketMedioEstimadoPrev: ticketNo(mesAnterior),
    },
    canais: {
      whatsapp: novos.filter((r) => r.canal === 'WHATSAPP').length,
      instagram: novos.filter((r) => r.canal === 'INSTAGRAM').length,
      web: novos.filter((r) => r.canal === 'WEB').length,
      outros: novos.filter((r) => r.canal === 'DESCONHECIDO').length,
    },
    funil,
    finalizados,
    porAtendente,
    tendenciaResposta,
    // months with any activity — feeds the month selector in the UI
    mesesDisponiveis: [...new Set(Object.values(index).flatMap((e) => e.monthsActive || []))].sort().reverse(),
  };
}

export function lastWeeks(n, now = Date.now()) {
  const out = [];
  const WEEK = 7 * 24 * 3600 * 1000;
  const cur = weekKey(now);
  const curMs = Date.parse(cur);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(curMs - i * WEEK).toISOString().slice(0, 10));
  return out;
}
