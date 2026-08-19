import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tagsOf, situacaoOf, etapaOf, canalOf, formatPhone, toMs, baseLead, lastText,
} from '../src/lead.js';

// Fixtures mirror the REAL shapes returned by Neoron's Firestore (discovery 2026-08).
const TAG_VENDA = { 'ed20': { color: '#054F29', name: 'venda realizada', id: 'ed20' } };
const TAG_NEG = { 'ab11': { color: '#0E2B52', name: 'negociando', id: 'ab11' } };

const WA_CONV = {
  _id: '03OTQzXlXOszdFjQshJe-8706',
  conversation_id: '03OTQzXlXOszdFjQshJe-8706',
  channel: 'WHATSAPP',
  status: 'TAKEOVER_IN_ATTENDANCE',
  contact: {
    phone_number: '558387390546', name: 'Maria Evani', instagram_username: '',
    tags: TAG_NEG,
  },
  tags: TAG_NEG,
  last_message_at: 1786374202827,
  last_message_sender: 'user',
  unread_messages: 2,
  agent: 'uid-1',
  department: 'dep-1',
  last_message_text: { sender: 'user', message: { content: 'Blz' } },
};

const IG_CONV = {
  _id: '3hfFNhRX8hj8wla4FVG7-9542',
  conversation_id: '3hfFNhRX8hj8wla4FVG7-9542',
  channel: 'INSTAGRAM',
  status: 'CHATBOT',
  contact: {
    instagram_username: 'kren.menezes', name: 'karen', phone_number: '',
    tags: {},
  },
  tags: {},
  last_message_at: 1787144132821,
  last_message_text: { message_list: [{ type: 'text', content: '<p>Olá!</p>' }] },
};

const STUB_CONV = { _id: '0ZF2qSBkjWR7MvmOop93-9295', conversation_id: '0ZF2qSBkjWR7MvmOop93-9295' };

const BOT = { id: 'bot-1', name: 'Lojas Belmont' };

test('tagsOf reads Neoron object-map tags with colors', () => {
  const tags = tagsOf({ contact: { tags: TAG_VENDA }, tags: TAG_NEG });
  assert.equal(tags.length, 2);
  assert.deepEqual(tags.map((t) => t.name).sort(), ['negociando', 'venda realizada']);
  assert.equal(tags.find((t) => t.name === 'venda realizada').color, '#054F29');
});

test('situacaoOf derives from tags', () => {
  assert.equal(situacaoOf(['venda realizada']), 'Vendido');
  assert.equal(situacaoOf(['desqualificado']), 'Descartado');
  assert.equal(situacaoOf(['negociando']), 'Aberto');
  assert.equal(situacaoOf([]), 'Aberto');
});

test('etapaOf maps tags to funnel stages, most advanced first', () => {
  assert.equal(etapaOf([]), 'primeiro contato');
  assert.equal(etapaOf(['dúvidas']), 'primeiro contato');
  assert.equal(etapaOf(['negociando']), 'negociando');
  assert.equal(etapaOf(['negociando', 'proposta enviada']), 'proposta enviada');
  assert.equal(etapaOf(['fechamento', 'negociando']), 'fechamento');
});

test('canalOf classifies all real channel values', () => {
  assert.deepEqual(canalOf({ channel: 'WHATSAPP' }), { canal: 'WHATSAPP', canalLabel: 'WhatsApp' });
  assert.deepEqual(canalOf({ channel: 'INSTAGRAM' }), { canal: 'INSTAGRAM', canalLabel: 'Instagram' });
  assert.deepEqual(canalOf({ channel: 'WEB' }), { canal: 'WEB', canalLabel: 'Web' });
  assert.deepEqual(canalOf({}), { canal: 'DESCONHECIDO', canalLabel: 'Outro' });
});

test('formatPhone renders BR mobiles', () => {
  assert.equal(formatPhone('558394081342'), '+55 (83) 9408-1342');
  assert.equal(formatPhone(''), '');
});

test('toMs normalizes seconds/millis/micros/ISO', () => {
  assert.equal(toMs(1786374202827), 1786374202827);
  assert.equal(toMs(1786374202), 1786374202000);
  assert.equal(toMs(1786374202827000), 1786374202827);
  assert.equal(toMs('2026-08-10T12:00:00.000Z'), Date.parse('2026-08-10T12:00:00.000Z'));
  assert.equal(toMs(null), null);
});

test('baseLead: WhatsApp conversation', () => {
  const row = baseLead({ bot: BOT, conv: WA_CONV, agents: { 'uid-1': 'Rosemar' }, departments: { 'dep-1': 'Comercial CG' } });
  assert.equal(row.nome, 'Maria Evani');
  assert.equal(row.telefone, '558387390546');
  assert.equal(row.contato, '+55 (83) 8739-0546');
  assert.equal(row.canal, 'WHATSAPP');
  assert.equal(row.instagram, '');
  assert.equal(row.etapa, 'negociando');
  assert.equal(row.situacao, 'Aberto');
  assert.equal(row.atendente, 'Rosemar');
  assert.equal(row.departamento, 'Comercial CG');
  assert.equal(row.statusSistema, 'Em atendimento');
  assert.equal(row.contexto, 'Blz');
  assert.equal(row.naoLidas, 2);
});

test('baseLead: Instagram DM lead has @username and no phone', () => {
  const row = baseLead({ bot: BOT, conv: IG_CONV });
  assert.equal(row.canal, 'INSTAGRAM');
  assert.equal(row.canalLabel, 'Instagram');
  assert.equal(row.instagram, 'kren.menezes');
  assert.equal(row.telefone, '');
  assert.equal(row.nome, 'karen');
  assert.equal(row.etapa, 'primeiro contato');
});

test('baseLead: stub conversation still yields a stable row', () => {
  const row = baseLead({ bot: BOT, conv: STUB_CONV });
  assert.equal(row.canal, 'DESCONHECIDO');
  assert.equal(row.conversationId, STUB_CONV._id);
  assert.equal(row.nome, STUB_CONV._id); // replaced by applyIndex fallback
});

test('lastText strips html and truncates', () => {
  assert.equal(lastText({ last_message_text: { message_list: [{ content: '<p>Oi <strong>tudo bem</strong></p>' }] } }), 'Oi tudo bem');
  const long = { last_message_text: { message: { content: 'x'.repeat(400) } } };
  assert.ok(lastText(long).length <= 280);
  assert.ok(lastText(long).endsWith('…'));
});
