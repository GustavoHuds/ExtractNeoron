import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateAttendants } from '../src/timeline.js';

const MONTH = '2026-08';
const rows = [
  { atendente: 'Ana', first: 60_000, situacao: 'Vendido', awaiting: false, mes: '2026-08' },
  { atendente: 'Ana', first: 180_000, situacao: 'Aberto', awaiting: true, mes: '2026-08' },
  { atendente: 'Ana', first: 120_000, situacao: 'Aberto', awaiting: false, mes: '2026-07' },
  { atendente: 'Bruno', first: null, situacao: 'Aberto', awaiting: false, mes: '2026-08' },
];

test('aggregates per attendant with monthly counts and response stats', () => {
  const out = aggregateAttendants(rows, MONTH);
  const ana = out.find((a) => a.nome === 'Ana');
  assert.equal(ana.conversas, 3);
  assert.equal(ana.chatsMes, 2);
  assert.equal(ana.vendas, 1);
  assert.equal(ana.aguardando, 1);
  assert.equal(ana.primeiraRespostaMedianaMin, 2);
  assert.equal(ana.primeiraRespostaMediaMin, 2);
  assert.equal(ana.taxaConversao, 33.3);
  assert.equal(out[0].nome, 'Ana');
});

test('handles attendant with no response samples', () => {
  const out = aggregateAttendants(rows, MONTH);
  const bruno = out.find((a) => a.nome === 'Bruno');
  assert.equal(bruno.primeiraRespostaMedianaMin, null);
  assert.equal(bruno.chatsMes, 1);
});
