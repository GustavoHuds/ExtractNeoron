/** ExtractNeoron v2 — pipeline + call queue + shell. All rendering is
 * text-escaped; nothing from Neoron ever reaches the DOM as HTML. */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = {
    data: null,          // last extraction result
    view: 'pipeline',
    etapa: null,         // funnel stage filter (null = all open)
    finalizados: false,  // "Finalizados" chip
    temps: new Set(['quente', 'morno', 'frio']),
    only24: false,
    canal: '',
    atendente: '',
    sort: 'urgencia',
    q: '',
    page: 1,
    pageSize: 50,
    doneLead: null,      // lead in the Finalizar modal
    doneReason: null,
  };

  // ---------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const tok = await window.NeoronAuth.token();
    if (!tok) { showLogin(); throw new Error('signed out'); }
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, ...(opts.headers || {}) },
    });
    if (res.status === 401) { window.NeoronAuth.signOut(); showLogin(); throw new Error('expired'); }
    return res;
  }

  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hidden'), ms);
  }

  // ---------------------------------------------------------------- login
  function showLogin() {
    $('#app').classList.add('hidden');
    $('#login').classList.remove('hidden');
  }

  async function showApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    const s = window.NeoronAuth.session();
    const email = s?.email || '';
    $('#user-name').textContent = email.split('@')[0];
    $('#user-initial').textContent = (email[0] || '?').toUpperCase();
    await loadData();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn'), err = $('#login-error');
    btn.disabled = true; btn.textContent = 'Entrando…'; err.classList.add('hidden');
    try {
      await window.NeoronAuth.signIn($('#login-email').value.trim(), $('#login-pass').value);
      $('#login-pass').value = '';
      await showApp();
    } catch (ex) {
      err.textContent = ex.message || 'Falha no login.';
      err.classList.remove('hidden');
    } finally {
      btn.disabled = false; btn.textContent = 'Entrar';
    }
  });

  $('#btn-logout').addEventListener('click', () => { window.NeoronAuth.signOut(); showLogin(); });

  // ---------------------------------------------------------------- data
  async function loadData() {
    try {
      const res = await api('/api/data');
      S.data = await res.json();
      render();
      if (!S.data.rows?.length) extract(); // first run: pull automatically
    } catch { /* login shown */ }
  }

  async function extract() {
    const btn = $('#btn-extract');
    btn.disabled = true; btn.textContent = '↻ Extraindo…';
    try {
      const res = await api('/api/extract', { method: 'POST', body: '{}' });
      if (!res.ok) throw new Error((await res.json()).error || 'Falha.');
      S.data = await res.json();
      render();
      toast(`Base atualizada: ${S.data.conversationsScanned} conversas (${S.data.chatsFetched} novas/alteradas).`);
    } catch (ex) {
      toast(ex.message || 'Falha na extração.');
    } finally {
      btn.disabled = false; btn.textContent = '↻ Atualizar dados';
    }
  }
  $('#btn-extract').addEventListener('click', extract);

  // ---------------------------------------------------------------- filters
  function openRows() {
    return (S.data?.rows || []).filter((r) => r.temUsuario);
  }

  function visibleRows() {
    let rows = openRows();
    rows = S.finalizados
      ? rows.filter((r) => r.feito || r.situacao !== 'Aberto')
      : rows.filter((r) => r.situacao === 'Aberto' && !r.feito);
    if (!S.finalizados && S.etapa) rows = rows.filter((r) => r.etapa === S.etapa);
    if (!S.finalizados) rows = rows.filter((r) => S.temps.has(r.temperatura));
    if (S.only24) rows = rows.filter((r) => r.paraLigar);
    if (S.canal) rows = rows.filter((r) => r.canal === S.canal);
    if (S.atendente) rows = rows.filter((r) => r.atendente === S.atendente);
    const q = S.q.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => [
        r.nome, r.contato, r.telefone, r.instagram, r.produto, r.atendente,
        r.departamento, r.contexto, (r.tags || []).map((t) => t.name).join(' '),
      ].join(' ').toLowerCase().includes(q));
    }
    const sorters = {
      urgencia: null, // extraction order is already urgency
      recente: (a, b) => (b.ultimaInteracaoMs || 0) - (a.ultimaInteracaoMs || 0),
      nome: (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'),
      preco: (a, b) => (b.produtoPreco || 0) - (a.produtoPreco || 0),
    };
    if (sorters[S.sort]) rows = [...rows].sort(sorters[S.sort]);
    return rows;
  }

  // ---------------------------------------------------------------- format
  const fmtAgo = (ms) => {
    if (!ms) return '';
    const h = (Date.now() - ms) / 36e5;
    if (h < 1) return `há ${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `há ${Math.round(h)} h`;
    return `há ${Math.round(h / 24)} dias`;
  };
  const fmtWait = (min) => {
    if (min == null) return '';
    if (min < 60) return `${min} min`;
    if (min < 48 * 60) return `${Math.round(min / 60)} h`;
    return `${Math.round(min / 1440)} d`;
  };
  const fmtBRL = (v) => v == null ? '' : 'R$ ' + Number(v).toLocaleString('pt-BR');
  const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;

  // ---------------------------------------------------------------- render
  function render() {
    if (!S.data) return;
    $('#updated-at').textContent = S.data.generatedAt
      ? `Atualizado ${new Date(S.data.generatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '';
    if (S.view === 'pipeline') renderPipeline();
    else if (S.view === 'fila') renderFila();
    else if (S.view === 'metricas') window.Metricas.render(api);
  }

  function renderPipeline() {
    const d = S.data;
    const sum = { ...d };
    $('#pipe-scope').textContent =
      `${d.leads ?? 0} leads em ${d.conversationsScanned ?? 0} conversas · WhatsApp ${d.canais?.whatsapp ?? 0} · Instagram ${d.canais?.instagram ?? 0} · Web ${d.canais?.web ?? 0}`;

    $('#stats').innerHTML = `
      <div class="stat"><div class="stat-label">Abertos</div><div class="stat-value">${sum.situacao?.abertos ?? 0}</div></div>
      <div class="stat"><div class="stat-label"><span class="dot dot-red"></span>Quentes</div><div class="stat-value">${sum.temperatura?.quentes ?? 0}</div></div>
      <div class="stat"><div class="stat-label">Aguardando resposta</div><div class="stat-value">${sum.aguardando ?? 0}</div></div>
      <div class="stat stat-dark"><div class="stat-label">Para ligar +24 h</div><div class="stat-value">${sum.aguardando24h ?? 0}</div></div>
      <div class="stat"><div class="stat-label">Não atendeu</div><div class="stat-value">${sum.naoAtendeu ?? 0}</div></div>
      <div class="stat"><div class="stat-label"><span class="dot dot-green"></span>Vendidos no mês</div><div class="stat-value">${sum.vendidosMes ?? 0}</div></div>`;

    const et = d.etapas || {};
    const chip = (stage, label) =>
      `<button class="funnel-chip ${S.etapa === stage && !S.finalizados ? 'active' : ''}" data-etapa="${esc(stage)}">${esc(label)} <span class="n">${et[stage] ?? 0}</span></button>`;
    $('#funnel').innerHTML = `
      <span class="funnel-label">Funil</span>
      ${chip('primeiro contato', 'Primeiro contato')}<span class="funnel-sep">›</span>
      ${chip('negociando', 'Negociando')}<span class="funnel-sep">›</span>
      ${chip('proposta enviada', 'Proposta enviada')}<span class="funnel-sep">›</span>
      ${chip('fechamento', 'Fechamento')}
      <span class="funnel-div"></span>
      <button class="funnel-chip dashed ${S.finalizados ? 'active' : ''}" data-finalizados>Finalizados <span class="n">${d.feitos ?? 0}</span></button>`;
    $('#funnel').querySelectorAll('[data-etapa]').forEach((b) => b.addEventListener('click', () => {
      S.finalizados = false;
      S.etapa = S.etapa === b.dataset.etapa ? null : b.dataset.etapa;
      S.page = 1; render();
    }));
    $('#funnel').querySelector('[data-finalizados]').addEventListener('click', () => {
      S.finalizados = !S.finalizados; S.etapa = null; S.page = 1; render();
    });

    // attendant filter options (rebuilt but preserving selection)
    const atendentes = [...new Set(openRows().map((r) => r.atendente).filter((a) => a && a !== '—'))].sort();
    const selA = $('#f-atendente');
    const cur = S.atendente;
    selA.innerHTML = '<option value="">Atendente: Todos</option>' +
      atendentes.map((a) => `<option value="${esc(a)}" ${a === cur ? 'selected' : ''}>${esc(a)}</option>`).join('');

    const rows = visibleRows();
    const slice = rows.slice(0, S.page * S.pageSize);
    $('#cards').innerHTML = slice.map(leadCard).join('') ||
      `<div class="fila-empty">Nenhum lead com esses filtros.</div>`;
    const more = rows.length - slice.length;
    $('#load-more').classList.toggle('hidden', more <= 0);
    $('#load-more').textContent = `Mostrando ${slice.length} de ${rows.length} · Carregar mais`;
    bindLeadActions($('#cards'));
  }

  function tempBadge(r) {
    if (r.situacao === 'Vendido' || r.feitoReason === 'vendido') return '<span class="badge badge-vendido">VENDIDO</span>';
    if (r.situacao === 'Descartado') return '<span class="badge badge-descartado">DESCARTADO</span>';
    return `<span class="badge badge-${r.temperatura}">${r.temperatura.toUpperCase()}</span>`;
  }

  function canalBadge(r) {
    if (r.canal === 'INSTAGRAM') return '<span class="badge badge-ig">IG</span>';
    if (r.canal === 'WEB') return '<span class="badge badge-canal">WEB</span>';
    if (r.canal === 'DESCONHECIDO') return '<span class="badge badge-canal">?</span>';
    return '';
  }

  function iaBadge(nota) {
    if (typeof nota !== 'number') return '';
    const cls = nota >= 7 ? 'ia-good' : nota >= 5 ? 'ia-mid' : 'ia-bad';
    return `<span class="ia-badge ${cls}">IA ${String(nota).replace('.', ',')}</span>`;
  }

  function waitPill(r) {
    if (r.feito) return '';
    if (r.noAnswerBucket) return `<span class="pill">Não atendeu ${r.naoAtendeuCount}×</span>`;
    if (r.aguardando && r.aguardandoMin != null) {
      const hot = r.aguardandoMin >= 24 * 60;
      return `<span class="pill ${hot ? 'pill-wait' : ''}">Aguardando há ${fmtWait(r.aguardandoMin)}</span>`;
    }
    if (r.ultimoRemetente === 'agent') return '<span class="pill pill-ok">Respondido</span>';
    return '';
  }

  function contactLine(r) {
    if (r.instagram) return `<span class="lead-contact">@${esc(r.instagram)}</span>`;
    if (r.contato) return `<span class="lead-contact">${esc(r.contato)} <button class="copy-btn" data-copy="${esc(r.telefone)}">copiar</button></span>`;
    return '<span class="lead-contact">sem contato</span>';
  }

  function leadCard(r) {
    const prod = r.produto
      ? `<span class="lead-prod-name">${esc(r.produto)}</span>
         <span class="lead-prod-sku">${r.produtoCodigo ? `SKU ${esc(r.produtoCodigo)} · ${fmtBRL(r.produtoPreco)}` : (r.produtoFonte === 'categoria' ? 'sem SKU · categoria' : '')}</span>
         <span class="lead-prod-cat">${esc(r.produtoCategoria || '')}${r.produtoFonte ? ' · ' + esc(r.produtoFonte) : ''}</span>`
      : '<span class="lead-prod-cat">produto não identificado</span>';
    const ag = r.atendente && r.atendente !== '—'
      ? `<div class="agent-row"><span class="agent-avatar">${esc(r.atendente[0].toUpperCase())}</span><span class="agent-name">${esc(r.atendente)}</span></div>`
      : '<div class="agent-row"><span class="agent-meta">sem atendente</span></div>';
    const primary = r.instagram
      ? `<a class="btn btn-orange" href="https://ig.me/m/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener noreferrer">Abrir DM</a>`
      : (r.telefone
        ? `<a class="btn btn-orange" href="https://wa.me/${esc(r.telefone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`
        : '');
    const action = r.feito || (S.finalizados && r.situacao !== 'Aberto')
      ? `${r.feito ? '<span class="done-check">✓ Concluído</span>' : ''}<button class="btn btn-ghost" data-act="done" data-id="${esc(r.conversationId)}">${r.feito ? 'Reabrir' : 'Finalizar'}</button>`
      : `<button class="btn btn-ghost" data-act="chat" data-id="${esc(r.conversationId)}">Conversa</button>
         <button class="btn btn-ghost" data-act="done" data-id="${esc(r.conversationId)}">Finalizar</button>`;
    const doneLine = r.feito
      ? `Finalizado por ${esc(r.feitoPor || '?')}${r.feitoNota ? ` · "${esc(r.feitoNota)}"` : ''}${r.feitoReasonLabel ? ` · ${esc(r.feitoReasonLabel)}` : ''}`
      : null;
    return `<div class="lead ${r.feito ? 'done' : ''}">
      <div class="lead-id">
        <div class="lead-name-row"><span class="lead-name">${esc(r.nome)}</span>${tempBadge(r)}${canalBadge(r)}</div>
        ${contactLine(r)}
        <div class="pills">${waitPill(r)}${(r.tags || []).slice(0, 3).map((t) => `<span class="pill">${esc(t.name)}</span>`).join('')}</div>
      </div>
      <div class="lead-prod">${prod}</div>
      <div class="lead-agent">${ag}
        ${r.primeiraRespostaMin != null ? `<span class="agent-meta">1ª resposta ${fmtWait(r.primeiraRespostaMin)}</span>` : ''}
        ${iaBadge(r.aiNota)}
      </div>
      <div class="lead-ctx">
        <span class="lead-ctx-text">${doneLine ? esc(doneLine) : `"${esc(r.contexto || '')}"`}</span>
        <span class="lead-ctx-when">${r.ultimaInteracaoMs ? `${new Date(r.ultimaInteracaoMs).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${fmtAgo(r.ultimaInteracaoMs)} · ${r.ultimoRemetente === 'user' ? 'cliente' : r.ultimoRemetente === 'agent' ? 'vendedor' : 'bot'}` : ''}</span>
      </div>
      <div class="lead-actions">${primary}${action}</div>
    </div>`;
  }

  function bindLeadActions(root) {
    root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
      navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Telefone copiado.'));
    }));
    root.querySelectorAll('[data-act="chat"]').forEach((b) => b.addEventListener('click', () => openChat(b.dataset.id)));
    root.querySelectorAll('[data-act="done"]').forEach((b) => b.addEventListener('click', () => openDone(b.dataset.id)));
    root.querySelectorAll('[data-act="noanswer"]').forEach((b) => b.addEventListener('click', () => noAnswer(b.dataset.id, false)));
    root.querySelectorAll('[data-act="requeue"]').forEach((b) => b.addEventListener('click', () => noAnswer(b.dataset.id, true)));
  }

  $('#load-more').addEventListener('click', () => { S.page++; renderPipeline(); });

  // ---------------------------------------------------------------- fila
  function renderFila() {
    const rows = openRows().filter((r) => !r.feito && r.situacao === 'Aberto');
    const paraLigar = rows.filter((r) => (r.paraLigar || r.noAnswerBucket) && r.telefone)
      .sort((a, b) => (b.noAnswerBucket ? -1 : (b.aguardandoMin || 0)) - (a.noAnswerBucket ? -1 : (a.aguardandoMin || 0)));
    const igWaiting = rows.filter((r) => r.paraLigar && !r.telefone && r.instagram);

    $('#fila-sub').textContent = paraLigar.length
      ? `${paraLigar.length} cliente${paraLigar.length > 1 ? 's' : ''} esperando há mais de 24 h`
      : 'Ninguém esperando há mais de 24 h. 👏';
    $('#fila-chips').innerHTML = `
      <span class="fila-chip hot">Para ligar ${paraLigar.length}</span>
      <span class="fila-chip">Aguardando ${S.data.aguardando ?? 0}</span>
      <span class="fila-chip">Quentes ${S.data.temperatura?.quentes ?? 0}</span>`;

    $('#fila-cards').innerHTML = paraLigar.map(filaCard).join('') ||
      '<div class="fila-empty">Fila vazia — todos os clientes de +24 h foram atendidos.</div>';

    $('#fila-ig').innerHTML = igWaiting.length
      ? `<div class="fila-section">Instagram aguardando +24 h</div>` + igWaiting.map(filaIgCard).join('')
      : '';
    bindLeadActions($('#view-fila'));
  }

  function filaCard(r) {
    const noAnswer = r.noAnswerBucket || r.naoAtendeuCount > 0;
    const big = noAnswer
      ? `<div class="fila-wait-big cool">${r.naoAtendeuCount}×</div><div class="fila-wait-label">não atendeu</div>`
      : `<div class="fila-wait-big">${fmtWait(r.aguardandoMin)}</div><div class="fila-wait-label">esperando</div>`;
    const quote = noAnswer && r.naoAtendeuNota
      ? `Última tentativa ${r.naoAtendeuAt ? fmtAgo(Date.parse(r.naoAtendeuAt)) : ''} · "${esc(r.naoAtendeuNota)}"`
      : r.contexto ? `"${esc(r.contexto)}"` : '';
    return `<div class="fila-card">
      <div class="fila-top">
        <div class="fila-who">
          <div class="fila-name-row"><span class="fila-name">${esc(r.nome)}</span>${tempBadge(r)}</div>
          <span class="fila-prod">${esc(r.produto || 'produto não identificado')}${r.produtoPreco ? ' · ' + fmtBRL(r.produtoPreco) : ''}</span>
        </div>
        <div class="fila-wait">${big}</div>
      </div>
      ${quote ? `<p class="fila-quote">${quote}</p>` : ''}
      <div class="fila-btns">
        <a class="btn btn-orange grow" href="tel:+${esc(r.telefone)}">${noAnswer ? 'Ligar de novo' : 'Ligar agora'}</a>
        <a class="btn btn-ghost grow" href="https://wa.me/${esc(r.telefone)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
        ${noAnswer
          ? `<button class="btn btn-ghost" data-act="requeue" data-id="${esc(r.conversationId)}">Voltar à fila</button>`
          : `<button class="btn btn-ghost" data-act="noanswer" data-id="${esc(r.conversationId)}">Não atendeu</button>`}
      </div>
    </div>`;
  }

  function filaIgCard(r) {
    return `<div class="fila-card">
      <div class="fila-top">
        <div class="fila-who">
          <div class="fila-name-row"><span class="fila-name">${esc(r.nome)}</span><span class="badge badge-ig">IG</span>${tempBadge(r)}</div>
          <span class="fila-prod">@${esc(r.instagram)} · ${esc(r.produto || 'produto não identificado')}</span>
        </div>
        <div class="fila-wait"><div class="fila-wait-big">${fmtWait(r.aguardandoMin)}</div><div class="fila-wait-label">esperando</div></div>
      </div>
      ${r.contexto ? `<p class="fila-quote">"${esc(r.contexto)}"</p>` : ''}
      <div class="fila-btns">
        <a class="btn btn-orange grow" href="https://ig.me/m/${encodeURIComponent(r.instagram)}" target="_blank" rel="noopener noreferrer">Responder DM</a>
        <button class="btn btn-ghost" data-act="done" data-id="${esc(r.conversationId)}">Finalizar</button>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- chat modal
  async function openChat(id) {
    const r = (S.data.rows || []).find((x) => x.conversationId === id);
    if (!r) return;
    $('#chat-title').textContent = r.nome;
    $('#chat-sub').textContent = [r.instagram ? `@${r.instagram}` : r.contato, r.canalLabel, r.atendente !== '—' ? r.atendente : null].filter(Boolean).join(' · ');
    $('#chat-body').innerHTML = '<div class="fila-empty">Carregando conversa…</div>';
    $('#modal-chat').classList.remove('hidden');
    try {
      const res = await api(`/api/messages/${encodeURIComponent(r.botId)}/${encodeURIComponent(r.conversationId)}`);
      const { messages = [] } = await res.json();
      $('#chat-body').innerHTML = messages.map((m) => `
        <div class="msg msg-${esc(m.sender)}">
          ${m.author ? `<div class="who">${esc(m.author)}</div>` : (m.sender === 'bot' ? '<div class="who">bot</div>' : '')}
          <div>${esc(m.text)}</div>
          ${m.ts ? `<div class="when">${new Date(m.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>` : ''}
        </div>`).join('') || '<div class="fila-empty">Sem mensagens.</div>';
      $('#chat-body').scrollTop = $('#chat-body').scrollHeight;
    } catch {
      $('#chat-body').innerHTML = '<div class="fila-empty">Falha ao carregar a conversa.</div>';
    }
  }

  // ---------------------------------------------------------------- done modal
  async function openDone(id) {
    const r = (S.data.rows || []).find((x) => x.conversationId === id);
    if (!r) return;
    S.doneLead = r;
    S.doneReason = r.feitoReason || null;
    $('#done-sub').textContent = `${r.nome} · ${r.instagram ? '@' + r.instagram : r.contato || r.canalLabel}`;
    $('#done-note').value = r.feitoNota || '';
    $('#btn-reopen').classList.toggle('hidden', !r.feito);
    $('#btn-noanswer').classList.toggle('hidden', r.feito || !r.telefone);
    $('#btn-requeue').classList.toggle('hidden', r.feito || !r.naoAtendeuCount);
    updateReasons();
    $('#modal-done').classList.remove('hidden');
    try {
      const res = await api('/api/justificativas');
      const { items = [] } = await res.json();
      $('#done-presets').innerHTML = items.map((t) => `<button type="button" data-preset="${esc(t)}">${esc(t)}</button>`).join('');
      $('#done-presets').querySelectorAll('[data-preset]').forEach((b) =>
        b.addEventListener('click', () => { $('#done-note').value = b.dataset.preset; }));
    } catch { /* presets are optional */ }
  }

  function updateReasons() {
    $('#done-reasons').querySelectorAll('.reason').forEach((b) => {
      b.classList.toggle('active', b.dataset.reason === S.doneReason);
    });
    $('#btn-done-confirm').disabled = !S.doneReason;
  }
  $('#done-reasons').addEventListener('click', (e) => {
    const b = e.target.closest('.reason');
    if (!b) return;
    S.doneReason = b.dataset.reason;
    updateReasons();
  });

  $('#btn-done-confirm').addEventListener('click', async () => {
    if (!S.doneLead || !S.doneReason) return;
    try {
      const res = await api('/api/done', {
        method: 'POST',
        body: JSON.stringify({ id: S.doneLead.conversationId, done: true, reason: S.doneReason, note: $('#done-note').value.trim() }),
      });
      if (!res.ok) throw new Error();
      closeModals();
      toast('Lead finalizado.');
      await loadData();
    } catch { toast('Falha ao finalizar.'); }
  });

  $('#btn-reopen').addEventListener('click', async () => {
    if (!S.doneLead) return;
    try {
      await api('/api/done', { method: 'POST', body: JSON.stringify({ id: S.doneLead.conversationId, done: false }) });
      closeModals();
      toast('Lead reaberto.');
      await loadData();
    } catch { toast('Falha ao reabrir.'); }
  });

  async function noAnswer(id, reset) {
    try {
      const res = await api('/api/noanswer', { method: 'POST', body: JSON.stringify({ id, reset }) });
      const d = await res.json();
      closeModals();
      toast(reset ? 'Lead de volta à fila.' : `Registrado: não atendeu (${d.count}×).`);
      await loadData();
    } catch { toast('Falha ao registrar.'); }
  }
  $('#btn-noanswer').addEventListener('click', () => S.doneLead && noAnswer(S.doneLead.conversationId, false));
  $('#btn-requeue').addEventListener('click', () => S.doneLead && noAnswer(S.doneLead.conversationId, true));

  function closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
    S.doneLead = null; S.doneReason = null;
  }
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModals));
  document.querySelectorAll('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // ---------------------------------------------------------------- export / catalog
  $('#btn-export').addEventListener('click', (e) => { e.stopPropagation(); $('#export-menu').classList.toggle('hidden'); });
  document.addEventListener('click', () => $('#export-menu').classList.add('hidden'));

  async function download(path, filename) {
    try {
      const ids = visibleRows().map((r) => r.conversationId);
      const res = await api(path, { method: 'POST', body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast('Falha ao exportar.'); }
  }
  $('#btn-export-csv').addEventListener('click', () => download('/api/download', 'leads.csv'));
  $('#btn-export-xlsx').addEventListener('click', () => download('/api/download.xlsx', 'leads.xlsx'));

  $('#btn-catalog').addEventListener('click', () => $('#catalog-file').click());
  $('#catalog-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const res = await api('/api/catalog', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      toast(`Catálogo importado: ${d.count} produtos. Atualize os dados para reprocessar.`);
    } catch (ex) { toast(ex.message || 'Catálogo inválido.'); }
    e.target.value = '';
  });

  // ---------------------------------------------------------------- nav
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
    S.view = b.dataset.view;
    document.querySelectorAll('.nav-btn').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    $(`#view-${S.view}`).classList.remove('hidden');
    render();
  }));

  // toolbar
  $('#q').addEventListener('input', (e) => { S.q = e.target.value; S.page = 1; renderPipeline(); });
  document.querySelectorAll('#temp-chips .chip').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.temp;
    if (S.temps.has(t)) S.temps.delete(t); else S.temps.add(t);
    b.classList.toggle('active');
    S.page = 1; renderPipeline();
  }));
  $('#only24').addEventListener('change', (e) => { S.only24 = e.target.checked; S.page = 1; renderPipeline(); });
  $('#f-canal').addEventListener('change', (e) => { S.canal = e.target.value; S.page = 1; renderPipeline(); });
  $('#f-atendente').addEventListener('change', (e) => { S.atendente = e.target.value; S.page = 1; renderPipeline(); });
  $('#f-sort').addEventListener('change', (e) => { S.sort = e.target.value; S.page = 1; renderPipeline(); });

  // ---------------------------------------------------------------- boot
  (async function boot() {
    if (await window.NeoronAuth.token()) await showApp();
    else showLogin();
  })();
})();
