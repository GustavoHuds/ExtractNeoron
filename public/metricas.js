/** Métricas da equipe — manager view (design t2). Renders /api/metrics. */
(function () {
  'use strict';
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const mesLabel = (ym) => {
    const [y, m] = (ym || '').split('-').map(Number);
    return m ? `${MESES[m - 1][0].toUpperCase()}${MESES[m - 1].slice(1)} ${y}` : ym;
  };
  const fmtBRL = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR');
  const num = (v) => (v == null ? '—' : String(v).replace('.', ','));

  let state = { mes: null, data: null };

  function delta(cur, prev, { invert = false, suffix = '', pp = false } = {}) {
    if (cur == null || prev == null) return '';
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return '<span class="delta flat">= igual</span>';
    const better = invert ? d < 0 : d > 0;
    const arrow = d > 0 ? '▲' : '▼';
    const val = `${d > 0 ? '+' : '−'}${String(Math.abs(d)).replace('.', ',')}${pp ? ' pp' : suffix}`;
    return `<span class="delta ${better ? 'up' : 'down'}">${arrow} ${val}</span>`;
  }

  async function render(api) {
    const body = $('#m-body');
    body.innerHTML = '<div class="fila-empty">Calculando métricas…</div>';
    let m;
    try {
      const res = await api('/api/metrics' + (state.mes ? `?mes=${state.mes}` : ''));
      m = await res.json();
    } catch { body.innerHTML = '<div class="fila-empty">Falha ao carregar métricas.</div>'; return; }
    if (m.empty) { body.innerHTML = '<div class="fila-empty">Sem dados ainda — clique em "Atualizar dados".</div>'; return; }
    state.data = m;
    state.mes = m.mes;

    // month selector
    const meses = m.mesesDisponiveis?.length ? m.mesesDisponiveis : [m.mes];
    $('#m-mes').innerHTML = meses.map((x) => `<option value="${esc(x)}" ${x === m.mes ? 'selected' : ''}>${esc(mesLabel(x))}</option>`).join('');
    $('#m-mes').onchange = (e) => { state.mes = e.target.value; render(api); };
    $('#m-compare').textContent = `comparando com ${mesLabel(m.mesAnterior).toLowerCase()}`;

    const k = m.kpis;
    const kpis = `
      <div class="m-kpis">
        <div class="m-kpi"><div class="l">Vendas no mês</div><div class="row"><span class="v">${k.vendas}</span>${delta(k.vendas, k.vendasPrev)}</div></div>
        <div class="m-kpi"><div class="l">Conversão</div><div class="row"><span class="v">${num(k.conversaoPct)}${k.conversaoPct != null ? '%' : ''}</span>${delta(k.conversaoPct, k.conversaoPctPrev, { pp: true })}</div></div>
        <div class="m-kpi"><div class="l">1ª resposta mediana</div><div class="row"><span class="v">${k.primeiraRespostaMedianaMin != null ? k.primeiraRespostaMedianaMin + ' min' : '—'}</span>${delta(k.primeiraRespostaMedianaMin, k.primeiraRespostaMedianaMinPrev, { invert: true, suffix: ' min' })}</div></div>
        <div class="m-kpi"><div class="l">Leads novos</div><div class="row"><span class="v">${k.leadsNovos}</span>${delta(k.leadsNovos, k.leadsNovosPrev)}</div></div>
        <div class="m-kpi"><div class="l">Ticket médio (estim.)</div><div class="row"><span class="v">${fmtBRL(k.ticketMedioEstimado)}</span>${delta(k.ticketMedioEstimado, k.ticketMedioEstimadoPrev, { suffix: '' })}</div></div>
      </div>`;

    // ---- podium
    const top = m.porAtendente.slice(0, 3);
    const order = [top[1], top[0], top[2]]; // 2º 1º 3º
    const heights = [96, 136, 68];
    const podium = `
      <div class="m-card">
        <div class="m-card-head"><h2>Pódio do mês</h2><span class="sub">vendas fechadas</span></div>
        <div class="podium">
          ${order.map((a, i) => a ? `
            <div class="pod ${i === 1 ? 'first' : ''}">
              <span class="pav">${esc(a.nome[0].toUpperCase())}</span>
              <div><div class="pname">${esc(a.nome)}</div>
              <div class="pinfo">${a.vendas} venda${a.vendas === 1 ? '' : 's'}${a.receitaEstimada ? ` · ${fmtBRL(a.receitaEstimada)}` : ''}</div></div>
              <div class="pbar" style="height:${heights[i]}px">
                <span class="prank">${i === 1 ? '1º' : i === 0 ? '2º' : '3º'}</span>
                ${a.vendasPrev != null ? `<span class="pdelta" style="color:${a.vendas >= a.vendasPrev ? (i === 1 ? 'rgba(243,233,210,.8)' : '#2F6E4F') : '#A63A2B'}">${a.vendas >= a.vendasPrev ? '▲ +' + (a.vendas - a.vendasPrev) : '▼ −' + (a.vendasPrev - a.vendas)} vs mês ant.</span>` : ''}
              </div>
            </div>` : '').join('')}
        </div>
        ${m.porAtendente.length > 3 ? `<div class="podium-foot">${m.porAtendente.slice(3, 5).map((a, i) =>
          `<span>${i + 4}º ${esc(a.nome)} · ${a.vendas} venda${a.vendas === 1 ? '' : 's'}</span>`).join('')}</div>` : ''}
      </div>`;

    // ---- sales by attendant, month × prev
    const top5 = m.porAtendente.slice(0, 5);
    const maxV = Math.max(...top5.flatMap((a) => [a.vendas, a.vendasPrev]), 1);
    const H = 150;
    const bars = `
      <div class="m-card">
        <div class="m-card-head"><h2>Vendas por atendente — ${esc(mesLabel(m.mes).toLowerCase())} × ${esc(mesLabel(m.mesAnterior).toLowerCase())}</h2>
          <div class="legend"><span><i style="background:#0E2B52"></i>${esc(mesLabel(m.mes).split(' ')[0])}</span><span><i style="background:#CFC5B0"></i>${esc(mesLabel(m.mesAnterior).split(' ')[0])}</span></div>
        </div>
        <div class="mbar-pairs">
          ${top5.map((a) => `
            <div class="mbar-pair">
              <div class="mbar-col"><span class="mbar-n">${a.vendas}</span><div class="mbar" style="height:${Math.max(4, (a.vendas / maxV) * H)}px"></div></div>
              <div class="mbar-col"><span class="mbar-n prev">${a.vendasPrev}</span><div class="mbar prev" style="height:${Math.max(4, (a.vendasPrev / maxV) * H)}px"></div></div>
            </div>`).join('')}
        </div>
        <div class="mbar-names">
          ${top5.map((a) => `<div class="mbar-name"><div class="n">${esc(a.nome)}</div><div class="c ${a.conversao != null && a.conversao >= 30 ? 'good' : ''}">${a.conversao != null ? 'conv. ' + num(a.conversao) + '%' : ''}</div></div>`).join('')}
        </div>
      </div>`;

    // ---- funnel
    const total = m.kpis.leadsNovos || m.funil.reduce((s, f) => s + f.count, 0) || 1;
    const maxF = Math.max(...m.funil.map((f) => f.count), 1);
    const NOMES_ETAPA = { 'primeiro contato': 'Primeiro contato', 'negociando': 'Negociando', 'proposta enviada': 'Proposta enviada', 'fechamento': 'Fechamento' };
    const funil = `
      <div class="m-card">
        <div class="m-card-head"><h2>Funil aberto por etapa</h2><span class="sub">pipeline atual</span></div>
        <div class="fbars">
          ${m.funil.map((f) => `
            <div>
              <div class="fbar-head"><span style="font-weight:600">${esc(NOMES_ETAPA[f.etapa] || f.etapa)}</span><span style="color:#6B6355">${f.count}</span></div>
              <div class="fbar" style="width:${Math.max(4, (f.count / maxF) * 100)}%"></div>
            </div>`).join('')}
          <div>
            <div class="fbar-head"><span class="good">Vendidos no mês</span><span style="font-weight:700">${k.vendas}</span></div>
            <div class="fbar" style="width:${Math.max(4, (k.vendas / maxF) * 100)}%;background:#2F6E4F"></div>
          </div>
        </div>
        <p class="m-note">${m.finalizados} conversas finalizadas no total · canais dos leads novos: WhatsApp ${m.canais.whatsapp} · Instagram ${m.canais.instagram} · Web ${m.canais.web}${m.canais.outros ? ' · outros ' + m.canais.outros : ''}</p>
      </div>`;

    // ---- response trend
    const trendPts = m.tendenciaResposta.map((t) => ({ label: t.semana.slice(8, 10) + '/' + t.semana.slice(5, 7), value: t.medianaMin }));
    const first = m.tendenciaResposta.find((t) => t.medianaMin != null)?.medianaMin;
    const last = [...m.tendenciaResposta].reverse().find((t) => t.medianaMin != null)?.medianaMin;
    const trendDelta = first != null && last != null && first > 0
      ? Math.round(((last - first) / first) * 100) : null;
    const trend = `
      <div class="m-card">
        <div class="m-card-head"><h2>1ª resposta mediana — 8 semanas</h2>
          ${trendDelta != null ? `<span class="sub ${trendDelta <= 0 ? 'good' : 'bad'}">${trendDelta <= 0 ? '▼' : '▲'} ${Math.abs(trendDelta)}% no período</span>` : ''}
        </div>
        ${window.Charts.lineChart(trendPts, { label: 'Tendência do tempo de primeira resposta' })}
        <p class="m-note">Meta interna: <strong style="color:#211D15">≤ 5 min</strong>. Mediana só conta respostas humanas — bot não vale.</p>
      </div>`;

    // ---- highlights (computed from real data)
    const destaques = buildHighlights(m);
    const hlCard = `
      <div class="m-card m-dark">
        <h2>Destaques do mês</h2>
        ${destaques.map((h) => `<div class="hl"><span class="hl-dot" style="background:${h.cor}"></span><p>${h.html}</p></div>`).join('') || '<p class="hl"><span></span><p style="color:#F3E9D2">Sem destaques ainda.</p></p>'}
      </div>`;

    // ---- full team table
    const sum = (f) => m.porAtendente.reduce((s, a) => s + (f(a) || 0), 0);
    const teamMedianResp = k.primeiraRespostaMedianaMin;
    const notas = m.porAtendente.map((a) => a.aiMedia).filter((n) => n != null);
    const table = `
      <div class="team-table">
        <div class="m-title-row"><h2 style="margin:0;font-size:14.5px;font-weight:700;color:#0A1F3C">Equipe completa</h2><span class="sub" style="font-size:11px;color:#6B6355">mês de ${esc(mesLabel(m.mes).toLowerCase())}</span></div>
        <div class="tt-head"><span>Atendente</span><span class="tt-r">Conversas</span><span class="tt-r">Vendas ▾</span><span class="tt-r">Conversão</span><span class="tt-r">1ª resp. mediana</span><span class="tt-r">Aguardando</span><span class="tt-r">Nota IA média</span><span class="tt-r">Vendas · 8 sem</span></div>
        ${m.porAtendente.map((a, i) => {
          const warn = (a.conversao != null && a.conversao < 20 && a.conversas >= 5) || (a.primeiraRespostaMedianaMin != null && a.primeiraRespostaMedianaMin > 20);
          return `
          <div class="tt-row ${warn ? 'warn' : ''}">
            <span class="who"><span class="agent-avatar" style="background:${i === 0 ? '#0E2B52' : '#1D3E6E'}">${esc(a.nome[0].toUpperCase())}</span>
              <span style="font-weight:700">${esc(a.nome)}</span>
              ${i === 0 && a.vendas > 0 ? '<span class="tag1">1º</span>' : ''}${warn ? '<span class="tagwarn">atenção</span>' : ''}</span>
            <span class="tt-r">${a.conversas}</span>
            <span class="tt-r" style="font-weight:800">${a.vendas}</span>
            <span class="tt-r ${a.conversao != null && a.conversao >= 30 ? 'good' : a.conversao != null && a.conversao < 20 && a.conversas >= 5 ? 'bad' : ''}">${a.conversao != null ? num(a.conversao) + '%' : '—'}</span>
            <span class="tt-r ${a.primeiraRespostaMedianaMin != null && a.primeiraRespostaMedianaMin > 20 ? 'bad' : ''}">${a.primeiraRespostaMedianaMin != null ? a.primeiraRespostaMedianaMin + ' min' : '—'}</span>
            <span class="tt-r">${a.aguardando}</span>
            <span class="tt-r ${a.aiMedia != null && a.aiMedia >= 8.5 ? 'good' : ''}">${a.aiMedia != null ? num(a.aiMedia) : '—'}</span>
            ${window.Charts.sparkline(a.vendasSemana)}
          </div>`;
        }).join('')}
        <div class="tt-foot">
          <span>Equipe (${m.porAtendente.length})</span>
          <span class="tt-r">${sum((a) => a.conversas)}</span>
          <span class="tt-r">${sum((a) => a.vendas)}</span>
          <span class="tt-r">${k.conversaoPct != null ? num(k.conversaoPct) + '%' : '—'}</span>
          <span class="tt-r">${teamMedianResp != null ? teamMedianResp + ' min' : '—'}</span>
          <span class="tt-r">${sum((a) => a.aguardando)}</span>
          <span class="tt-r">${notas.length ? num(Math.round(notas.reduce((s, n) => s + n, 0) / notas.length * 10) / 10) : '—'}</span>
          <span></span>
        </div>
      </div>`;

    body.innerHTML = kpis
      + `<div class="m-grid">${podium}${bars}</div>`
      + `<div class="m-grid3">${funil}${trend}${hlCard}</div>`
      + table;
  }

  function buildHighlights(m) {
    const out = [];
    const k = m.kpis;
    const best = m.porAtendente[0];
    if (best && best.vendas > 0 && best.conversao != null) {
      const media = k.conversaoPct;
      const fator = media ? Math.round((best.conversao / media) * 10) / 10 : null;
      out.push({
        cor: '#2F6E4F',
        html: `<strong>${esc(best.nome)} converte ${num(best.conversao)}%</strong>${fator && fator > 1 ? ` — ${num(fator)}× a média da equipe` : ''}.${best.aiMedia != null ? ` Nota IA ${num(best.aiMedia)}.` : ''}`,
      });
    }
    const caiu = m.porAtendente.find((a) => a.vendasPrev > a.vendas && a.vendasPrev - a.vendas >= 2);
    if (caiu) {
      out.push({
        cor: '#A63A2B',
        html: `<strong>${esc(caiu.nome)} caiu de ${caiu.vendasPrev} → ${caiu.vendas} vendas</strong>${caiu.primeiraRespostaMedianaMin != null ? ` e responde em ${caiu.primeiraRespostaMedianaMin} min` : ''}. Vale revisar as conversas.`,
      });
    }
    const aguardandoTotal = m.porAtendente.reduce((s, a) => s + a.aguardando, 0);
    if (aguardandoTotal > 0) {
      out.push({
        cor: '#A85A0A',
        html: `<strong>${aguardandoTotal} lead${aguardandoTotal > 1 ? 's' : ''} aguardando resposta</strong> — cada hora de espera esfria o cliente. Priorize a fila de ligações.`,
      });
    }
    if (m.canais.instagram > 0) {
      out.push({
        cor: '#2F6E4F',
        html: `<strong>${m.canais.instagram} lead${m.canais.instagram > 1 ? 's' : ''} novo${m.canais.instagram > 1 ? 's' : ''} pelo Instagram</strong> este mês — o canal já gera demanda além do WhatsApp.`,
      });
    }
    return out.slice(0, 4);
  }

  window.Metricas = { render };
})();
