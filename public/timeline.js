import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
import { barChart, lineChart, hbars } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${m} min` : m < 2880 ? `${(m / 60).toFixed(1)} h` : `${Math.round(m / 1440)} d`;
const shortDay = (d) => String(d).slice(5); // MM-DD

function card(title, hint, body, wide = false) {
  return `<div class="card${wide ? ' card-wide' : ''}"><h3>${esc(title)}</h3>${hint ? `<p class="hint">${esc(hint)}</p>` : ''}${body}</div>`;
}

function render(t) {
  $('#meta').innerHTML = `Conta <strong>${esc(t.account || '')}</strong> · ${t.totalConversas} conversas · atualizado ${new Date(t.generatedAt).toLocaleString('pt-BR')}`;

  $('#kpis').innerHTML = [
    ['1ª resposta (mediana)', fmtMin(t.velocidade.primeiraRespostaMedianaMin), 'cliente → atendente'],
    ['1ª resposta (média)', fmtMin(t.velocidade.primeiraRespostaMediaMin), 'inflada por respostas noturnas'],
    ['Conversão', `${t.conversao.taxa}%`, `${t.conversao.vendidos}/${t.conversao.entraram} em negociação`],
    ['Aguardando', String(t.atendentes.reduce((a, x) => a + x.aguardando, 0)), 'clientes sem resposta agora'],
    ['Amostra', String(t.respostaAmostras), 'conversas (45 dias)'],
  ].map(([k, v, s]) => `<div class="kpi"><small>${esc(k)}</small><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

  const volume = barChart(t.volumePorDia.map((d) => ({ label: shortDay(d.dia), value: d.novas })), { color: 'var(--accent)' });
  const speed = lineChart(t.respostaPorDia.map((d) => ({ label: shortDay(d.dia), value: d.medianaMin })), { color: 'var(--warm)', fmt: (v) => `${v}m` });
  const dist = hbars(t.velocidade.distribuicao.map((d) => ({
    label: d.faixa, value: d.n, color: /4 h|> 4/.test(d.faixa) ? 'var(--hot)' : 'var(--accent)',
  })));
  const funnel = hbars([
    { label: 'Aberto', value: t.situacao.Aberto, color: 'var(--cold)' },
    { label: 'Vendido', value: t.situacao.Vendido, color: 'var(--sold)' },
    { label: 'Descartado', value: t.situacao.Descartado, color: 'var(--hot)' },
  ]);

  const agChart = barChart(t.volumePorAtendente.map((a) => ({ label: a.nome, value: a.conversas })), { color: 'var(--accent)' });
  const agTable = `<div class="tbl-wrap"><table class="metrics-tbl"><thead><tr>
    <th>Atendente</th><th>Chats no mês</th><th>Chats (45d)</th><th>1ª resp. mediana</th>
    <th>1ª resp. média</th><th>Vendas</th><th>Conversão</th><th>Aguardando</th></tr></thead><tbody>
    ${t.atendentes.map((a) => `<tr>
      <td class="ag-name">${esc(a.nome)}</td>
      <td>${a.chatsMes}</td><td>${a.conversas}</td>
      <td class="${a.primeiraRespostaMedianaMin && a.primeiraRespostaMedianaMin >= 240 ? 'slow' : ''}">${fmtMin(a.primeiraRespostaMedianaMin)}</td>
      <td>${fmtMin(a.primeiraRespostaMediaMin)}</td>
      <td>${a.vendas}</td><td>${a.taxaConversao}%</td><td>${a.aguardando}</td></tr>`).join('')}
    </tbody></table></div>`;

  const hist = (t.historico && t.historico.length > 1)
    ? lineChart(t.historico.map((h) => ({ label: (h.at || '').slice(5, 10), value: h.abertos })), { color: 'var(--cold)' })
    : '<p class="hint">O histórico do pipeline é acumulado a cada extração. Rode "Extrair" ao longo dos dias para ver a evolução.</p>';

  $('#grid').innerHTML = [
    card('Volume de conversas por dia', 'novas conversas iniciadas', volume, true),
    card('Velocidade de 1ª resposta (mediana/dia)', 'tempo real entre a pergunta do cliente e a resposta', speed, true),
    card('Distribuição da 1ª resposta', 'vermelho = lento (> 4 h)', dist),
    card('Funil / Situação', 'leads que entraram em negociação', funnel),
    card('Volume por atendente', 'chats no mês, velocidade de 1ª resposta, vendas e conversão', agChart + agTable, true),
    card('Pipeline ao longo do tempo', 'leads abertos por extração', hist, true),
  ].join('');
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
