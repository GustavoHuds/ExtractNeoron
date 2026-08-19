/**
 * End-to-end smoke test against a RUNNING server + real Neoron account.
 * Uses NEORON_EMAIL / NEORON_PASSWORD from .env (like a browser login would).
 *
 *   npm run serve      # in another terminal
 *   node scripts/smoke.mjs [baseUrl]
 */
import 'dotenv/config';
import { signIn } from '../src/firestore.js';

const BASE = process.argv[2] || 'http://localhost:3000';

const { idToken, email } = await signIn();
console.log('1. login OK:', email);

const h = { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };

const health = await (await fetch(`${BASE}/health`)).json();
console.log('2. /health:', health);

console.log('3. POST /api/extract (primeira vez pode levar 1-2 min)…');
const t0 = Date.now();
const exRes = await fetch(`${BASE}/api/extract`, { method: 'POST', headers: h, body: '{}' });
if (!exRes.ok) throw new Error(`extract ${exRes.status}: ${await exRes.text()}`);
const ex = await exRes.json();
console.log(`   ${(Date.now() - t0) / 1000 | 0}s · conversas: ${ex.conversationsScanned} · buscadas: ${ex.chatsFetched} · leads: ${ex.leads}`);
console.log('   canais:', ex.canais);
console.log('   situação:', ex.situacao, '· aguardando24h:', ex.aguardando24h, '· vendidosMes:', ex.vendidosMes);

const igLeads = ex.rows.filter((r) => r.canal === 'INSTAGRAM');
console.log(`4. Instagram DM leads: ${igLeads.length}`);
for (const r of igLeads.slice(0, 5)) console.log(`   @${r.instagram} · ${r.nome} · etapa=${r.etapa} · temp=${r.temperatura}`);

const fila = ex.rows.filter((r) => r.paraLigar && !r.feito);
console.log(`5. Fila de ligações (+24h): ${fila.length}`);
for (const r of fila.slice(0, 5)) console.log(`   ${r.nome} · esperando ${Math.round((r.aguardandoMin || 0) / 60)}h · ${r.contato || '@' + r.instagram}`);

const mRes = await fetch(`${BASE}/api/metrics`, { headers: h });
const m = await mRes.json();
console.log('6. /api/metrics:', m.mes, '· kpis:', m.kpis);
console.log('   por atendente:', m.porAtendente.map((a) => `${a.nome}:${a.vendas}v/${a.conversas}c`).join(' '));

console.log('\nSMOKE OK');
