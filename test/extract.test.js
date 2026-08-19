import test from 'node:test';
import assert from 'node:assert/strict';
import { indexEntry, applyIndex, summarizeRows, refreshRows, toCsv } from '../src/extract.js';
import { baseLead } from '../src/lead.js';

const MIN = 60_000;
const t0 = Date.parse('2026-08-10T10:00:00Z');
const msg = (sender, ts, content = 'oi') => ({ sender, created_date: ts, message: { content } });
const BOT = { id: 'bot-1', name: 'Lojas Belmont' };

test('indexEntry derives everything from messages', () => {
  const conv = { _id: 'c1', last_message_at: t0 + 30 * MIN };
  const messages = [
    msg('user', t0, 'quanto custa o colchão casal?'),
    msg('bot', t0 + MIN, 'Aguarde, você está na fila'),
    msg('agent', t0 + 10 * MIN, '<strong>Jonas</strong>: Bom dia! Custa R$ 1.899'),
    msg('user', t0 + 30 * MIN, 'vou pensar'),
  ];
  const e = indexEntry(conv, messages, t0 + 60 * MIN);
  assert.equal(e.metaLastMs, t0 + 30 * MIN);
  assert.equal(e.firstTs, t0);
  assert.equal(e.firstUserTs, t0);
  assert.equal(e.msgCount, 4);
  assert.equal(e.userMsgs, 2);
  assert.equal(e.agentMsgs, 1);
  assert.equal(e.atendente, 'Jonas');
  assert.equal(e.firstResponseMs, 10 * MIN);
  assert.equal(e.pendingUserTs, t0 + 30 * MIN); // "vou pensar" unanswered
  assert.deepEqual(e.monthsActive, ['2026-08']);
  assert.ok(e.produtoCategoria.includes('Colchão'));
});

test('indexEntry: stub conversation (no metadata timestamps)', () => {
  const conv = { _id: 'stub-1' };
  const messages = [msg('user', t0, 'Vi o anúncio e gostaria de mais informações!')];
  const e = indexEntry(conv, messages, t0 + 60 * MIN);
  assert.equal(e.metaLastMs, 0);       // change-detector for docs without metadata
  assert.equal(e.lastMs, t0);          // real time from messages
  assert.equal(e.userMsgs, 1);
});

test('applyIndex overlays cache onto a base row and computes the call queue', () => {
  const conv = { _id: 'c1', conversation_id: 'c1', channel: 'WHATSAPP', contact: { phone_number: '5583999990000', name: 'Ana', tags: {} } };
  const now = t0 + 26 * 60 * MIN; // 26h later
  const row = baseLead({ bot: BOT, conv, now });
  const e = {
    metaLastMs: 0, lastMs: t0, firstTs: t0, firstUserTs: t0, msgCount: 3, userMsgs: 2, agentMsgs: 1,
    atendente: 'Renata', firstResponseMs: 5 * MIN, medianResponseMs: 5 * MIN,
    pendingUserTs: t0, interesseScore: 5, temperatura: 'quente', motivos: ['perguntou preço/pagamento'],
    monthsActive: ['2026-08'], produto: 'Colchão casal', produtoFonte: 'categoria',
  };
  applyIndex(row, e, now, 24, 14);
  assert.equal(row.temUsuario, true);
  assert.equal(row.atendente, 'Renata');
  assert.equal(row.aguardando, true);
  assert.equal(row.aguardandoMin, 26 * 60);
  assert.equal(row.paraLigar, true);                 // 26h > 24h queue threshold
  assert.equal(row.temperatura, 'quente');           // strong intent survives decay
  assert.equal(row.primeiraRespostaMin, 5);
});

test('applyIndex: stale waiters (>max days) leave the call queue', () => {
  const conv = { _id: 'c3', conversation_id: 'c3', contact: { phone_number: '5583999990000', tags: {} } };
  const now = t0 + 60 * 24 * 60 * MIN; // 60 days later
  const row = baseLead({ bot: BOT, conv, now });
  applyIndex(row, { pendingUserTs: t0, userMsgs: 1, msgCount: 2, monthsActive: [] }, now, 24, 14);
  assert.equal(row.aguardando, true);   // still shown as waiting in the pipeline
  assert.equal(row.paraLigar, false);   // but not in the call queue — lead is lost
});

test('applyIndex: done leads never enter the call queue', () => {
  const conv = { _id: 'c2', conversation_id: 'c2', contact: { tags: {} } };
  const row = baseLead({ bot: BOT, conv, doneMap: { c2: { done: true, at: '2026-08-01T00:00:00Z', reason: 'vendido' } } });
  applyIndex(row, { pendingUserTs: t0, userMsgs: 1, msgCount: 2, monthsActive: [] }, t0 + 48 * 60 * MIN, 24);
  assert.equal(row.feito, true);
  assert.equal(row.aguardando, false);
  assert.equal(row.paraLigar, false);
});

test('summarizeRows: channel + funnel + month counters', () => {
  const now = Date.parse('2026-08-15T12:00:00Z');
  const rows = [
    { temUsuario: true, situacao: 'Aberto', etapa: 'negociando', temperatura: 'quente', canal: 'WHATSAPP', aguardando: true, paraLigar: true, noAnswerBucket: false, feito: false },
    { temUsuario: true, situacao: 'Aberto', etapa: 'primeiro contato', temperatura: 'morno', canal: 'INSTAGRAM', aguardando: false, paraLigar: false, noAnswerBucket: false, feito: false },
    { temUsuario: true, situacao: 'Vendido', etapa: 'fechamento', temperatura: 'frio', canal: 'WHATSAPP', feito: true, feitoReason: 'vendido', feitoAt: '2026-08-05T00:00:00Z' },
  ];
  const s = summarizeRows(rows, now);
  assert.equal(s.count, 3);
  assert.equal(s.leads, 3);
  assert.equal(s.situacao.abertos, 2);
  assert.equal(s.situacao.vendidos, 1);
  assert.equal(s.canais.whatsapp, 2);
  assert.equal(s.canais.instagram, 1);
  assert.equal(s.etapas.negociando, 1);
  assert.equal(s.aguardando24h, 1);
  assert.equal(s.vendidosMes, 1);
  assert.equal(s.feitos, 1);
});

function storedResult() {
  // as written to leads.json at extraction time: lead open and waiting
  return {
    generatedAt: '2026-08-10T10:00:00Z',
    rows: [{
      conversationId: 'c1', temUsuario: true, situacao: 'Aberto', etapa: 'negociando',
      canal: 'WHATSAPP', telefone: '5583999990000', temperatura: 'quente',
      feito: false, feitoAt: null, feitoReason: '', feitoReasonLabel: '', feitoNota: '', feitoPor: '',
      naoAtendeuCount: 0, naoAtendeuAt: null, naoAtendeuNota: '', noAnswerBucket: false,
      aguardando: true, aguardandoMin: 60, paraLigar: false, nome: 'Ana',
      ultimaInteracaoMs: t0, tags: [], motivos: [],
    }],
  };
}
const IDX = {
  c1: {
    metaLastMs: t0, lastMs: t0, firstTs: t0, firstUserTs: t0, msgCount: 2, userMsgs: 1,
    agentMsgs: 1, pendingUserTs: t0, interesseScore: 5, temperatura: 'quente',
    motivos: [], monthsActive: ['2026-08'], firstResponseMs: 5 * MIN, medianResponseMs: 5 * MIN,
  },
};

test('refreshRows: finalizing a lead reflects instantly, without re-extraction', () => {
  const now = t0 + 26 * 60 * MIN;
  const deps = { naMap: {}, skipMap: {}, index: IDX };

  // before conclusion: open + in the call queue
  const before = refreshRows(storedResult(), now, { ...deps, doneMap: {} });
  assert.equal(before.rows[0].paraLigar, true);
  assert.equal(before.situacao.abertos, 1);

  // after conclusion (any outcome): out of open counters and out of the queue
  const doneMap = { c1: { done: true, at: new Date(now).toISOString(), by: 'x@b.com', reason: 'sem_interesse', note: '' } };
  const after = refreshRows(storedResult(), now, { ...deps, doneMap });
  assert.equal(after.rows[0].feito, true);
  assert.equal(after.rows[0].feitoReasonLabel, 'Sem interesse');
  assert.equal(after.rows[0].aguardando, false);
  assert.equal(after.rows[0].paraLigar, false);
  assert.equal(after.situacao.abertos, 0);
  assert.equal(after.feitos, 1);
});

test('refreshRows: call attempts and clock advance without re-extraction', () => {
  const now = t0 + 30 * 60 * MIN;
  const deps = { doneMap: {}, skipMap: {}, index: IDX };
  const naMap = { c1: { count: 1, at: new Date(now - 10 * MIN).toISOString(), by: 'x', note: 'caixa postal' } };
  const r = refreshRows(storedResult(), now, { ...deps, naMap }).rows[0];
  assert.equal(r.naoAtendeuCount, 1);
  assert.equal(r.aguardandoMin, 30 * 60);   // waiting time recomputed for "now"
  assert.equal(r.paraLigar, true);
});

test('refreshRows: queue dismissal holds for the episode, expires on new message', () => {
  const now = t0 + 26 * 60 * MIN;
  const deps = { doneMap: {}, naMap: {} };

  // dismissed this waiting episode → out of the queue flag-wise
  const skipMap = { c1: { at: 'x', by: 'x', pendingUserTs: t0 } };
  const dismissed = refreshRows(storedResult(), now, { ...deps, skipMap, index: IDX }).rows[0];
  assert.equal(dismissed.filaDismissed, true);

  // customer wrote again (newer pendingUserTs) → back in the queue
  const idx2 = { c1: { ...IDX.c1, pendingUserTs: t0 + 60 * MIN } };
  const back = refreshRows(storedResult(), now, { ...deps, skipMap, index: idx2 }).rows[0];
  assert.equal(back.filaDismissed, false);
});

test('toCsv neutralizes formula injection and flattens tag objects', () => {
  const rows = [{
    nome: '=cmd()', contato: '+55 (83) 9…', telefone: '5583', instagram: '', canalLabel: 'WhatsApp',
    situacao: 'Aberto', etapa: 'negociando', temperatura: 'quente', motivos: ['a'],
    tags: [{ name: 'negociando', color: '#000' }], contexto: 'oi', conversationId: 'c1',
  }];
  const csv = toCsv(rows);
  assert.ok(csv.includes("'=cmd()"));
  assert.ok(csv.includes('negociando'));
  assert.ok(!csv.includes('#000')); // tag colors never leak into exports
});
