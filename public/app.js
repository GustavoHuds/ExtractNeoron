import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
let DATA = { rows: [] };
let sortKey = null, sortDir = 1;
let filterSituacao = 'Aberto';
const tempOn = { quente: true, morno: true, frio: true };
const AUTO_MS = 15 * 60 * 1000;
let nextAuto = Date.now() + AUTO_MS;

const $ = (s) => document.querySelector(s);
const rowsEl = $('#rows');
const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));

function fmtWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function ago(ms) {
  if (!ms) return '';
  const h = (Date.now() - ms) / 36e5;
  if (h < 1) return `há ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `há ${h.toFixed(0)} h`;
  return `há ${Math.round(h / 24)} d`;
}
const TEMP_LABEL = { quente: 'Quente', morno: 'Morno', frio: 'Frio' };

function visibleRows() {
  const q = $('#search').value.trim().toLowerCase();
  const hideDone = $('#hide-done').checked;
  let rows = DATA.rows.slice();
  if (filterSituacao !== 'all') rows = rows.filter((r) => r.situacao === filterSituacao);
  rows = rows.filter((r) => tempOn[r.temperatura]);
  if (hideDone) rows = rows.filter((r) => !r.feito);
  if (q) rows = rows.filter((r) =>
    [r.nome, r.contato, r.telefone, r.produto, r.atendente, r.departamento, r.contexto, (r.tags || []).join(' ')]
      .join(' ').toLowerCase().includes(q));
  if (sortKey) {
    rows.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (typeof x === 'string') { x = x.toLowerCase(); y = (y || '').toLowerCase(); }
      if (x == null) x = -Infinity; if (y == null) y = -Infinity;
      return x < y ? -sortDir : x > y ? sortDir : 0;
    });
  }
  return rows;
}

function render() {
  const rows = visibleRows();
  $('#counter').textContent = `${rows.length} de ${DATA.rows.length}`;
  if (!rows.length) {
    rowsEl.innerHTML = `<tr class="empty"><td colspan="7">${DATA.generatedAt ? 'Nenhum lead neste filtro.' : 'Sem dados. Clique em Extrair.'}</td></tr>`;
    return;
  }
  rowsEl.innerHTML = rows.map((r) => {
    const temp = `<span class="temp-tag t-${r.temperatura}">${TEMP_LABEL[r.temperatura]}</span>`;
    const sit = `<span class="badge-sit s-${r.situacao.toLowerCase()}">${r.situacao}</span>`;
    const wait = r.aguardando ? `<span class="badge-wait" title="Cliente enviou a última mensagem e aguarda resposta">Aguardando${r.aguardandoMin != null ? ' ' + fmtDur(r.aguardandoMin) : ''}</span>` : '';
    const prodCls = r.produtoFonte === 'catálogo' ? 'prod cat' : 'prod';
    const preco = (typeof r.produtoPreco === 'number' && r.produtoPreco > 0)
      ? ` <span class="preco">R$ ${r.produtoPreco.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>` : '';
    const cod = r.produtoCodigo ? `<div class="sub-info">cód. ${esc(r.produtoCodigo)}${preco}</div>` : '';
    const prod = r.produto
      ? `<span class="${prodCls}"${r.produtoTrecho ? ` title="${esc(r.produtoTrecho)}"` : ''}>${esc(r.produto)}</span>${cod}`
      : '<span class="sub-info">—</span>';
    const tags = (r.tags || []).map((t) => `<span class="pill">${esc(t)}</span>`).join('');
    const motivos = (r.motivos || []);
    const motivoLine = motivos.length ? `<div class="motivo t-${r.temperatura}" title="Sinais detectados na conversa">${esc(motivos.slice(0, 3).join(' · '))}</div>` : '';
    return `<tr class="temp-${r.temperatura}${r.feito ? ' done' : ''}">
      <td class="nome">
        <div class="nm-line">${temp}<span class="nm">${esc(r.nome)}</span></div>
        <div class="badges">${sit}${wait}</div>
        ${motivoLine}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </td>
      <td class="phone-cell">
        <span class="phone">${esc(r.contato)}</span>
        <span class="phone-actions">
          <button class="icon-btn copy" data-copy="+${esc(r.telefone)}" title="Copiar número">${COPY_ICON}</button>
          <a class="icon-btn" href="https://wa.me/${esc(r.telefone)}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${WA_ICON}</a>
        </span>
      </td>
      <td>${prod}</td>
      <td>${esc(r.atendente)}</td>
      <td class="when"><div>${fmtWhen(r.ultimaInteracao)}</div><div class="sub-info">${ago(r.ultimaInteracaoMs)}</div></td>
      <td class="ctx">${esc(r.contexto)}</td>
      <td class="act">
        <button class="done-btn ${r.feito ? 'is-done' : ''}" data-id="${esc(r.conversationId)}">${r.feito ? 'Concluído' : 'Marcar concluído'}</button>
      </td>
    </tr>`;
  }).join('');
}

function fmtDur(min) {
  if (min == null) return '';
  if (min < 60) return `${min} min`;
  const h = min / 60;
  return h < 48 ? `${h.toFixed(1)} h` : `${Math.round(h / 24)} d`;
}

function paintStats() {
  const has = !!DATA.generatedAt;
  $('#stats').hidden = !has; $('#toolbar').hidden = !has;
  const s = DATA.situacao || {}, t = DATA.temperatura || {};
  $('#s-abertos').textContent = s.abertos ?? 0;
  $('#s-quentes').textContent = t.quentes ?? 0;
  $('#s-aguard').textContent = DATA.aguardando ?? 0;
  $('#s-vendidos').textContent = s.vendidos ?? 0;
  $('#s-when').textContent = fmtWhen(DATA.generatedAt);
  $('#meta').innerHTML = has
    ? `Conta <strong>${esc(DATA.account || '')}</strong> · ${DATA.count} em negociando · ${DATA.conversationsScanned} conversas varridas`
    : 'Clique em <strong>Extrair</strong> para carregar do Neoron.';
}

async function extract(auto = false) {
  const btn = $('#btn-extract');
  btn.disabled = true; $('#overlay-msg').textContent = auto ? 'Atualização automática…' : 'Extraindo do Neoron…';
  $('#overlay').hidden = false;
  try {
    const res = await authFetch('/api/extract', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha na extração');
    DATA = data; paintStats(); render();
  } catch (e) { toast('Erro: ' + e.message); }
  finally { btn.disabled = false; $('#overlay').hidden = true; nextAuto = Date.now() + AUTO_MS; }
}

async function loadCached() {
  try { DATA = await (await authFetch('/api/data')).json(); paintStats(); render(); } catch {}
}

async function toggleDone(id, btn) {
  const row = DATA.rows.find((r) => r.conversationId === id);
  const done = !(row && row.feito);
  btn.disabled = true;
  try {
    const res = await authFetch('/api/done', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, done }) });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    if (row) { row.feito = j.feito; row.feitoAt = j.at; }
    render();
  } catch (e) { toast('Erro: ' + e.message); }
  finally { btn.disabled = false; }
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}

// Clipboard that also works over plain HTTP on the LAN (no secure context).
function copyText(text) {
  const done = () => toast('Número copiado: ' + text);
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
  } else { fallbackCopy(text, done); }
}
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.focus(); ta.select();
  try { document.execCommand('copy'); done(); } catch { toast('Copie manualmente: ' + text); }
  ta.remove();
}

const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const WA_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.9-4.45 9.9-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.06c-.24.68-1.42 1.31-1.95 1.35-.5.04-.97.23-3.27-.68-2.76-1.09-4.5-3.9-4.64-4.08-.13-.18-1.11-1.48-1.11-2.82 0-1.34.7-2 .95-2.28.24-.27.53-.34.71-.34l.51.01c.16 0 .38-.06.6.46.24.56.79 1.94.86 2.08.07.14.12.3.02.48-.09.18-.14.3-.27.46-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.72 1.18 1.54 1.92 1.06.94 1.95 1.24 2.22 1.38.27.14.43.12.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.6-.14.24.09 1.55.73 1.81.86.27.14.45.2.51.32.07.11.07.66-.17 1.34z"/></svg>';

// ---- events ----
$('#btn-extract').addEventListener('click', () => extract(false));
$('#search').addEventListener('input', render);
$('#hide-done').addEventListener('change', render);

$('#seg-situacao').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  filterSituacao = b.dataset.v;
  [...e.currentTarget.children].forEach((x) => x.classList.toggle('active', x === b));
  render();
});
$('#chips-temp').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  tempOn[b.dataset.t] = !tempOn[b.dataset.t];
  b.classList.toggle('active', tempOn[b.dataset.t]);
  render();
});
document.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
  render();
}));
rowsEl.addEventListener('click', (e) => {
  const copy = e.target.closest('.copy');
  if (copy) { copyText(copy.dataset.copy); return; }
  const done = e.target.closest('.done-btn');
  if (done) toggleDone(done.dataset.id, done);
});

// export menu
$('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); $('#export-menu').hidden = !$('#export-menu').hidden; });
document.addEventListener('click', () => { $('#export-menu').hidden = true; });

// ---- catalog import ----
async function refreshCatalogBadge() {
  try {
    const s = await (await authFetch('/api/catalog')).json();
    const btn = $('#btn-catalog');
    if (btn) {
      btn.textContent = s.loaded ? `Catálogo · ${s.count}` : 'Catálogo';
      btn.title = s.loaded
        ? `${s.count} produtos carregados. Clique para substituir o catálogo (.json).`
        : 'Nenhum catálogo. Importe um .json para casar produtos por SKU.';
    }
  } catch {}
}
$('#btn-catalog').addEventListener('click', () => $('#catalog-file').click());
$('#catalog-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();   // CSV or JSON — server detects and parses
    const res = await authFetch('/api/catalog', {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Falha ao importar catálogo.');
    await refreshCatalogBadge();
    toast(`Catálogo importado: ${j.count} produtos (${file.name}). Extraia novamente para casar por SKU.`);
  } catch (ex) {
    toast('Erro no catálogo: ' + (ex.message || ex));
  }
});

// auto-refresh every 15 min + countdown
setInterval(() => {
  const left = nextAuto - Date.now();
  if (left <= 0 && DATA.generatedAt) { extract(true); return; }
  const m = Math.max(0, Math.floor(left / 60000)), s = Math.max(0, Math.floor((left % 60000) / 1000));
  $('#auto').textContent = `Atualiza em ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}, 1000);

// ---- auth gate + header ----
function paintUser() {
  const email = currentUser() || '';
  $('#user-name').textContent = email || '—';
  $('#user-initial').textContent = (email[0] || '·').toUpperCase();
}
function showLogin(show) { $('#login').hidden = !show; }

// After a successful login (fresh or auto): show the last snapshot instantly,
// then automatically analyse fresh data from Neoron.
async function afterAuth() {
  showLogin(false);
  paintUser();
  refreshCatalogBadge(); // reflect whether a catalog is loaded
  await loadCached();    // instant: last saved snapshot, if any
  extract(false);        // auto-analyse (fetches + filters "negociando" from Neoron)
}

async function boot() {
  try {
    await refresh();          // auto-login with stored refresh token
    await afterAuth();
  } catch {
    showLogin(true);
  }
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'), err = $('#login-err');
  btn.disabled = true; err.hidden = true;
  try {
    await login($('#login-email').value.trim(), $('#login-pass').value);
    await afterAuth();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  finally { btn.disabled = false; }
});

$('#user-chip').addEventListener('click', (e) => { e.stopPropagation(); $('#user-menu').hidden = !$('#user-menu').hidden; });
$('#btn-logout').addEventListener('click', (e) => { e.preventDefault(); clearAuth(); location.reload(); });
document.addEventListener('click', () => { $('#user-menu').hidden = true; });

// authenticated downloads (blob via Bearer)
$('#export-menu').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-dl]'); if (!a) return;
  e.preventDefault();
  const url = a.dataset.dl === 'xlsx' ? '/api/download.xlsx' : '/api/download';
  const res = await authFetch(url);
  if (!res.ok) { toast('Nada para exportar ainda.'); return; }
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = a.dataset.dl === 'xlsx' ? 'negociando.xlsx' : 'negociando.csv';
  link.click(); URL.revokeObjectURL(link.href);
});

boot();
