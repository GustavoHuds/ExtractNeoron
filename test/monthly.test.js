import test from 'node:test';
import assert from 'node:assert/strict';
import { monthKey, prevMonthKey, weekKey, soldAtMs, buildMonthly, lastWeeks } from '../src/monthly.js';

const AUG = Date.parse('2026-08-15T12:00:00Z');
const JUL = Date.parse('2026-07-10T12:00:00Z');

test('monthKey / prevMonthKey', () => {
  assert.equal(monthKey(AUG), '2026-08');
  assert.equal(prevMonthKey('2026-08'), '2026-07');
  assert.equal(prevMonthKey('2026-01'), '2025-12');
});

test('weekKey is Monday-based and stable', () => {
  const wed = Date.parse('2026-08-12T15:00:00'); // Wednesday
  const mon = Date.parse('2026-08-10T08:00:00'); // that Monday
  assert.equal(weekKey(wed), weekKey(mon));
});

test('lastWeeks returns n contiguous weeks ending now', () => {
  const weeks = lastWeeks(8, AUG);
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7], weekKey(AUG));
});

test('soldAtMs: dashboard conclusion wins over tag', () => {
  const doneAt = '2026-08-02T10:00:00.000Z';
  assert.equal(soldAtMs({ feitoReason: 'vendido', feitoAt: doneAt }), Date.parse(doneAt));
  assert.equal(soldAtMs({ situacao: 'Vendido', ultimaInteracaoMs: JUL }), JUL);
  assert.equal(soldAtMs({ situacao: 'Aberto' }), null);
});

function fixture() {
  // 3 leads: 1 sold in Aug (Renata), 1 new in Aug open (Renata), 1 sold in Jul (Jonas)
  const rows = [
    {
      conversationId: 'c1', atendente: 'Renata', canal: 'WHATSAPP', temUsuario: true,
      situacao: 'Vendido', etapa: 'negociando', feito: true, feitoReason: 'vendido',
      feitoAt: '2026-08-05T10:00:00.000Z', produtoPreco: 2000, aiNota: 9, aguardando: false,
      ultimaInteracaoMs: AUG,
    },
    {
      conversationId: 'c2', atendente: 'Renata', canal: 'INSTAGRAM', temUsuario: true,
      situacao: 'Aberto', etapa: 'primeiro contato', feito: false, produtoPreco: null,
      aiNota: 8, aguardando: true, ultimaInteracaoMs: AUG,
    },
    {
      conversationId: 'c3', atendente: 'Jonas', canal: 'WHATSAPP', temUsuario: true,
      situacao: 'Vendido', etapa: 'fechamento', feito: true, feitoReason: 'vendido',
      feitoAt: '2026-07-20T10:00:00.000Z', produtoPreco: 1000, aiNota: 7, aguardando: false,
      ultimaInteracaoMs: JUL,
    },
  ];
  const index = {
    c1: { firstUserTs: Date.parse('2026-08-01T09:00:00Z'), firstTs: 1, monthsActive: ['2026-08'], firstResponseMs: 5 * 60000 },
    c2: { firstUserTs: Date.parse('2026-08-10T09:00:00Z'), firstTs: 1, monthsActive: ['2026-08'], firstResponseMs: 15 * 60000 },
    c3: { firstUserTs: Date.parse('2026-07-05T09:00:00Z'), firstTs: 1, monthsActive: ['2026-07'], firstResponseMs: 8 * 60000 },
  };
  return { rows, index };
}

test('buildMonthly: real counts for the month', () => {
  const { rows, index } = fixture();
  const m = buildMonthly(rows, index, { month: '2026-08', now: AUG });

  assert.equal(m.kpis.vendas, 1);            // only c1 sold in Aug
  assert.equal(m.kpis.vendasPrev, 1);        // c3 sold in Jul
  assert.equal(m.kpis.leadsNovos, 2);        // c1 + c2 first spoke in Aug
  assert.equal(m.kpis.leadsNovosPrev, 1);    // c3
  assert.equal(m.kpis.conversaoPct, 50);     // 1 / 2
  assert.equal(m.kpis.conversasAtivas, 2);
  assert.equal(m.kpis.ticketMedioEstimado, 2000);
  assert.equal(m.kpis.primeiraRespostaMedianaMin, 5); // median(5, 15) = lower-mid = 5

  assert.equal(m.canais.instagram, 1);       // c2 is an Instagram lead
  assert.equal(m.canais.whatsapp, 1);

  const renata = m.porAtendente.find((a) => a.nome === 'Renata');
  assert.equal(renata.vendas, 1);
  assert.equal(renata.conversas, 2);
  assert.equal(renata.aguardando, 1);
  assert.equal(renata.vendasSemana.length, 8);

  const jonas = m.porAtendente.find((a) => a.nome === 'Jonas');
  assert.equal(jonas.vendas, 0);
  assert.equal(jonas.vendasPrev, 1);

  // funnel only counts open leads
  assert.deepEqual(m.funil.find((f) => f.etapa === 'primeiro contato').count, 1);
  assert.equal(m.mesesDisponiveis[0], '2026-08');
});

test('buildMonthly: previous month view', () => {
  const { rows, index } = fixture();
  const m = buildMonthly(rows, index, { month: '2026-07', now: AUG });
  assert.equal(m.kpis.vendas, 1);      // c3
  assert.equal(m.kpis.leadsNovos, 1);
  assert.equal(m.kpis.ticketMedioEstimado, 1000);
});
