import test from 'node:test';
import assert from 'node:assert/strict';
import { responseMetrics, leadScore, decayTemperatura, parseAttendant, attendantName } from '../src/metrics.js';

const MIN = 60_000;
const msg = (sender, ts, content = 'oi') => ({ sender, created_date: ts, message: { content } });

test('responseMetrics: human replies only, bot ignored', () => {
  const t0 = 1_000_000_000_000;
  const messages = [
    msg('user', t0),
    msg('bot', t0 + 1 * MIN),         // bot must not count as a response
    msg('agent', t0 + 10 * MIN),      // first human response: 10 min
    msg('user', t0 + 20 * MIN),
    msg('agent', t0 + 24 * MIN),      // second response: 4 min
  ];
  const m = responseMetrics(messages, t0 + 60 * MIN);
  assert.equal(m.firstResponseMs, 10 * MIN);
  assert.equal(m.responseCount, 2);
  assert.equal(m.medianResponseMs, 4 * MIN);
  assert.equal(m.awaiting, false);
  assert.equal(m.pendingUserTs, null);
});

test('responseMetrics: customer waiting exposes pendingUserTs', () => {
  const t0 = 1_000_000_000_000;
  const messages = [msg('user', t0), msg('agent', t0 + MIN), msg('user', t0 + 5 * MIN)];
  const now = t0 + 30 * MIN;
  const m = responseMetrics(messages, now);
  assert.equal(m.awaiting, true);
  assert.equal(m.pendingUserTs, t0 + 5 * MIN);
  assert.equal(m.awaitingSinceMs, 25 * MIN);
});

test('leadScore: closing intent is quente', () => {
  const messages = [
    msg('user', 1, 'quanto fica o conjunto box queen?'),
    msg('user', 2, 'pode gerar o link que eu fecho hoje'),
  ];
  const s = leadScore(messages, {});
  assert.equal(s.temperatura, 'quente');
  assert.ok(s.motivos.includes('sinal de fechamento'));
});

test('leadScore: recent rejection without recent interest is frio', () => {
  const messages = [msg('user', 1, 'não quero, sem interesse, obrigado')];
  const s = leadScore(messages, {});
  assert.equal(s.temperatura, 'frio');
  assert.ok(s.motivos.includes('sem interesse'));
});

test('leadScore: Descartado short-circuits', () => {
  assert.equal(leadScore([], { situacao: 'Descartado' }).temperatura, 'frio');
});

test('decayTemperatura: morno cools down after 72h idle', () => {
  assert.equal(decayTemperatura('morno', 1, 100), 'frio');
  assert.equal(decayTemperatura('morno', 1, 10), 'morno');
  assert.equal(decayTemperatura('quente', 8, 100), 'quente'); // strong intent survives
  assert.equal(decayTemperatura('frio', 0, 100), 'frio');
});

test('parseAttendant reads the real Neoron prefix format', () => {
  assert.equal(parseAttendant('<strong>Rosemar</strong>:<p></p>Bom dia'), 'Rosemar');
  assert.equal(parseAttendant('Jonas: bom dia'), 'Jonas');
  assert.equal(parseAttendant('Atendimento Belmont: olá'), null); // blocked generic
  assert.equal(parseAttendant('sem prefixo aqui'), null);
});

test('attendantName picks the most frequent agent', () => {
  const messages = [
    msg('agent', 1, 'Jonas: oi'),
    msg('agent', 2, 'Jonas: tudo bem?'),
    msg('agent', 3, 'Renata: assumindo aqui'),
    msg('user', 4, 'oi'),
  ];
  assert.equal(attendantName(messages), 'Jonas');
});
