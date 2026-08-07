import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
import { barChart, lineChart, multiLineChart, hbars } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`;
const shortDay = (d) => String(d).slice(5); // MM-DD

const STATUS_PT = {
  CHATBOT: 'Bot', TAKEOVER_QUEUE: 'Na fila', TAKEOVER_ATTEMPT: 'Tentando atender',
  TAKEOVER_IN_ATTENDANCE: 'Em atendimento', TAKEOVER_FINISHED: 'Finalizado', FINISHED: 'Finalizado',
};

function card(title, hint, body, wide = false) {
  return `<div class="card${wide ? ' card-wide' : ''}"><h3>${esc(title)}</h3>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${body}</div>`;
}
function section(title, cardsHtml) {
  return `<h2 class="section-title">${esc(title)}</h2><div class="tl-grid">${cardsHtml}</div>`;
}

function render(t) {
  const ag = t.atendentes || [];
  const sumAguardando = ag.reduce((a, x) => a + x.aguardando, 0);
  $('#meta').innerHTML = `Conta <strong>${esc(t.account || '')}</strong> · ${t.totalConversas} conversas · atualizado ${new Date(t.generatedAt).toLocaleString('pt-BR')}`;

  // ---- KPI strip ----
  $('#kpis').innerHTML = [
    ['Conversas', String(t.totalConversas), 'contatos no período'],
    ['Conversão', `${t.conversao.taxa}%`, `${t.conversao.vendidos} vendas de ${t.conversao.entraram} contatos`],
    ['Vendas', String(t.conversao.vendidos), 'tag "venda realizada"'],
    ['Em negociação', String(t.conversao.negociando), 'abertos + vendidos + descartados'],
    ['1ª resposta (mediana)', fmtMin(t.velocidade.primeiraRespostaMedianaMin), 'cliente → atendente'],
    ['1ª resposta (média)', fmtMin(t.velocidade.primeiraRespostaMediaMin), 'inflada por respostas noturnas'],
    ['Aguardando agora', String(sumAguardando), 'clientes sem resposta'],
    ['Atendentes', String(ag.length), 'ativos na amostra (45d)'],
  ].map(([k, v, s]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

  // ---- Comparativo entre atendentes ----
  const cmpConversas = hbars(ag.map((a) => ({ label: a.nome, value: a.conversas })));
  const cmpVendas = hbars(ag.map((a) => ({ label: a.nome, value: a.vendas, color: 'var(--sold)' })));
  const cmpConv = hbars(ag.map((a) => ({ label: a.nome, value: a.taxaConversao, color: 'var(--accent)' })), { fmt: (v) => `${v}%` });
  const cmpResp = hbars(ag.filter((a) => a.primeiraRespostaMedianaMin != null)
    .map((a) => ({ label: a.nome, value: a.primeiraRespostaMedianaMin, color: 'var(--warm)' })), { fmt: fmtMin });
  const cmpAguard = hbars(ag.map((a) => ({ label: a.nome, value: a.aguardando, color: 'var(--hot)' })));

  const agTable = `<div class="tbl-wrap"><table class="metrics-tbl"><thead><tr>
    <th>Atendente</th><th>Conversas</th><th>% vol.</th><th>Chats mês</th><th>Abertos</th>
    <th>Vendas</th><th>Descart.</th><th>Conversão</th><th>1ª resp. mediana</th><th>1ª resp. média</th><th>Aguardando</th>
    </tr></thead><tbody>
    ${ag.map((a) => `<tr>
      <td class="ag-name">${esc(a.nome)}</td>
      <td>${a.conversas}</td><td>${a.pctVolume}%</td><td>${a.chatsMes}</td><td>${a.abertos}</td>
      <td>${a.vendas}</td><td>${a.descartados}</td><td>${a.taxaConversao}%</td>
      <td class="${a.primeiraRespostaMedianaMin && a.primeiraRespostaMedianaMin >= 240 ? 'slow' : ''}">${fmtMin(a.primeiraRespostaMedianaMin)}</td>
      <td>${fmtMin(a.primeiraRespostaMediaMin)}</td><td>${a.aguardando}</td></tr>`).join('')}
    </tbody></table></div>`;

  // ---- Velocidade ----
  const speed = lineChart(t.respostaPorDia.map((d) => ({ label: shortDay(d.dia), value: d.medianaMin })), { color: 'var(--warm)', fmt: (v) => `${v}m` });
  const dist = hbars(t.velocidade.distribuicao.map((d) => ({
    label: d.faixa, value: d.n, color: /4 h|> 4/.test(d.faixa) ? 'var(--hot)' : 'var(--accent)',
  })));

  // ---- Volume & funil ----
  const volume = barChart(t.volumePorDia.map((d) => ({ label: shortDay(d.dia), value: d.novas })), { color: 'var(--accent)' });
  const funnel = hbars([
    { label: 'Aberto', value: t.situacao.Aberto, color: 'var(--cold)' },
    { label: 'Vendido', value: t.situacao.Vendido, color: 'var(--sold)' },
    { label: 'Descartado', value: t.situacao.Descartado, color: 'var(--hot)' },
  ]);
  const statusBars = hbars((t.statusDist || []).map((s) => ({ label: STATUS_PT[s.status] || s.status, value: s.n })));

  // ---- Pipeline over time ----
  const H = t.historico || [];
  const xlab = (h) => (h.at || '').slice(5, 10);
  const pipeline = H.length > 1
    ? multiLineChart([
        { label: 'Abertos', color: 'var(--cold)', points: H.map((h) => ({ label: xlab(h), value: h.abertos })) },
        { label: 'Vendidos', color: 'var(--sold)', points: H.map((h) => ({ label: xlab(h), value: h.vendidos })) },
        { label: 'Descartados', color: 'var(--hot)', points: H.map((h) => ({ label: xlab(h), value: h.descartados })) },
        { label: 'Aguardando', color: 'var(--warm)', points: H.map((h) => ({ label: xlab(h), value: h.aguardando })) },
      ])
    : '<p class="hint">O histórico do pipeline é acumulado a cada extração. Rode "Extrair" ao longo dos dias para ver a evolução.</p>';

  $('#grid').innerHTML =
    section('Comparativo entre atendentes',
      card('Ranking completo', 'todas as métricas por atendente — o vermelho na 1ª resposta indica > 4 h', agTable, true) +
      card('Conversas por atendente', 'volume total atendido', cmpConversas) +
      card('Vendas por atendente', 'negócios fechados (tag venda realizada)', cmpVendas) +
      card('Conversão por atendente', 'vendas ÷ conversas atendidas', cmpConv) +
      card('1ª resposta por atendente', 'mediana — menor é melhor', cmpResp) +
      card('Aguardando por atendente', 'clientes sem resposta agora', cmpAguard)) +
    section('Velocidade de resposta',
      card('Velocidade de 1ª resposta (mediana/dia)', 'tempo real entre a pergunta do cliente e a resposta', speed, true) +
      card('Distribuição da 1ª resposta', 'quantas conversas em cada faixa — vermelho = lento (> 4 h)', dist)) +
    section('Volume & funil',
      card('Volume de conversas por dia', 'novas conversas iniciadas', volume, true) +
      card('Funil / Situação', 'leads que entraram em negociação', funnel) +
      card('Status no sistema', 'em que etapa as conversas estão agora', statusBars)) +
    section('Pipeline ao longo do tempo',
      card('Evolução do pipeline', 'abertos · vendidos · descartados · aguardando por extração', pipeline, true));
}

async function load(refreshData) {
  $('#overlay').hidden = false;
  try {
    const res = await authFetch(refreshData ? '/api/timeline/refresh' : '/api/timeline', { method: refreshData ? 'POST' : 'GET' });
    const t = await res.json();
    if (!res.ok) throw new Error(t.error || 'Falha');
    render(t);
  } catch (e) { $('#meta').textContent = 'Erro: ' + e.message; }
  finally { $('#overlay').hidden = true; }
}

// ---- auth gate + header ----
function paintUser() {
  const email = currentUser() || '';
  $('#user-name').textContent = email || '—';
  $('#user-initial').textContent = (email[0] || '·').toUpperCase();
}
async function boot() {
  try { await refresh(); $('#login').hidden = true; paintUser(); load(false); }
  catch { $('#login').hidden = false; }
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-err');
  btn.disabled = true; err.hidden = true;
  try { await login($('#login-email').value.trim(), $('#login-pass').value); $('#login').hidden = true; paintUser(); load(false); }
  catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; }
});
$('#user-chip').addEventListener('click', (e) => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
$('#btn-logout').addEventListener('click', (e) => { e.preventDefault(); clearAuth(); location.reload(); });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });
$('#btn-refresh').addEventListener('click', () => load(true));

boot();
