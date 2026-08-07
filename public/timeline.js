const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`;

function card(title, hint, body) {
  return `<div class="card"><h3>${title}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}${body}</div>`;
}

function barChart(data, key, labelKey, color = 'var(--accent)') {
  const w = 620, h = 190, pad = 26;
  if (!data.length) return '<p class="hint">Sem dados.</p>';
  const max = Math.max(1, ...data.map((d) => d[key] || 0));
  const bw = (w - pad * 2) / data.length;
  const step = Math.ceil(data.length / 8) || 1;
  const bars = data.map((d, i) => {
    const bh = (h - pad * 2) * ((d[key] || 0) / max);
    const x = pad + i * bw, y = h - pad - bh;
    return `<rect x="${x + 2}" y="${y}" width="${Math.max(1, bw - 4)}" height="${bh}" rx="2" fill="${color}"><title>${esc(d[labelKey])}: ${d[key] ?? 0}</title></rect>`
      + (i % step === 0 ? `<text x="${x + bw / 2}" y="${h - 8}" text-anchor="middle">${esc(String(d[labelKey]).slice(5))}</text>` : '');
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%"><text x="${pad}" y="14">máx ${max}</text>${bars}</svg>`;
}

function lineChart(data, key, labelKey, color = 'var(--warm)') {
  const w = 620, h = 190, pad = 30;
  const pts = data.filter((d) => d[key] != null);
  if (pts.length < 2) return '<p class="hint">Amostra insuficiente.</p>';
  const max = Math.max(1, ...pts.map((d) => d[key]));
  const x = (i) => pad + (w - pad * 2) * (i / (pts.length - 1));
  const y = (v) => h - pad - (h - pad * 2) * (v / max);
  const line = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
  const dots = pts.map((d, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.5" fill="${color}"><title>${esc(d[labelKey])}: ${fmtMin(d[key])}</title></circle>`).join('');
  const step = Math.ceil(pts.length / 8) || 1;
  const labels = pts.map((d, i) => i % step === 0 ? `<text x="${x(i)}" y="${h - 8}" text-anchor="middle">${esc(String(d[labelKey]).slice(5))}</text>` : '').join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%"><text x="${pad}" y="14">máx ${fmtMin(max)}</text><path d="${line}" fill="none" stroke="${color}" stroke-width="2"/>${dots}${labels}</svg>`;
}

function hbars(items, opts = {}) {
  const { fmt = (v) => v, color = 'var(--accent)' } = opts;
  const max = Math.max(1, ...items.map((i) => i.value));
  return items.map((it) => `
    <div class="bar-row">
      <div title="${esc(it.label)}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(it.value / max * 100).toFixed(1)}%;background:${it.color || color}"></div></div>
      <div style="text-align:right">${fmt(it.value)}</div>
    </div>`).join('');
}

function render(t) {
  $('#meta').innerHTML = `Conta <strong>${esc(t.account || '')}</strong> · ${t.totalConversas} conversas · atualizado ${new Date(t.generatedAt).toLocaleString('pt-BR')}`;

  $('#kpis').innerHTML = [
    ['1ª resposta (mediana)', fmtMin(t.velocidade.primeiraRespostaMedianaMin), 'tempo real cliente→atendente'],
    ['1ª resposta (média)', fmtMin(t.velocidade.primeiraRespostaMediaMin), 'inflada por respostas noturnas'],
    ['Conversão', `${t.conversao.taxa}%`, `${t.conversao.vendidos} vendas / ${t.conversao.entraram} em negociação`],
    ['Aguardando resposta', String(t.atendentes.reduce((a, x) => a + x.aguardando, 0)), 'clientes sem resposta agora'],
    ['Conversas (amostra)', String(t.respostaAmostras), 'últimos 45 dias'],
  ].map(([k, v, s]) => `<div class="kpi"><small>${k}</small><b>${v}</b><small>${s}</small></div>`).join('');

  const sit = t.situacao;
  const sitBars = hbars([
    { label: 'Aberto', value: sit.Aberto, color: 'var(--cold)' },
    { label: 'Vendido', value: sit.Vendido, color: 'var(--ok)' },
    { label: 'Descartado', value: sit.Descartado, color: 'var(--hot)' },
  ]);

  const distBars = hbars(t.velocidade.distribuicao.map((d) => ({
    label: d.faixa, value: d.n,
    color: /4 h|> 4|1–4/.test(d.faixa) ? 'var(--hot)' : 'var(--accent)',
  })));

  const agBars = hbars(t.atendentes.map((a) => ({ label: a.nome, value: a.conversas })), { fmt: (v) => v });
  const agTable = `<table style="width:100%;margin-top:8px"><thead><tr>
    <th>Atendente</th><th>Conversas</th><th>1ª resp.</th><th>Vendas</th><th>Aguard.</th></tr></thead><tbody>
    ${t.atendentes.map((a) => `<tr>
      <td>${esc(a.nome)}</td><td>${a.conversas}</td><td>${fmtMin(a.medianaRespostaMin)}</td>
      <td>${a.vendas}</td><td>${a.aguardando}</td></tr>`).join('')}</tbody></table>`;

  const histBody = t.historico && t.historico.length > 1
    ? lineChart(t.historico.map((h) => ({ dia: (h.at || '').slice(5, 16).replace('T', ' '), abertos: h.abertos })), 'abertos', 'dia', 'var(--cold)')
    : '<p class="hint">O histórico do pipeline é acumulado a cada extração. Rode "Extrair" algumas vezes ao longo dos dias para ver a evolução.</p>';

  $('#grid').innerHTML = [
    card('Volume de conversas por dia', 'novas conversas iniciadas', barChart(t.volumePorDia, 'novas', 'dia')),
    card('Velocidade de 1ª resposta (mediana/dia)', 'tempo real entre a pergunta do cliente e a resposta do atendente', lineChart(t.respostaPorDia, 'medianaMin', 'dia')),
    card('Distribuição da 1ª resposta', 'quantas conversas em cada faixa de tempo — vermelho = lento', distBars),
    card('Funil / Situação', 'leads que entraram em negociação', sitBars),
    card('Volume por atendente', 'conversas atendidas', agBars + agTable),
    card('Pipeline ao longo do tempo', 'leads abertos por extração', histBody),
  ].join('');
}

async function load(refresh) {
  $('#overlay').hidden = false;
  try {
    const res = await fetch(refresh ? '/api/timeline/refresh' : '/api/timeline', { method: refresh ? 'POST' : 'GET' });
    const t = await res.json();
    if (!res.ok) throw new Error(t.error || 'Falha');
    render(t);
  } catch (e) {
    $('#meta').textContent = 'Erro: ' + e.message;
  } finally { $('#overlay').hidden = true; }
}

$('#btn-refresh').addEventListener('click', () => load(true));
load(false);
