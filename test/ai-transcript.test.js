import test from 'node:test';
import assert from 'node:assert/strict';
import { compactTranscript } from '../src/ai.js';

test('labels senders in Portuguese and keeps order', () => {
  const out = compactTranscript([
    { sender: 'user', text: 'Oi, quero um colchão' },
    { sender: 'agent', text: 'Claro! Qual tamanho?' },
    { sender: 'bot', text: 'Menu inicial' },
  ]);
  assert.equal(out, 'Cliente: Oi, quero um colchão\nVendedor: Claro! Qual tamanho?\nBot: Menu inicial');
});

test('caps each message and the total size (keeps the most recent tail)', () => {
  const msgs = Array.from({ length: 100 }, (_, i) => ({ sender: 'user', text: `mensagem ${i} ` + 'x'.repeat(300) }));
  const out = compactTranscript(msgs, { maxMsgs: 40, maxMsgChars: 50, maxChars: 500 });
  assert.ok(out.length <= 500);
  assert.ok(out.includes('mensagem 99'));      // latest message survives
  assert.ok(!out.includes('mensagem 10 '));    // older ones dropped
});

test('skips empty/media-less messages', () => {
  const out = compactTranscript([
    { sender: 'user', text: '  ' },
    { sender: 'agent', text: 'Bom dia!' },
  ]);
  assert.equal(out, 'Vendedor: Bom dia!');
});
