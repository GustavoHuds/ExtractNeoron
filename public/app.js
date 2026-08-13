import { login, refresh, clearAuth, currentUser, authFetch } from './auth.js';
let DATA = { rows: [] };
let sortKey = null, sortDir = 1;
let filterSituacao = 'Aberto';
let onlyCall24h = true; // call queue: show only clients waiting for a reply for 24h+
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
// Preset outcomes for the "Finalizar" popup (mirrors REASON_LABELS in extractor.js).
const REASON_LABEL = { vendido: 'Vendido', sem_retorno: 'Sem retorno', sem_interesse: 'Sem interesse', concorrente: 'Comprou concorrente', outro: 'Outro' };
const reasonLabelJS = (slug) => REASON_LABEL[slug] || (slug || '');

// Effective wait for the default queue order. A lead that went unanswered ONCE
// re-sinks (clock restarts at naoAtendeuAt) and climbs back up over time.
function effWaitMin(r) {
  if (r.naoAtendeuCount === 1 && r.naoAtendeuAt) return (Date.now() - Date.parse(r.naoAtendeuAt)) / 60000;
  return r.aguardandoMin || 0;
}

function visibleRows() {
  const q = $('#search').value.trim().toLowerCase();
  const hideDone = $('#hide-done').checked;
  let rows = DATA.rows.slice();
  const bucket = filterSituacao === 'naoAtendeu';
  if (bucket) {
    rows = rows.filter((r) => r.noAnswerBucket);            // the "Não atendeu" filter
  } else {
    rows = rows.filter((r) => !r.noAnswerBucket);           // bucket leads live only in their filter
    if (filterSituacao !== 'all') rows = rows.filter((r) => r.situacao === filterSituacao);
    if (onlyCall24h) rows = rows.filter((r) => r.paraLigar);
  }
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
  } else {
    rows.sort((a, b) => effWaitMin(b) - effWaitMin(a));      // default: longest effective wait on top
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
    const waitU = r.aguardandoMin == null ? '' : r.aguardandoMin >= 72 * 60 ? ' u3' : r.aguardandoMin >= 48 * 60 ? ' u2' : r.aguardandoMin >= 24 * 60 ? ' u1' : '';
    const wait = r.aguardando ? `<span class="badge-wait${waitU}" title="Cliente enviou a última mensagem e aguarda resposta">Aguardando${r.aguardandoMin != null ? ' ' + fmtDur(r.aguardandoMin) : ''}</span>` : '';
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
    const waText = r.noAnswerBucket ? '?text=' + encodeURIComponent(noAnswerMsg(r.nome)) : '';
    const naTag = r.naoAtendeuCount ? `<span class="badge-na" title="Ligações sem resposta">Não atendeu · ${r.naoAtendeuCount}</span>` : '';
    const doneChip = r.feito ? `<span class="badge-done"${r.feitoNota ? ` title="${esc(r.feitoNota)}"` : ''}>✓ ${esc(reasonLabelJS(r.feitoReason) || 'Concluído')}</span>` : '';
    return `<tr class="temp-${r.temperatura}${r.feito ? ' done' : ''}">
      <td class="nome">
        <div class="nm-line">${temp}<span class="nm">${esc(r.nome)}</span></div>
        <div class="badges">${sit}${wait}${naTag}${doneChip}</div>
        ${motivoLine}
        ${tags ? `<div class="tags">${tags}</div>` : ''}
      </td>
      <td class="phone-cell" data-label="Telefone">
        <span class="phone">${esc(r.contato)}</span>
        <span class="phone-actions">
          <button class="icon-btn copy" data-copy="+${esc(r.telefone)}" title="Copiar número">${COPY_ICON}</button>
          <a class="icon-btn" href="https://wa.me/${esc(r.telefone)}${waText}" target="_blank" rel="noopener" title="Abrir no WhatsApp">${WA_ICON}</a>
        </span>
      </td>
      <td data-label="Produto">${prod}</td>
      <td data-label="Atendente">${esc(r.atendente)}</td>
      <td class="when" data-label="Última mensagem"><div>${fmtWhen(r.ultimaInteracao)}</div><div class="sub-info">${ago(r.ultimaInteracaoMs)}</div></td>
      <td class="ctx" data-label="Contexto">${esc(r.contexto)}</td>
      <td class="act" data-label="Ação">${actionsHtml(r)}</td>
    </tr>`;
  }).join('');
}

const EYE_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';

// Ready WhatsApp message for leads that never answered the phone. {first name} filled in.
function firstName(n) {
  const f = String(n || '').trim().split(/\s+/)[0];
  return (f && !/^[+\d]/.test(f)) ? f : '';
}
function noAnswerMsg(nome) {
  const fn = firstName(nome);
  return `${fn ? 'Olá ' + fn : 'Olá'}, tudo bem? Aqui é da Belmont. Tentei falar com você por telefone sobre o seu atendimento e não consegui. Fico à disposição por aqui quando puder!`;
}

// Per-lead actions: view the conversation + one "Finalizar" button that opens the
// outcome popup (conclude with a reason, register "não atendeu", reopen, etc).
function actionsHtml(r) {
  const id = esc(r.conversationId);
  const eye = `<button class="icon-btn eye-btn" data-id="${id}" data-bot="${esc(r.botId)}" title="Ver conversa">${EYE_ICON}</button>`;
  const fin = r.feito
    ? `<button class="fin-btn is-done" data-id="${id}" title="Concluído — clique para ver, alterar ou reabrir">✓ Concluído</button>`
    : `<button class="fin-btn" data-id="${id}">Finalizar</button>`;
  return `<div class="act-row">${eye}${fin}</div>`;
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
  $('#s-call24').textContent = DATA.aguardando24h ?? 0;
  $('#s-naoatendeu').textContent = DATA.naoAtendeu ?? 0;
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

async function postJSON(url, body) {
  const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || 'Falha');
  return j;
}

// ---- "Finalizar" outcome popup ----
let finId = null, finChoice = null, finKind = null;

function finOptBtn(choice, kind, label, dot) {
  return `<button type="button" class="fin-opt" data-choice="${choice}" data-kind="${kind}"><span class="fin-dot d-${dot}"></span><span class="fin-opt-label">${label}</span></button>`;
}
function finOptionsHtml(r) {
  const conclude = [
    ['vendido', 'Vendido', 'sold'],
    ['sem_retorno', 'Sem retorno', 'cold'],
    ['sem_interesse', 'Sem interesse', 'warm'],
    ['concorrente', 'Comprou concorrente', 'hot'],
    ['outro', 'Outro', 'muted'],
  ].map(([c, l, d]) => finOptBtn(c, 'done', l, d)).join('');
  let call = finOptBtn('na', 'na', 'Não atendeu a ligação', 'accent');
  if (r.noAnswerBucket) call += finOptBtn('reset', 'reset', 'Voltar à fila de ligação', 'muted');
  const reopen = r.feito ? finOptBtn('reopen', 'reopen', 'Reabrir lead', 'muted') : '';
  return `<div class="fin-group"><span class="fin-group-label">Concluir o lead</span>${conclude}</div>
    <div class="fin-group"><span class="fin-group-label">Ligação</span>${call}</div>
    ${reopen ? `<div class="fin-group">${reopen}</div>` : ''}`;
}

function openFinalize(id) {
  const r = DATA.rows.find((x) => x.conversationId === id);
  if (!r) return;
  finId = id; finChoice = null; finKind = null;
  $('#fin-title').textContent = `Finalizar — ${r.nome}`;
  $('#fin-sub').textContent = r.contato || '';
  const cur = $('#fin-current');
  if (r.feito) {
    cur.hidden = false;
    cur.innerHTML = `Concluído como <strong>${esc(reasonLabelJS(r.feitoReason) || '—')}</strong>${r.feitoPor ? ` · ${esc(r.feitoPor)}` : ''}${r.feitoNota ? `<div class="fin-current-note">“${esc(r.feitoNota)}”</div>` : ''}`;
  } else { cur.hidden = true; cur.innerHTML = ''; }
  $('#fin-options').innerHTML = finOptionsHtml(r);
  $('#fin-note').value = r.feito ? (r.feitoNota || '') : '';
  updateFinConfirm();
  $('#finalize-modal').hidden = false;
}
function closeFinalize() { $('#finalize-modal').hidden = true; finId = null; finChoice = null; finKind = null; }

function updateFinConfirm() {
  const btn = $('#fin-confirm'), hint = $('#fin-note-hint');
  const note = $('#fin-note').value.trim();
  let label = 'Concluir lead', ok = false, needNote = false;
  if (finKind === 'done') { needNote = finChoice === 'outro'; ok = !needNote || !!note; }
  else if (finKind === 'na') { label = 'Registrar não atendeu'; ok = true; }
  else if (finKind === 'reset') { label = 'Voltar à fila'; ok = true; }
  else if (finKind === 'reopen') { label = 'Reabrir lead'; ok = true; }
  btn.textContent = label;
  btn.disabled = !ok;
  hint.textContent = needNote ? '(obrigatório)' : '(opcional)';
}

async function finalizeSubmit() {
  if (!finId || !finKind) return;
  const id = finId, kind = finKind, choice = finChoice, note = $('#fin-note').value.trim();
  const row = DATA.rows.find((r) => r.conversationId === id);
  $('#fin-confirm').disabled = true;
  try {
    if (kind === 'done') {
      const j = await postJSON('/api/done', { id, done: true, reason: choice, note });
      if (row) { row.feito = true; row.feitoAt = j.at; row.feitoReason = j.reason || choice; row.feitoNota = j.note || note; row.feitoPor = currentUser() || ''; }
      toast(`Lead concluído: ${reasonLabelJS(choice)}.`);
    } else if (kind === 'reopen') {
      await postJSON('/api/done', { id, done: false });
      if (row) { row.feito = false; row.feitoAt = null; row.feitoReason = ''; row.feitoNota = ''; row.feitoPor = ''; }
      toast('Lead reaberto.');
    } else if (kind === 'na') {
      const j = await postJSON('/api/noanswer', { id, reset: false, note });
      if (row) { row.naoAtendeuCount = j.count; row.naoAtendeuAt = j.at; row.naoAtendeuNota = j.note || note; row.noAnswerBucket = j.count >= 2; }
      DATA.naoAtendeu = DATA.rows.filter((r) => r.noAnswerBucket).length;
      toast(j.count >= 2 ? 'Movido para "Não atendeu".' : 'Registrado. Voltou pro fim da fila.');
    } else if (kind === 'reset') {
      const j = await postJSON('/api/noanswer', { id, reset: true });
      if (row) { row.naoAtendeuCount = j.count || 0; row.naoAtendeuAt = j.at; row.noAnswerBucket = false; }
      DATA.naoAtendeu = DATA.rows.filter((r) => r.noAnswerBucket).length;
      toast('Voltou para a fila.');
    }
    closeFinalize();
    paintStats(); render();
  } catch (e) { toast('Erro: ' + (e.message || e)); updateFinConfirm(); }
}

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4000);
}

// Clipboard that also works over plain HTTP on the LAN (no secure context).
function copyText(text, label) {
  const done = () => toast(label || ('Número copiado: ' + text));
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
$('#only-24h').addEventListener('change', (e) => { onlyCall24h = e.target.checked; render(); });

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
  const eye = e.target.closest('.eye-btn');
  if (eye) { const r = DATA.rows.find((x) => x.conversationId === eye.dataset.id); openChat(eye.dataset.id, eye.dataset.bot, r || {}); return; }
  const fin = e.target.closest('.fin-btn');
  if (fin) { openFinalize(fin.dataset.id); }
});

// Finalize popup interactions
$('#fin-options').addEventListener('click', (e) => {
  const b = e.target.closest('.fin-opt'); if (!b) return;
  finChoice = b.dataset.choice; finKind = b.dataset.kind;
  [...$('#fin-options').querySelectorAll('.fin-opt')].forEach((x) => x.classList.toggle('selected', x === b));
  updateFinConfirm();
});
$('#fin-note').addEventListener('input', updateFinConfirm);
$('#fin-confirm').addEventListener('click', finalizeSubmit);
$('#fin-close').addEventListener('click', closeFinalize);
$('#fin-cancel').addEventListener('click', closeFinalize);
$('#finalize-modal').addEventListener('click', (e) => { if (e.target.id === 'finalize-modal') closeFinalize(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#finalize-modal').hidden) closeFinalize(); });

// ---- chat transcript popup ----
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function closeChat() { $('#chat-modal').hidden = true; $('#chat-body').innerHTML = ''; }
async function openChat(convId, botId, meta) {
  $('#chat-title').textContent = meta.nome || 'Conversa';
  $('#chat-sub').textContent = meta.contato || '';
  const link = $('#chat-open-direct'); if (link) link.href = meta.chatUrl || '#';
  const body = $('#chat-body');
  body.innerHTML = '<div class="chat-state"><div class="spinner"></div></div>';
  $('#chat-modal').hidden = false;
  try {
    const res = await authFetch(`/api/messages/${encodeURIComponent(botId)}/${encodeURIComponent(convId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha');
    const msgs = data.messages || [];
    if (!msgs.length) { body.innerHTML = '<div class="chat-state">Sem mensagens.</div>'; return; }
    body.innerHTML = msgs.map((m) => {
      const cls = m.sender === 'user' ? 'msg-user' : m.sender === 'agent' ? 'msg-agent' : 'msg-bot';
      const media = /^\[(imagem|áudio|vídeo|arquivo|mídia)\]$/.test(m.text);
      const author = m.author ? `<span class="msg-author">${esc(m.author)}</span>` : '';
      return `<div class="msg ${cls}">${author}<div class="msg-text${media ? ' msg-media' : ''}">${esc(m.text)}</div><span class="msg-time">${esc(fmtTime(m.ts))}</span></div>`;
    }).join('');
    body.scrollTop = body.scrollHeight; // start at the latest message
  } catch { toast('Falha ao carregar a conversa.'); closeChat(); }
}
$('#chat-close').addEventListener('click', closeChat);
$('#chat-modal').addEventListener('click', (e) => { if (e.target.id === 'chat-modal') closeChat(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#chat-modal').hidden) closeChat(); });

// "Mais" menu (export + catalog)
$('#btn-more').addEventListener('click', (e) => { e.stopPropagation(); $('#export-menu').hidden = !$('#export-menu').hidden; });
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
$('#btn-catalog').addEventListener('click', (e) => { e.preventDefault(); $('#catalog-file').click(); });
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

// authenticated downloads (blob via Bearer) — export mirrors the current list filter
$('#export-menu').addEventListener('click', async (e) => {
  const a = e.target.closest('[data-dl]'); if (!a) return;
  e.preventDefault();
  const url = a.dataset.dl === 'xlsx' ? '/api/download.xlsx' : '/api/download';
  const ids = visibleRows().map((r) => r.conversationId);
  if (!ids.length) { toast('Nada para exportar neste filtro.'); return; }
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) { toast('Nada para exportar ainda.'); return; }
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = a.dataset.dl === 'xlsx' ? 'negociando.xlsx' : 'negociando.csv';
  link.click(); URL.revokeObjectURL(link.href);
});

boot();
