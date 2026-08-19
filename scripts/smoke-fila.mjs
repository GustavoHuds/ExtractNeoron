/**
 * Live check of the call-queue rules and instant-state cycle:
 * finalizar → disappears · reabrir → returns · não atendeu → end of queue ·
 * ✕ dismiss → leaves queue · restore → returns. Leaves no residue.
 *
 *   node scripts/smoke-fila.mjs [baseUrl]
 */
import 'dotenv/config';
import { signIn } from '../src/firestore.js';

const BASE = process.argv[2] || 'http://localhost:3210';
const { idToken } = await signIn();
const h = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
const get = async (p) => (await fetch(`${BASE}${p}`, { headers: h })).json();
const post = async (p, body) => (await fetch(`${BASE}${p}`, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();

// mirrors public/app.js filaRows()
const filaRows = (rows) => rows.filter((r) =>
  r.temUsuario && !r.feito && !r.filaDismissed
  && r.situacao === 'Aberto' && r.etapa === 'negociando'
  && r.canal === 'WHATSAPP' && r.telefone
  && (r.paraLigar || (r.naoAtendeuCount > 0 && r.aguardando)))
  .sort((a, b) => {
    const ga = a.naoAtendeuCount > 0 ? 1 : 0, gb = b.naoAtendeuCount > 0 ? 1 : 0;
    if (ga !== gb) return ga - gb;
    if (ga) return (Date.parse(a.naoAtendeuAt) || 0) - (Date.parse(b.naoAtendeuAt) || 0);
    return (b.aguardandoMin || 0) - (a.aguardandoMin || 0);
  });

const assert = (cond, msg) => { if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); } console.log(`ok  ${msg}`); };

let d = await get('/api/data');
const fila0 = filaRows(d.rows);
console.log(`fila inicial: ${fila0.length} leads (todos WhatsApp + negociando)`);
assert(fila0.every((r) => r.canal === 'WHATSAPP' && r.telefone), 'fila só tem WhatsApp com telefone');
assert(fila0.every((r) => r.etapa === 'negociando' && r.situacao === 'Aberto' && !r.feito), 'fila só tem etapa negociando, aberto, não finalizado');
for (let i = 1; i < fila0.length; i++) {
  const a = fila0[i - 1], b = fila0[i];
  const ga = a.naoAtendeuCount > 0 ? 1 : 0, gb = b.naoAtendeuCount > 0 ? 1 : 0;
  assert(ga < gb || (ga === gb && (ga === 1 || (a.aguardandoMin || 0) >= (b.aguardandoMin || 0))), `ordem correta na posição ${i}`);
  if (ga !== gb || ga === 1) continue;
}
console.log('ordem: espera desc, tentados no fim — verificada');

if (!fila0.length) { console.log('fila vazia — ciclo de ações não testável agora'); process.exit(0); }
const alvo = fila0[0];
console.log(`alvo do ciclo: ${alvo.nome} (${alvo.conversationId.slice(-6)})`);

// 1. finalizar → some na hora
await post('/api/done', { id: alvo.conversationId, done: true, reason: 'outro', note: 'teste automatizado' });
d = await get('/api/data');
assert(!filaRows(d.rows).some((r) => r.conversationId === alvo.conversationId), 'finalizado sumiu da fila instantaneamente');
assert(d.rows.find((r) => r.conversationId === alvo.conversationId)?.feito === true, 'row veio feito=true no /api/data (sem re-extração)');

// 2. reabrir → volta
await post('/api/done', { id: alvo.conversationId, done: false });
d = await get('/api/data');
assert(filaRows(d.rows).some((r) => r.conversationId === alvo.conversationId), 'reaberto voltou à fila');

// 3. não atendeu → fim da fila
await post('/api/noanswer', { id: alvo.conversationId });
d = await get('/api/data');
let fila = filaRows(d.rows);
const pos = fila.findIndex((r) => r.conversationId === alvo.conversationId);
const primeiroTentado = fila.findIndex((r) => r.naoAtendeuCount > 0);
assert(pos >= 0 && pos >= primeiroTentado && fila[pos].naoAtendeuCount === 1, `não atendeu → foi para o grupo do fim da fila (pos ${pos + 1}/${fila.length})`);
await post('/api/noanswer', { id: alvo.conversationId, reset: true }); // cleanup

// 4. ✕ dismiss → sai; restore → volta
await post('/api/fila/dismiss', { id: alvo.conversationId });
d = await get('/api/data');
assert(!filaRows(d.rows).some((r) => r.conversationId === alvo.conversationId), '✕ removeu da fila');
await post('/api/fila/dismiss', { id: alvo.conversationId, restore: true });
d = await get('/api/data');
assert(filaRows(d.rows).some((r) => r.conversationId === alvo.conversationId), 'restore devolveu à fila');

console.log('\nSMOKE-FILA OK — nenhum resíduo deixado');
